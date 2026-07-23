import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
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
  Awaited<ReturnType<UsersService['findAuthProfileByEmail']>>
>;

@Injectable()
export class UsersService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async create(dto: CreateUserDto): Promise<UserResponseDto> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException(`Email ${dto.email} is already in use`);
    }

    const hashedPassword = await argon2.hash(dto.password);

    // Transactional pattern: creating the user and assigning roles must succeed
    // or fail together. Future ERP modules (stock ledger, purchasing, etc.)
    // should follow this same $transaction shape for multi-step writes.
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
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

  async update(id: string, dto: UpdateUserDto): Promise<UserResponseDto> {
    await this.findOneOrThrow(id);

    const user = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
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

  async remove(id: string): Promise<void> {
    await this.findOneOrThrow(id);
    // Soft delete: the Prisma extension rewrites this into an UPDATE setting deletedAt.
    await this.prisma.user.delete({ where: { id } });
  }

  /** Used by AuthService to validate credentials without exposing the password hash elsewhere. */
  async findAuthProfileByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
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
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      roles: user.roles.map((r) => r.role.name),
    });
  }
}
