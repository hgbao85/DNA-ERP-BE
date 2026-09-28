import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import {
  MFG_FLOOR_ROLES,
  MFG_FLOOR_WAREHOUSE_SCOPE,
  MFG_ROLE_TO_BUSINESS_ROLE,
} from '../../common/constants/role-permissions.constant';
import { BUSINESS_ROLES } from '../../common/constants/roles.constant';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { paginate } from '../../common/utils/paginate.util';
import { isFamilyScope } from '../../common/utils/warehouse-family.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { TransferBuyerMaterialsDto } from './dto/transfer-buyer-materials.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserMfgAttributesDto } from './dto/update-user-mfg-attributes.dto';
import { UserResponseDto } from './dto/user-response.dto';

const userWithRolesInclude = {
  roles: { include: { role: true } },
} as const;

const authProfileInclude = {
  roles: {
    include: {
      role: {
        include: { permissions: { include: { permission: true } } },
      },
    },
  },
} as const;

type UserWithRoles = Awaited<ReturnType<UsersService['findRawById']>>;
export type AuthUserProfile = NonNullable<
  Awaited<ReturnType<UsersService['findAuthProfileByUsername']>>
>;

@Injectable()
export class UsersService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async create(dto: CreateUserDto): Promise<UserResponseDto> {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, { username: dto.username }] },
    });
    if (existing) {
      const field = existing.email === dto.email ? 'Email' : 'Username';
      const value = existing.email === dto.email ? dto.email : dto.username;
      throw new ConflictException(`${field} ${value} is already in use`);
    }

    const hashedPassword = await argon2.hash(dto.password);

    // Transactional pattern: creating the user and assigning roles must succeed
    // or fail together. Future ERP modules (stock ledger, purchasing, etc.)
    // should follow this same $transaction shape for multi-step writes.
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username: dto.username,
          email: dto.email,
          password: hashedPassword,
          firstName: dto.firstName,
          lastName: dto.lastName,
        },
      });

      if (dto.roleIds?.length) {
        await tx.userRole.createMany({
          data: dto.roleIds.map((roleId) => ({ userId: created.id, roleId })),
        });
      }

      return tx.user.findUniqueOrThrow({
        where: { id: created.id },
        include: userWithRolesInclude,
      });
    });

    return this.toResponseDto(user);
  }

  async findAll(query: PaginationQueryDto): Promise<Paginated<UserResponseDto>> {
    const where = query.search
      ? {
          OR: [
            { username: { contains: query.search, mode: 'insensitive' as const } },
            { email: { contains: query.search, mode: 'insensitive' as const } },
            { firstName: { contains: query.search, mode: 'insensitive' as const } },
            { lastName: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : undefined;

    const result = await paginate(
      {
        findMany: (args) => this.prisma.user.findMany({ ...args, include: userWithRolesInclude }),
        count: (args) => this.prisma.user.count(args),
      },
      query,
      where,
      query.sortBy ? { [query.sortBy]: query.sortOrder } : { createdAt: query.sortOrder },
    );

    return { data: result.data.map((user) => this.toResponseDto(user)), meta: result.meta };
  }

  async findOne(id: string): Promise<UserResponseDto> {
    const user = await this.findRawById(id);
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return this.toResponseDto(user);
  }

  async update(id: string, dto: UpdateUserDto, currentUserId: string): Promise<UserResponseDto> {
    const current = await this.findOneOrThrow(id);

    // Self-protection: an admin must not be able to lock themselves out or strip their own
    // roles (would leave the system potentially un-administerable). Enforced server-side -
    // the FE hides these controls too, but the BE never trusts that.
    if (id === currentUserId) {
      if (dto.roleIds !== undefined) {
        throw new ForbiddenException('You cannot change your own roles');
      }
      if (dto.isActive === false) {
        throw new ForbiddenException('You cannot deactivate your own account');
      }
    }

    if (dto.isActive === false && current.isActive) {
      await this.assertNoBuyerMaterials(id, 'khoá tài khoản');
    }
    if (dto.roleIds !== undefined && this.hasRole(current, BUSINESS_ROLES.PURCHASER)) {
      const keepsPurchaser = await this.prisma.role.count({
        where: { id: { in: dto.roleIds }, name: BUSINESS_ROLES.PURCHASER },
      });
      if (!keepsPurchaser) {
        await this.assertNoBuyerMaterials(id, 'bỏ chức năng Mua hàng');
      }
    }

    const user = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          username: dto.username,
          firstName: dto.firstName,
          lastName: dto.lastName,
          isActive: dto.isActive,
        },
      });

      if (dto.roleIds) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        if (dto.roleIds.length) {
          await tx.userRole.createMany({
            data: dto.roleIds.map((roleId) => ({ userId: id, roleId })),
          });
        }
      }

      return tx.user.findUniqueOrThrow({ where: { id }, include: userWithRolesInclude });
    });

    return this.toResponseDto(user);
  }

  async updateMfgAttributes(id: string, dto: UpdateUserMfgAttributesDto): Promise<UserResponseDto> {
    const current = await this.findOneOrThrow(id);

    // Floor roles (Phôi/Hàn/Sơn/KCS) chỉ tồn tại trong gia đình kho phoi-son-han - trước
    // 2026-09-03 ép cứng về đúng 1 literal 'phoi-son-han' bất kể caller gửi gì, khiến không công
    // nhân nào gán được vào kho phoi-son-han PHỤ dù Admin đã tạo thêm được kho đó. Giờ tin giá trị
    // caller gửi MIỄN LÀ nó thuộc đúng gia đình phoi-son-han (isFamilyScope) - chỉ fallback về kho
    // gốc khi caller không gửi hoặc gửi sai gia đình (giữ nguyên bất biến "floor role chỉ ở 1 kho
    // phoi-son-han cụ thể", không tin mù quáng giá trị bất kỳ).
    const effectiveMfgRole = dto.mfgRole !== undefined ? dto.mfgRole : current.mfgRole;
    const isFloorRole = !!effectiveMfgRole && MFG_FLOOR_ROLES.includes(effectiveMfgRole);
    const warehouseScope = isFloorRole
      ? isFamilyScope(dto.warehouseScope, 'phoi-son-han')
        ? dto.warehouseScope
        : MFG_FLOOR_WAREHOUSE_SCOPE
      : dto.warehouseScope;

    if (dto.isPurchaser === false && current.isPurchaser) {
      await this.assertNoBuyerMaterials(id, 'bỏ chức năng Mua hàng');
    }

    const user = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          mfgRole: dto.mfgRole,
          warehouseScope,
          isPurchaser: dto.isPurchaser,
          isProductPlanner: dto.isProductPlanner,
          isSale: dto.isSale,
          isMaterialsManager: dto.isMaterialsManager,
        },
      });

      // Keep the capability Role (RBAC layer 1) in lockstep with the mfgRole attribute
      // (scope layer 2): when mfgRole changes, drop whichever mfg-managed role the user
      // held and assign the one paired with the new mfgRole. Roles the admin assigned by
      // hand (anything not in MFG_ROLE_TO_BUSINESS_ROLE) are never touched. Only runs when
      // the caller actually sets mfgRole.
      if (dto.mfgRole !== undefined) {
        const managedRoleNames = Object.values(MFG_ROLE_TO_BUSINESS_ROLE);
        const managedRoles = await tx.role.findMany({
          where: { name: { in: managedRoleNames } },
          select: { id: true, name: true },
        });

        await tx.userRole.deleteMany({
          where: { userId: id, roleId: { in: managedRoles.map((role) => role.id) } },
        });

        const targetName = MFG_ROLE_TO_BUSINESS_ROLE[dto.mfgRole];
        if (targetName) {
          const target = managedRoles.find((role) => role.name === targetName);
          if (!target) {
            throw new Error(
              `Business role "${targetName}" is missing - run the seed to create it.`,
            );
          }
          await tx.userRole.create({ data: { userId: id, roleId: target.id } });
        }
      }

      return tx.user.findUniqueOrThrow({ where: { id }, include: userWithRolesInclude });
    });

    return this.toResponseDto(user);
  }

  async resetPassword(id: string, dto: ResetPasswordDto): Promise<void> {
    await this.findOneOrThrow(id);

    const hashedPassword = await argon2.hash(dto.newPassword);

    // Admin-initiated reset (no current-password check - the admin doesn't know it).
    // Revoke the target user's live refresh tokens so their old sessions can't keep going
    // with the replaced credential; they must log in again with the new password. Their
    // current access token (stateless JWT) still works until it expires - same trade-off
    // documented in AuthService.changePassword. Audit log redacts the password field.
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { password: hashedPassword } });
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  async remove(id: string, currentUserId: string): Promise<void> {
    if (id === currentUserId) {
      throw new ForbiddenException('You cannot delete your own account');
    }
    await this.findOneOrThrow(id);
    await this.assertNoBuyerMaterials(id, 'xoá tài khoản');
    // Soft delete: the Prisma extension rewrites this into an UPDATE setting deletedAt.
    await this.prisma.user.delete({ where: { id } });
  }

  /** Vật tư (Material.buyerId) đang giao cho user này mua - phục vụ màn "Chuyển giao vật tư". */
  async findBuyerMaterials(id: string) {
    await this.findOneOrThrow(id);
    const materials = await this.prisma.material.findMany({
      where: { buyerId: id, deletedAt: null },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
    // Material.id là BigInt - JSON.stringify không serialize được (500), đổi sang number.
    return {
      count: materials.length,
      materials: materials.map((m) => ({ ...m, id: Number(m.id) })),
    };
  }

  /**
   * Chuyển TOÀN BỘ vật tư đang giao cho `id` mua sang `dto.toUserId` trong 1 lệnh (2026-09-28).
   * Dùng khi nhân viên mua hàng nghỉ việc/đổi vị trí: trước đây phải sửa tay từng vật tư ở
   * Admin > Vật tư, và nếu khoá/bỏ Mua hàng trước khi chuyển xong thì vật tư "mồ côi" - buyerId
   * vẫn trỏ người cũ nên KHÔNG nhân viên mua hàng nào khác thấy/duyệt được đề xuất của chúng
   * (xem PurchaseProposalsService.assertActorMayHandle), chỉ còn Sếp/Admin xử lý được.
   *
   * KHÔNG đổi tên/tái dùng tài khoản cũ cho người mới: lịch sử (PurchaseProposalItem.approvedBy...)
   * lưu theo User.id, tái dùng sẽ ghi việc người cũ đã làm sang tên người mới.
   */
  async transferBuyerMaterials(
    id: string,
    dto: TransferBuyerMaterialsDto,
  ): Promise<{ count: number }> {
    if (dto.toUserId === id) {
      throw new BadRequestException('Người nhận phải khác người đang phụ trách');
    }
    await this.findOneOrThrow(id);
    const target = await this.prisma.user.findUnique({ where: { id: dto.toUserId } });
    if (!target) {
      throw new NotFoundException(`User ${dto.toUserId} not found`);
    }
    if (!target.isActive || !target.isPurchaser) {
      throw new BadRequestException(
        'Người nhận phải là tài khoản đang hoạt động và có chức năng Mua hàng',
      );
    }
    // Chuyển cả vật tư đã xoá mềm (nếu có) để không còn bản ghi nào trỏ về người cũ.
    const { count } = await this.prisma.material.updateMany({
      where: { buyerId: id },
      data: { buyerId: dto.toUserId },
    });
    return { count };
  }

  /** Chặn thao tác làm vật tư "mồ côi" (xem transferBuyerMaterials) - phải chuyển giao trước. */
  private async assertNoBuyerMaterials(id: string, action: string): Promise<void> {
    const count = await this.prisma.material.count({ where: { buyerId: id, deletedAt: null } });
    if (count > 0) {
      throw new BadRequestException(
        `Không thể ${action}: người này còn phụ trách mua ${count} vật tư. ` +
          'Dùng "Chuyển giao vật tư" ở Admin > Người dùng để giao cho nhân viên mua hàng khác trước.',
      );
    }
  }

  private hasRole(user: NonNullable<UserWithRoles>, roleName: string): boolean {
    return user.roles.some((r) => r.role.name === roleName);
  }

  /** Used by AuthService to validate credentials without exposing the password hash elsewhere. */
  async findAuthProfileByUsername(username: string) {
    return this.prisma.user.findUnique({
      where: { username },
      include: authProfileInclude,
    });
  }

  /** Used by AuthService when rotating a refresh token (only the user id is known). */
  async findAuthProfileById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: authProfileInclude,
    });
  }

  private async findRawById(id: string) {
    return this.prisma.user.findUnique({ where: { id }, include: userWithRolesInclude });
  }

  private async findOneOrThrow(id: string) {
    const user = await this.findRawById(id);
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  private toResponseDto(user: UserWithRoles): UserResponseDto {
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return new UserResponseDto({
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      roles: user.roles.map((r) => r.role.name),
      mfgRole: user.mfgRole,
      warehouseScope: user.warehouseScope,
      isPurchaser: user.isPurchaser,
      isProductPlanner: user.isProductPlanner,
      isSale: user.isSale,
      isMaterialsManager: user.isMaterialsManager,
    });
  }
}
