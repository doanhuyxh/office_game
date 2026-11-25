/** Chia sẻ công khai trang sổ tay (TEST-228 / TEST-229) — khớp DTO `Features/WikiShareEndpoints.cs`. Thời điểm là UTC `…Z`. */

/** active = còn hiệu lực; expired = hết hạn; revoked = đã thu hồi; gone = mọi trang được chọn đã xoá / dự án đóng. */
export type WikiShareStatus = 'active' | 'expired' | 'revoked' | 'gone';
/** Phạm vi link (TEST-230): toàn bộ sổ tay (kể cả trang tạo sau) hoặc các trang được chọn. */
export type WikiShareScope = 'all' | 'pages';
/** Trang được chọn; `includeChildren` = kèm cả cây con (gồm trang con tạo sau); `deleted` = trang đã bị xoá. */
export interface IWikiSharePage { id: string; title: string; includeChildren: boolean; deleted: boolean }

/** `pageCount` = số trang được chọn (phạm vi all = 0); `pages` theo thứ tự sổ tay, trang đã xoá cuối. */
export interface IWikiShare {
  id: string; scope: WikiShareScope; pageCount: number; pages: IWikiSharePage[]; label: string | null; recipientName: string | null; hasPassword: boolean;
  expiresAt: string; revokedAt: string | null; revokedByName: string | null; createdAt: string; createdByName: string; viewCount: number;
  lastViewedAt: string | null; status: WikiShareStatus;
}
/** `token` chỉ có MỘT lần lúc tạo (server giữ hash) — FE dựng URL `/s/{token}`. */
export interface IWikiShareCreated { id: string; token: string; expiresAt: string; share: IWikiShare }
/** `pages` bắt buộc khi scope = pages (1–200 trang, không trùng). `days` 1 / 7 / 30 hoặc `expiresOn` (yyyy-MM-dd, ≤ 90 ngày) — không gửi cả hai. */
export interface IWikiShareCreate {
  scope: WikiShareScope; pages: { pageId: string; includeChildren: boolean }[]; days?: number | null; expiresOn?: string | null; label?: string | null; recipientName?: string | null; password?: string | null;
}
export interface IWikiShareView { at: string; ip: string | null; userAgent: string | null }
export interface IWikiShareViewList { items: IWikiShareView[]; total: number; page: number; pageSize: number }
