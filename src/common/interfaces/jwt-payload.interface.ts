export interface JwtPayload {
  sub: string;
  email: string;
  roles: string[];
  /** Flattened "MODULE:ACTION" strings, e.g. "USER:CREATE" */
  permissions: string[];
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
}
