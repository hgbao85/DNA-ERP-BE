import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Permission } from '../../generated/prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { paginate } from '../../common/utils/paginate.util';
import { sortOrderBy } from '../../common/utils/sort-order-by.util';
import {
  PrivilegeActor,
  assertCanGrantPermissions,
  assertNotAdminRoleUnlessAdmin,
  assertNotRenamingSystemRole,
  isAdminActor,
} from '../../common/utils/privilege-guard.util';
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

  async create(dto: CreateRoleDto, actor: PrivilegeActor): Promise<RoleResponseDto> {
    assertNotAdminRoleUnlessAdmin(actor, [dto.name], 'tạo vai trò ADMIN');
    await this.assertCanGrant(actor, dto.permissionIds ?? [], 'tạo vai trò với quyền này');
    const existing = await this.prisma.role.findUnique({ where: { name: dto.name } });
    if (existing) {
      throw new ConflictException(`Vai trò ${dto.name} đã tồn tại`);
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
      sortOrderBy(query, ['id', 'name', 'createdAt', 'updatedAt'], { createdAt: query.sortOrder }),
    );

    return { data: result.data.map((role) => this.toResponseDto(role)), meta: result.meta };
  }

  async findOne(id: string): Promise<RoleResponseDto> {
    const role = await this.findRawById(id);
    if (!role) {
      throw new NotFoundException(`Không tìm thấy vai trò ${id}`);
    }
    return this.toResponseDto(role);
  }

  async update(id: string, dto: UpdateRoleDto, actor: PrivilegeActor): Promise<RoleResponseDto> {
    const current = await this.findOneOrThrow(id);
    // B1 16/11: không phải ADMIN thì không sửa vai trò ADMIN, không đổi tên vai trò khác thành ADMIN, và chỉ THÊM được quyền
    // mình đang có (quyền vai trò đã có giữ nguyên được - FE luôn gửi cả danh sách).
    assertNotAdminRoleUnlessAdmin(actor, [current.name, dto.name ?? ''], 'sửa vai trò ADMIN');
    assertNotRenamingSystemRole(actor, current.name, dto.name);
    if (dto.permissionIds) {
      const had = new Set(current.permissions.map((p) => p.permissionId));
      await this.assertCanGrant(
        actor,
        dto.permissionIds.filter((p) => !had.has(p)),
        'thêm quyền này vào vai trò',
      );
    }

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

  async remove(id: string, actor: PrivilegeActor): Promise<void> {
    const current = await this.findOneOrThrow(id);
    assertNotAdminRoleUnlessAdmin(actor, [current.name], 'xoá vai trò ADMIN');
    await this.prisma.role.delete({ where: { id } });
  }

  async listAllPermissions(): Promise<Permission[]> {
    return this.prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { action: 'asc' }] });
  }

  /** B1 16/11 - xem privilege-guard.util. */
  private async assertCanGrant(
    actor: PrivilegeActor,
    permissionIds: string[],
    what: string,
  ): Promise<void> {
    if (isAdminActor(actor) || permissionIds.length === 0) return;
    const perms = await this.prisma.permission.findMany({
      where: { id: { in: permissionIds } },
      select: { module: true, action: true },
    });
    assertCanGrantPermissions(
      actor,
      perms.map((p) => `${p.module}:${p.action}`),
      what,
    );
  }

  private async findRawById(id: string) {
    return this.prisma.role.findUnique({ where: { id }, include: roleWithPermissionsInclude });
  }

  private async findOneOrThrow(id: string) {
    const role = await this.findRawById(id);
    if (!role) {
      throw new NotFoundException(`Không tìm thấy vai trò ${id}`);
    }
    return role;
  }

  private toResponseDto(role: RoleWithPermissions): RoleResponseDto {
    if (!role) {
      throw new NotFoundException('Không tìm thấy vai trò');
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
