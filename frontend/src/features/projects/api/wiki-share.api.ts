import { http, httpPost } from '@/services/api-client';
import type { IWikiShare, IWikiShareCreate, IWikiShareCreated, IWikiShareViewList } from '../types/wiki-share.types';

const base = (projectId: string) => `/api/projects/${projectId}/wiki/shares`;

/** Key nằm dưới `['projects', 'wiki', projectId]` → nút "Làm mới" của trang dự án + lệnh ghi sổ tay cũng làm mới danh sách link. */
export const wikiShareKeys = {
  all: (projectId: string) => ['projects', 'wiki', projectId, 'shares'] as const,
  list: (projectId: string, pageId: string) => ['projects', 'wiki', projectId, 'shares', 'list', pageId] as const,
  views: (projectId: string, shareId: string, page: number) => ['projects', 'wiki', projectId, 'shares', 'views', shareId, page] as const,
};

/** URL công khai của link (route `/s/$token`). */
export const wikiShareUrl = (token: string) => `${window.location.origin}/s/${token}`;

export const wikiShareApi = {
  list: (projectId: string, pageId: string) => http<IWikiShare[]>(`${base(projectId)}?pageId=${pageId}`),
  create: (projectId: string, b: IWikiShareCreate) => httpPost<IWikiShareCreated>(base(projectId), b),
  revoke: (projectId: string, shareId: string) => http<void>(`${base(projectId)}/${shareId}`, { method: 'DELETE' }),
  views: (projectId: string, shareId: string, page: number, pageSize: number) =>
    http<IWikiShareViewList>(`${base(projectId)}/${shareId}/views?page=${page}&pageSize=${pageSize}`),
};
