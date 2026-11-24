/** Sổ tay dự án (wiki, TEST-215 / TEST-217) — khớp DTO `Features/WikiEndpoints.cs`. Thời điểm là UTC `…Z`. */

/** Một trang trong cây (không kèm nội dung). */
export interface IWikiTreeItem {
  id: string; parentId: string | null; title: string; summary: string | null; position: number; version: number; locked: boolean;
  updatedAt: string; updatedByName: string; updatedByBot: boolean; contentLength: number;
}
/** Cây trang + cờ quyền của người gọi (back-end tính — FE chỉ dùng để hiện nút). */
export interface IWikiTree { pages: IWikiTreeItem[]; canEdit: boolean; canManage: boolean; maxPages: number; maxDepth: number; maxContent: number; prefs: IWikiPrefs }
/** Vị trí mục lục: cột trái (dưới cây trang) hoặc cột phải. */
export type WikiTocSide = 'left' | 'right';
/** Tuỳ chọn giao diện của CHÍNH người xem ở dự án này (lưu ở server theo tài khoản + dự án). */
export interface IWikiPrefs { tocSide: WikiTocSide; tocCollapsed: boolean }
export interface IWikiCrumb { id: string; title: string }
/** Trang đầy đủ; `canEdit` đã xét trang khoá / dự án đóng; `path` = các trang cha từ gốc. */
export interface IWikiPage {
  id: string; projectId: string; parentId: string | null; title: string; summary: string | null; content: string; version: number; position: number;
  locked: boolean; lockedByName: string | null; lockedAt: string | null; createdAt: string; createdByName: string; createdByBot: boolean;
  updatedAt: string; updatedByName: string; updatedByBot: boolean; canEdit: boolean; canManage: boolean; path: IWikiCrumb[];
}
export interface IWikiSearchHit { id: string; parentId: string | null; title: string; summary: string | null; snippet: string; version: number; updatedAt: string }
export interface IWikiVersionItem { version: number; title: string; summary: string | null; editedAt: string; editedByName: string; editedByBot: boolean; note: string | null; contentLength: number }
export interface IWikiVersionList { items: IWikiVersionItem[]; total: number; page: number; pageSize: number }
export interface IWikiVersion { pageId: string; version: number; title: string; summary: string | null; content: string; editedAt: string; editedByName: string; editedByBot: boolean; note: string | null }

export interface IWikiCreate { title: string; summary?: string | null; content?: string | null; parentId?: string | null; note?: string | null }
/** null = giữ nguyên; `summary: ""` = xoá tóm tắt. */
export interface IWikiUpdate { baseVersion: number; title?: string | null; summary?: string | null; content?: string | null; note?: string | null }
/** 409 sửa đồng thời: phần mở rộng ProblemDetails (người / phiên bản mới nhất). */
export interface IWikiConflict { version: number; updatedByName: string; updatedAt: string; updatedByBot: boolean }
