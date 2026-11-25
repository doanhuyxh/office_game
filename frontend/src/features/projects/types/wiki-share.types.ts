/** Chia sẻ công khai trang sổ tay (TEST-228 / TEST-229) — khớp DTO `Features/WikiShareEndpoints.cs`. Thời điểm là UTC `…Z`. */

/** active = còn hiệu lực; expired = hết hạn; revoked = đã thu hồi; gone = trang gốc bị xoá / dự án đóng. */
export type WikiShareStatus = 'active' | 'expired' | 'revoked' | 'gone';

export interface IWikiShare {
  id: string; rootPageId: string; rootPageTitle: string; includeChildren: boolean; label: string | null; recipientName: string | null; hasPassword: boolean;
  expiresAt: string; revokedAt: string | null; revokedByName: string | null; createdAt: string; createdByName: string; viewCount: number;
  lastViewedAt: string | null; status: WikiShareStatus;
}
/** `token` chỉ có MỘT lần lúc tạo (server giữ hash) — FE dựng URL `/s/{token}`. */
export interface IWikiShareCreated { id: string; token: string; expiresAt: string; share: IWikiShare }
/** `days` 1 / 7 / 30 hoặc `expiresOn` (yyyy-MM-dd, ≤ 90 ngày) — không gửi cả hai. */
export interface IWikiShareCreate {
  pageId: string; includeChildren: boolean; days?: number | null; expiresOn?: string | null; label?: string | null; recipientName?: string | null; password?: string | null;
}
export interface IWikiShareView { at: string; ip: string | null; userAgent: string | null }
export interface IWikiShareViewList { items: IWikiShareView[]; total: number; page: number; pageSize: number }
