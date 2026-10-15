export interface JwtPayload {
  sub: string;
  username: string;
  email: string | null;
  roles: string[];
  /** Flattened "MODULE:ACTION" strings, e.g. "USER:CREATE" */
  permissions: string[];
  /** Business attributes read by @RequireMfgRole/@RequireWarehouseScope, not by PermissionsGuard. */
  mfgRole: string | null;
  warehouseScope: string | null;
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  email: string | null;
  roles: string[];
  permissions: string[];
  mfgRole: string | null;
  warehouseScope: string | null;
}
