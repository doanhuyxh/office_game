export type AccessTokenStatus = 'Active' | 'Expired' | 'Revoked';

/** Khớp AccessTokenDto (back-end Identity). */
export interface IAccessToken {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  status: AccessTokenStatus;
}

export interface ICreateAccessToken {
  name: string;
  expiresInDays: number;
}

/** `token` chỉ trả về MỘT lần lúc tạo. */
export interface IAccessTokenCreated {
  accessToken: IAccessToken;
  token: string;
}
