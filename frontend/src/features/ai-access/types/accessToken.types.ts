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

/** Ứng dụng đã kết nối qua OAuth (GrantDto). */
export interface IGrant {
  id: string;
  clientName: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
  status: AccessTokenStatus;
}

/** HR: kết nối AI đang hoạt động của cả công ty (AiConnectionDto). */
export interface IAiConnection {
  kind: 'token' | 'app';
  id: string;
  userId: string;
  userName: string;
  fullName: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}

/** Một request của trợ lý AI (AiRequestDto, module Audit). */
export interface IAiRequest {
  id: string;
  occurredAt: string;
  userId: string;
  userName: string | null;
  fullName: string | null;
  clientName: string;
  viaOAuth: boolean;
  tool: string | null;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  /** IP của client AI (Mcp chuyển tiếp qua X-Forwarded-For); null = bản ghi cũ / không xác định. */
  ip?: string | null;
  /** JSON tóm tắt nội dung lệnh ghi (đã cắt + che trường nhạy cảm); chỉ có trong 7 ngày gần nhất. */
  requestSummary?: string | null;
}

export interface IAuthorizeInfo {
  clientId: string;
  clientName: string;
  redirectUri: string;
  redirectHost: string;
  clientCreatedAt: string;
}

/** Lỗi trang đồng ý: có `redirectTo` = trả lỗi về ứng dụng được. */
export interface IAuthorizeError {
  error: string;
  message: string;
  redirectTo: string | null;
}
