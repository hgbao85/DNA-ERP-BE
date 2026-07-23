import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Permission } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { RoleResponseDto } from './dto/role-response.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

const roleWithPermissionsInclude = {
  permissions: { include: { permission: true } },
} as const;

type RoleWithPermissions = Awaited<ReturnType<RolesService['findRawById']>>;

@Injectable()
export class RolesService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async create(dto: CreateRoleDto): Promise<RoleResponseDto> {
    const existing = await this.prisma.role.findUnique({ where: { name: dto.name } });
    if (existing) {
      throw new ConflictException(`Role ${dto.name} already exists`);
    }

    const role = await this.prisma.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: { name: dto.name, description: dto.description },
      });

      if (dto.permissionIds?.length) {
        await tx.rolePermission.createMany({
          data: dto.permissionIds.map((permissionId) => ({ roleId: created.id, permissionId })),
        });
      }

      return tx.role.findUniqueOrThrow({
        where: { id: created.id },
        include: roleWithPermissionsInclude,
      });
    });

    return this.toResponseDto(role);
  }

  async findAll(query: PaginationQueryDto): Promise<Paginated<RoleResponseDto>> {
    const where = query.search
      ? { name: { contains: query.search, mode: 'insensitive' as const } }
      : undefined;

    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.role.findMany({ ...args, include: roleWithPermissionsInclude }),
        count: (args) => this.prisma.role.count(args),
      },
      query,
      where,
      query.sortBy ? { [query.sortBy]: query.sortOrder } : { createdAt: query.sortOrder },
    );

    return { data: result.data.map((role) => this.toResponseDto(role)), meta: result.meta };
  }

  async findOne(id: string): Promise<RoleResponseDto> {
    const role = await this.findRawById(id);
    if (!role) {
      throw new NotFoundException(`Role ${id} not found`);
    }
    return this.toResponseDto(role);
  }

  async update(id: string, dto: UpdateRoleDto): Promise<RoleResponseDto> {
    await this.findOneOrThrow(id);

    const role = await this.prisma.$transaction(async (tx) => {
      await tx.role.update({
        where: { id },
        data: { name: dto.name, description: dto.description },
      });

      if (dto.permissionIds) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        if (dto.permissionIds.length) {
          await tx.rolePermission.createMany({
            data: dto.permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
          });
        }
      }

      return tx.role.findUniqueOrThrow({ where: { id }, include: roleWithPermissionsInclude });
    });

    return this.toResponseDto(role);
  }

  async remove(id: string): Promise<void> {
    await this.findOneOrThrow(id);
    await this.prisma.role.delete({ where: { id } });
  }

  async listAllPermissions(): Promise<Permission[]> {
    return this.prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { action: 'asc' }] });
  }

  private async findRawById(id: string) {
    return this.prisma.role.findUnique({ where: { id }, include: roleWithPermissionsInclude });
  }

  private async findOneOrThrow(id: string) {
    const role = await this.findRawById(id);
    if (!role) {
      throw new NotFoundException(`Role ${id} not found`);
    }
    return role;
  }

  private toResponseDto(role: RoleWithPermissions): RoleResponseDto {
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    return new RoleResponseDto({
      id: role.id,
      name: role.name,
      description: role.description,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
      permissions: role.permissions.map((p) => ({
        id: p.permission.id,
        module: p.permission.module,
        action: p.permission.action,
      })),
    });
  }
}
