import { ApiError, http, httpPost } from '@/services/api-client';
import type { IPublicWikiPage, IPublicWikiShare } from '../types/wiki-share.types';

// Endpoint công khai (TEST-228): chỉ token link trong đường dẫn + cookie mở khoá riêng của link. 404 = không tồn tại, 410 = hết hạn / thu hồi.
const base = (token: string) => `/api/projects/public/wiki-shares/${encodeURIComponent(token)}`;

export const wikiShareKeys = {
  info: (token: string) => ['wiki-share', token] as const,
  page: (token: string, pageId: string) => ['wiki-share', token, 'page', pageId] as const,
};

/** Kết quả đọc một trang: 401 (cần mật khẩu / cookie mở khoá hết hạn) đổi thành `locked` — KHÔNG để lọt 401 ra QueryCache (App.tsx coi 401 là hết phiên → về /login). */
export type PublicPageResult = { locked: false; page: IPublicWikiPage } | { locked: true };

export const wikiShareApi = {
  /** Mỗi lần gọi thành công (đã mở khoá) server ghi một dòng nhật ký mở — chỉ gọi khi vào trang / sau khi mở khoá. */
  info: (token: string) => http<IPublicWikiShare>(base(token)),
  unlock: (token: string, password: string) => httpPost<void>(`${base(token)}/unlock`, { password }),
  page: async (token: string, pageId: string): Promise<PublicPageResult> => {
    try {
      return { locked: false, page: await http<IPublicWikiPage>(`${base(token)}/pages/${pageId}`) };
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return { locked: true };
      throw err;
    }
  },
};
