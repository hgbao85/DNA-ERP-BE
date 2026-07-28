import {
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
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
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
    await this.findOneOrThrow(id);

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

    // Floor roles (Phôi/Hàn/Sơn/KCS) only exist in one warehouse - force it here so the
    // invariant holds regardless of what the caller sent (or forgot to send).
    const effectiveMfgRole = dto.mfgRole !== undefined ? dto.mfgRole : current.mfgRole;
    const warehouseScope =
      effectiveMfgRole && MFG_FLOOR_ROLES.includes(effectiveMfgRole)
        ? MFG_FLOOR_WAREHOUSE_SCOPE
        : dto.warehouseScope;

    const user = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          mfgRole: dto.mfgRole,
          warehouseScope,
          isPurchaser: dto.isPurchaser,
          isProductPlanner: dto.isProductPlanner,
          isSale: dto.isSale,
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

  async remove(id: string, currentUserId: string): Promise<void> {
    if (id === currentUserId) {
      throw new ForbiddenException('You cannot delete your own account');
    }
    await this.findOneOrThrow(id);
    // Soft delete: the Prisma extension rewrites this into an UPDATE setting deletedAt.
    await this.prisma.user.delete({ where: { id } });
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
    });
  }
}
