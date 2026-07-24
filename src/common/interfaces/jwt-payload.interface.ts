export interface JwtPayload {
  sub: string;
  email: string;
  roles: string[];
  /** Flattened "MODULE:ACTION" strings, e.g. "USER:CREATE" */
  permissions: string[];
  /** Business attributes read by @RequireMfgRole/@RequireWarehouseScope, not by PermissionsGuard. */
  mfgRole: string | null;
  warehouseScope: string | null;
}

export interface RefreshTokenPayload {
  sub: string;
  tokenId: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  roles: string[];
  permissions: string[];
  mfgRole: string | null;
  warehouseScope: string | null;
}
