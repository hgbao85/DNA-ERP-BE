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
import { sortOrderBy } from '../../common/utils/sort-order-by.util';
import { isFamilyScope } from '../../common/utils/warehouse-family.util';
import {
  PrivilegeActor,
  assertCanGrantPermissions,
  assertNotAdminRoleUnlessAdmin,
  isAdminActor,
} from '../../common/utils/privilege-guard.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { TransferBuyerMaterialsDto } from './dto/transfer-buyer-materials.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserMfgAttributesDto } from './dto/update-user-mfg-attributes.dto';
import { UserResponseDto } from './dto/user-response.dto';

// Role xoá mềm (soft-delete.extension) KHÔNG xoá dòng UserRole, và extension không lọc include
// lồng nhau -> phải tự loại role có deletedAt, nếu không role đã xoá vẫn hiện trên user và vẫn
// được nạp quyền vào token.
const activeRoleLink = { role: { deletedAt: null } } as const;

const userWithRolesInclude = {
  roles: { where: activeRoleLink, include: { role: true } },
  workshop: { select: { name: true } },
} as const;

const authProfileInclude = {
  roles: {
    where: activeRoleLink,
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

  async create(dto: CreateUserDto, actor: PrivilegeActor): Promise<UserResponseDto> {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, { username: dto.username }] },
    });
    if (existing) {
      const field = existing.email === dto.email ? 'Email' : 'Tên đăng nhập';
      const value = existing.email === dto.email ? dto.email : dto.username;
      throw new ConflictException(`${field} ${value} đã được dùng`);
    }

    // B1 16/11: không gán được vai trò ADMIN / vai trò có quyền mình không có.
    await this.assertCanAssignRoles(actor, dto.roleIds ?? [], 'tạo tài khoản với vai trò này');

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
      sortOrderBy(
        query,
        ['id', 'username', 'email', 'firstName', 'lastName', 'createdAt', 'updatedAt'],
        { createdAt: query.sortOrder },
      ),
    );

    return { data: result.data.map((user) => this.toResponseDto(user)), meta: result.meta };
  }

  async findOne(id: string): Promise<UserResponseDto> {
    const user = await this.findRawById(id);
    if (!user) {
      throw new NotFoundException(`Không tìm thấy tài khoản ${id}`);
    }
    return this.toResponseDto(user);
  }

  async update(id: string, dto: UpdateUserDto, actor: PrivilegeActor): Promise<UserResponseDto> {
    const currentUserId = actor.id;
    const current = await this.findOneOrThrow(id);
    // B1 16/11: không phải ADMIN thì không sửa tài khoản ADMIN (kể cả gỡ vai trò ADMIN), và chỉ THÊM được vai trò mà mọi
    // quyền của nó mình đều có (vai trò đang có của người đó giữ nguyên được - FE luôn gửi cả danh sách).
    this.assertTargetNotAdmin(actor, current, 'sửa tài khoản quản trị viên');
    if (dto.roleIds !== undefined) {
      const had = new Set(current.roles.map((r) => r.roleId));
      await this.assertCanAssignRoles(
        actor,
        dto.roleIds.filter((r) => !had.has(r)),
        'gán vai trò này',
      );
    }

    // Self-protection: an admin must not be able to lock themselves out or strip their own
    // roles (would leave the system potentially un-administerable). Enforced server-side -
    // the FE hides these controls too, but the BE never trusts that.
    if (id === currentUserId) {
      if (dto.roleIds !== undefined) {
        throw new ForbiddenException('Bạn không thể tự đổi vai trò của mình');
      }
      if (dto.isActive === false) {
        throw new ForbiddenException('Bạn không thể tự vô hiệu hoá tài khoản của mình');
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

      // BM3 19/11: khoá tài khoản thì thu hồi mọi refresh token (như updateWorker / resetPassword) - trước đây mở khoá
      // lại là mọi máy còn token cũ (≤ 7 ngày) vào thẳng không cần đăng nhập.
      if (dto.isActive === false && current.isActive) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

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

  async updateMfgAttributes(
    id: string,
    dto: UpdateUserMfgAttributesDto,
    actor: PrivilegeActor,
  ): Promise<UserResponseDto> {
    const current = await this.findOneOrThrow(id);
    this.assertTargetNotAdmin(actor, current, 'sửa tài khoản quản trị viên');
    // BM2 19/11: đổi mfgRole kéo theo gán vai trò nghiệp vụ đi kèm (QLSX, KCS…) - trước đây không qua "chỉ cấp quyền mình
    // đang có" và không chặn tự sửa, nên ai có USER:UPDATE tự gán mình vai trò QLSX được.
    if (id === actor.id && !isAdminActor(actor)) {
      throw new ForbiddenException('Bạn không thể tự sửa thuộc tính sản xuất của tài khoản mình');
    }
    if (!isAdminActor(actor) && dto.mfgRole !== undefined && dto.mfgRole !== current.mfgRole) {
      const targetName = dto.mfgRole ? MFG_ROLE_TO_BUSINESS_ROLE[dto.mfgRole] : undefined;
      if (targetName && !current.roles.some((r) => r.role.name === targetName)) {
        const target = await this.prisma.role.findFirst({
          where: { name: targetName },
          select: { id: true },
        });
        if (target) await this.assertCanAssignRoles(actor, [target.id], 'gán vai trò sản xuất này');
      }
    }

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

    // Đợt 7: danh sách kho đổi qua lại - luôn gồm kho đang làm; mã kho phải có thật. Không gửi = giữ nguyên.
    let warehouseScopes: string[] | undefined;
    if (dto.warehouseScopes !== undefined) {
      const active = warehouseScope ?? current.warehouseScope;
      const list = [...new Set([...(active ? [active] : []), ...dto.warehouseScopes])].filter(
        Boolean,
      );
      if (list.length > 0) {
        const found = await this.prisma.warehouse.count({
          where: { code: { in: list }, isVirtual: false, deletedAt: null },
        });
        if (found !== list.length) {
          throw new BadRequestException('Danh sách kho có mã kho không tồn tại');
        }
      }
      warehouseScopes = list.length > 1 ? list : [];
    }

    if (dto.isPurchaser === false && current.isPurchaser) {
      await this.assertNoBuyerMaterials(id, 'bỏ chức năng Mua hàng');
    }

    // Xưởng chỉ có nghĩa với QLSX; đổi mfgRole khỏi QLSX thì bỏ gắn xưởng để không còn phạm vi "mồ côi".
    let workshopId: bigint | null | undefined;
    if (dto.workshopId !== undefined && dto.workshopId !== null) {
      if (effectiveMfgRole !== 'PRODUCTION_MANAGER') {
        throw new BadRequestException('Chỉ tài khoản QLSX mới được gắn xưởng');
      }
      workshopId = BigInt(dto.workshopId);
      const workshop = await this.prisma.workshop.findFirst({
        where: { id: workshopId, isActive: true },
        select: { id: true },
      });
      if (!workshop) throw new BadRequestException('Xưởng không tồn tại hoặc đã ngừng dùng');
    } else if (dto.workshopId === null) {
      workshopId = null;
    } else if (effectiveMfgRole !== 'PRODUCTION_MANAGER' && current.workshopId != null) {
      workshopId = null;
    }

    const user = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          workshopId,
          mfgRole: dto.mfgRole,
          warehouseScope,
          warehouseScopes,
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
              `Thiếu vai trò nghiệp vụ "${targetName}" - chạy seed để tạo vai trò này.`,
            );
          }
          await tx.userRole.create({ data: { userId: id, roleId: target.id } });
        }
      }

      return tx.user.findUniqueOrThrow({ where: { id }, include: userWithRolesInclude });
    });

    return this.toResponseDto(user);
  }

  async resetPassword(id: string, dto: ResetPasswordDto, actor: PrivilegeActor): Promise<void> {
    const target = await this.findOneOrThrow(id);
    // B1 16/11: đặt lại mật khẩu ADMIN = chiếm tài khoản ADMIN.
    this.assertTargetNotAdmin(actor, target, 'đặt lại mật khẩu quản trị viên');

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

  async remove(id: string, actor: PrivilegeActor): Promise<void> {
    if (id === actor.id) {
      throw new ForbiddenException('Bạn không thể tự xoá tài khoản của mình');
    }
    const target = await this.findOneOrThrow(id);
    this.assertTargetNotAdmin(actor, target, 'xoá tài khoản quản trị viên');
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
      throw new NotFoundException(`Không tìm thấy tài khoản ${dto.toUserId}`);
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

  /** B1 16/11 - xem privilege-guard.util. */
  private async assertCanAssignRoles(
    actor: PrivilegeActor,
    roleIds: string[],
    what: string,
  ): Promise<void> {
    if (isAdminActor(actor) || roleIds.length === 0) return;
    const roles = await this.prisma.role.findMany({
      where: { id: { in: roleIds } },
      select: { name: true, permissions: { select: { permission: true } } },
    });
    assertNotAdminRoleUnlessAdmin(
      actor,
      roles.map((r) => r.name),
      what,
    );
    assertCanGrantPermissions(
      actor,
      roles.flatMap((r) =>
        r.permissions.map((p) => `${p.permission.module}:${p.permission.action}`),
      ),
      what,
    );
  }

  private assertTargetNotAdmin(
    actor: PrivilegeActor,
    target: NonNullable<UserWithRoles>,
    what: string,
  ): void {
    if (isAdminActor(actor)) return;
    assertNotAdminRoleUnlessAdmin(
      actor,
      target.roles.map((r) => r.role.name),
      what,
    );
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
      throw new NotFoundException(`Không tìm thấy tài khoản ${id}`);
    }
    return user;
  }

  private toResponseDto(user: UserWithRoles): UserResponseDto {
    if (!user) {
      throw new NotFoundException('Không tìm thấy tài khoản');
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
      warehouseScopes: user.warehouseScopes ?? [],
      isPurchaser: user.isPurchaser,
      isProductPlanner: user.isProductPlanner,
      isSale: user.isSale,
      isMaterialsManager: user.isMaterialsManager,
      workshopId: user.workshopId != null ? user.workshopId.toString() : null,
      workshopName: user.workshop?.name ?? null,
    });
  }
}
