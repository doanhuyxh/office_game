import { http, httpPost } from '@/services/api-client';
import type { IWikiShare, IWikiShareCreate, IWikiShareCreated, IWikiShareViewList } from '../types/wiki-share.types';

const base = (projectId: string) => `/api/projects/${projectId}/wiki/shares`;

/** Key nằm dưới `['projects', 'wiki', projectId]` → nút "Làm mới" của trang dự án + lệnh ghi sổ tay cũng làm mới danh sách link. */
export const wikiShareKeys = {
  all: (projectId: string) => ['projects', 'wiki', projectId, 'shares'] as const,
  list: (projectId: string, pageId: string | null) => ['projects', 'wiki', projectId, 'shares', 'list', pageId ?? 'all'] as const,
  views: (projectId: string, shareId: string, page: number) => ['projects', 'wiki', projectId, 'shares', 'views', shareId, page] as const,
};

/** URL công khai của link (route `/s/$token`). */
export const wikiShareUrl = (token: string) => `${window.location.origin}/s/${token}`;

export const wikiShareApi = {
  /** `pageId` → chỉ link có chứa trang đó (kể cả qua "kèm con" / toàn bộ sổ tay); null → mọi link của dự án. */
  list: (projectId: string, pageId: string | null) => http<IWikiShare[]>(pageId ? `${base(projectId)}?pageId=${pageId}` : base(projectId)),
  create: (projectId: string, b: IWikiShareCreate) => httpPost<IWikiShareCreated>(base(projectId), b),
  revoke: (projectId: string, shareId: string) => http<void>(`${base(projectId)}/${shareId}`, { method: 'DELETE' }),
  views: (projectId: string, shareId: string, page: number, pageSize: number) =>
    http<IWikiShareViewList>(`${base(projectId)}/${shareId}/views?page=${page}&pageSize=${pageSize}`),
};
