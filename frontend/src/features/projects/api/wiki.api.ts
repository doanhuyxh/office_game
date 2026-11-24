import { http, httpPost } from '@/services/api-client';
import type { IWikiCreate, IWikiPrefs, IWikiPage, IWikiSearchHit, IWikiTree, IWikiUpdate, IWikiVersion, IWikiVersionList } from '../types/wiki.types';

const base = (projectId: string) => `/api/projects/${projectId}/wiki`;
const send = <T>(method: string, url: string, body?: unknown) => http<T>(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });

/**
 * Query key sổ tay — mọi key bắt đầu `['projects', 'wiki', projectId]` nên nút "Làm mới" của trang dự án (invalidate key `projects` chứa id dự án)
 * và lệnh ghi (`wikiKeys.all(projectId)`) làm mới cả cây, trang, tìm, lịch sử.
 */
export const wikiKeys = {
  all: (projectId: string) => ['projects', 'wiki', projectId] as const,
  tree: (projectId: string) => ['projects', 'wiki', projectId, 'tree'] as const,
  page: (projectId: string, pageId: string) => ['projects', 'wiki', projectId, 'page', pageId] as const,
  search: (projectId: string, q: string) => ['projects', 'wiki', projectId, 'search', q] as const,
  versions: (projectId: string, pageId: string, page: number) => ['projects', 'wiki', projectId, 'versions', pageId, page] as const,
  version: (projectId: string, pageId: string, n: number) => ['projects', 'wiki', projectId, 'version', pageId, n] as const,
};

export const wikiApi = {
  tree: (projectId: string) => http<IWikiTree>(base(projectId)),
  updatePrefs: (projectId: string, b: Partial<IWikiPrefs>) => send<IWikiPrefs>('PUT', `${base(projectId)}/prefs`, b),
  search: (projectId: string, q: string) => http<IWikiSearchHit[]>(`${base(projectId)}/search?q=${encodeURIComponent(q)}`),
  page: (projectId: string, pageId: string) => http<IWikiPage>(`${base(projectId)}/pages/${pageId}`),
  create: (projectId: string, b: IWikiCreate) => httpPost<IWikiPage>(`${base(projectId)}/pages`, b),
  update: (projectId: string, pageId: string, b: IWikiUpdate) => send<IWikiPage>('PUT', `${base(projectId)}/pages/${pageId}`, b),
  move: (projectId: string, pageId: string, parentId: string | null, position: number) =>
    send<IWikiPage>('PUT', `${base(projectId)}/pages/${pageId}/move`, { parentId, position }),
  versions: (projectId: string, pageId: string, page: number, pageSize: number) =>
    http<IWikiVersionList>(`${base(projectId)}/pages/${pageId}/versions?page=${page}&pageSize=${pageSize}`),
  version: (projectId: string, pageId: string, n: number) => http<IWikiVersion>(`${base(projectId)}/pages/${pageId}/versions/${n}`),
  restore: (projectId: string, pageId: string, n: number) => httpPost<IWikiPage>(`${base(projectId)}/pages/${pageId}/versions/${n}/restore`),
  lock: (projectId: string, pageId: string, locked: boolean) => httpPost<void>(`${base(projectId)}/pages/${pageId}/${locked ? 'lock' : 'unlock'}`),
  remove: (projectId: string, pageId: string) => send<void>('DELETE', `${base(projectId)}/pages/${pageId}`),
};
