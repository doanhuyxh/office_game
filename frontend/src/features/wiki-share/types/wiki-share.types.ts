/** Trang sổ tay chia sẻ công khai (TEST-228 / TEST-229) — khớp DTO công khai của `Features/WikiShareEndpoints.cs`. Thời điểm là UTC `…Z`. */

export interface IPublicWikiShareNode { id: string; parentId: string | null; title: string }
/** `locked` = cần mật khẩu mà chưa mở khoá → `pages` rỗng, `rootPageId` null. `notSharedHref` = href đánh dấu link tới trang ngoài bản chia sẻ. */
export interface IPublicWikiShare {
  projectName: string; rootPageId: string | null; pages: IPublicWikiShareNode[]; expiresAt: string; recipientName: string | null;
  requiresPassword: boolean; locked: boolean; notSharedHref: string;
}
export interface IPublicWikiCrumb { id: string; title: string }
/** `content` đã đổi link: trang trong bản chia sẻ → `/s/{token}?page={id}`, trang ngoài → `notSharedHref`. */
export interface IPublicWikiPage { id: string; parentId: string | null; title: string; summary: string | null; content: string; updatedAt: string; path: IPublicWikiCrumb[] }
