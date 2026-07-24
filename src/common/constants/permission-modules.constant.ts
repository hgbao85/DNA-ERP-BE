/**
 * Registry of module names usable in Permission.module.
 * `module` is a plain string column (not a DB enum) so future ERP modules
 * (INVENTORY, PURCHASE, PRODUCTION, ...) can register permissions without a migration.
 * Add new modules here to keep them centrally documented and typo-free.
 */
export const PERMISSION_MODULES = {
  USER: 'USER',
  ROLE: 'ROLE',
  PERMISSION: 'PERMISSION',
  AUDIT_LOG: 'AUDIT_LOG',
  NOTIFICATION: 'NOTIFICATION',
  SYSTEM_CONFIG: 'SYSTEM_CONFIG',
} as const;

export type PermissionModule = (typeof PERMISSION_MODULES)[keyof typeof PERMISSION_MODULES];
