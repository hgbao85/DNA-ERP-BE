import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { RolesService } from './roles.service';

describe('RolesService', () => {
  let service: RolesService;
  let prisma: {
    role: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    rolePermission: { createMany: jest.Mock; deleteMany: jest.Mock };
    permission: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const roleWithPermissions = {
    id: 'role-1',
    name: 'WAREHOUSE_STAFF',
    description: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    permissions: [
      { permission: { id: 'perm-1', module: 'SKU', action: 'VIEW' } },
      { permission: { id: 'perm-2', module: 'SKU', action: 'UPDATE' } },
    ],
  };

  beforeEach(() => {
    prisma = {
      role: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      rolePermission: { createMany: jest.fn(), deleteMany: jest.fn() },
      permission: { findMany: jest.fn() },
      // Run the callback synchronously against the same mock, mirroring users.service.spec.
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };

    service = new RolesService(prisma as unknown as PrismaServiceType);
  });

  describe('create', () => {
    it('rejects a duplicate role name with 409, never opens a transaction', async () => {
      prisma.role.findUnique.mockResolvedValue(roleWithPermissions);

      await expect(service.create({ name: 'WAREHOUSE_STAFF' } as any)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('creates the role and attaches every requested permission in the same transaction', async () => {
      prisma.role.findUnique.mockResolvedValue(null);
      prisma.role.create.mockResolvedValue({ id: 'role-1' });
      prisma.role.findUniqueOrThrow.mockResolvedValue(roleWithPermissions);

      const result = await service.create({
        name: 'WAREHOUSE_STAFF',
        permissionIds: ['perm-1', 'perm-2'],
      });

      expect(prisma.rolePermission.createMany).toHaveBeenCalledWith({
        data: [
          { roleId: 'role-1', permissionId: 'perm-1' },
          { roleId: 'role-1', permissionId: 'perm-2' },
        ],
      });
      expect(result.permissions).toEqual([
        { id: 'perm-1', module: 'SKU', action: 'VIEW' },
        { id: 'perm-2', module: 'SKU', action: 'UPDATE' },
      ]);
    });

    it('creates a permission-less role without touching rolePermission', async () => {
      prisma.role.findUnique.mockResolvedValue(null);
      prisma.role.create.mockResolvedValue({ id: 'role-1' });
      prisma.role.findUniqueOrThrow.mockResolvedValue({ ...roleWithPermissions, permissions: [] });

      await service.create({ name: 'WAREHOUSE_STAFF' });

      expect(prisma.rolePermission.createMany).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws 404 when the role does not exist', async () => {
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });

    it('maps junction rows down to flat permission summaries', async () => {
      prisma.role.findUnique.mockResolvedValue(roleWithPermissions);

      const result = await service.findOne('role-1');

      expect(result.permissions).toEqual([
        { id: 'perm-1', module: 'SKU', action: 'VIEW' },
        { id: 'perm-2', module: 'SKU', action: 'UPDATE' },
      ]);
    });
  });

  describe('update - permission replacement', () => {
    it('throws 404 and never opens a transaction when the role does not exist', async () => {
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', { name: 'X' } as any)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('replaces the permission set: deletes all existing rows then inserts the new ones', async () => {
      prisma.role.findUnique.mockResolvedValue(roleWithPermissions);
      prisma.role.findUniqueOrThrow.mockResolvedValue(roleWithPermissions);

      await service.update('role-1', { permissionIds: ['perm-3'] });

      expect(prisma.rolePermission.deleteMany).toHaveBeenCalledWith({
        where: { roleId: 'role-1' },
      });
      expect(prisma.rolePermission.createMany).toHaveBeenCalledWith({
        data: [{ roleId: 'role-1', permissionId: 'perm-3' }],
      });
    });

    it('an empty permissionIds array clears every permission (delete, but no re-insert)', async () => {
      prisma.role.findUnique.mockResolvedValue(roleWithPermissions);
      prisma.role.findUniqueOrThrow.mockResolvedValue({ ...roleWithPermissions, permissions: [] });

      await service.update('role-1', { permissionIds: [] });

      expect(prisma.rolePermission.deleteMany).toHaveBeenCalledWith({
        where: { roleId: 'role-1' },
      });
      expect(prisma.rolePermission.createMany).not.toHaveBeenCalled();
    });

    it('an omitted permissionIds leaves the existing permission rows untouched', async () => {
      prisma.role.findUnique.mockResolvedValue(roleWithPermissions);
      prisma.role.findUniqueOrThrow.mockResolvedValue(roleWithPermissions);

      await service.update('role-1', { name: 'RENAMED' });

      expect(prisma.rolePermission.deleteMany).not.toHaveBeenCalled();
      expect(prisma.rolePermission.createMany).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('throws 404 and never deletes when the role does not exist', async () => {
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
      expect(prisma.role.delete).not.toHaveBeenCalled();
    });

    it('deletes an existing role', async () => {
      prisma.role.findUnique.mockResolvedValue(roleWithPermissions);

      await service.remove('role-1');

      expect(prisma.role.delete).toHaveBeenCalledWith({ where: { id: 'role-1' } });
    });
  });

  describe('listAllPermissions', () => {
    it('lists permissions ordered by module then action', async () => {
      const permissions = [{ id: 'p1', module: 'SKU', action: 'VIEW' }];
      prisma.permission.findMany.mockResolvedValue(permissions);

      const result = await service.listAllPermissions();

      expect(prisma.permission.findMany).toHaveBeenCalledWith({
        orderBy: [{ module: 'asc' }, { action: 'asc' }],
      });
      expect(result).toBe(permissions);
    });
  });
});
