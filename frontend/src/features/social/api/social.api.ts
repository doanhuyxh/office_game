import { http, httpPost, pageQs } from '@/services/api-client';
import type { IPaged, IPageQuery } from '@/types/api';
import type { ISocialMedia, ISocialPage, ISocialPost, ISocialPostRequest, SocialMediaKind } from '../types/social.types';

const base = '/api/assets/social';

export const socialKeys = {
  all: ['social'] as const,
  pages: ['social', 'pages'] as const,
  posts: (q: IPageQuery) => ['social', 'posts', q] as const,
  mediaUrl: (id: string) => ['social', 'media-url', id] as const,
};

export const socialApi = {
  pages: () => http<ISocialPage[]>(`${base}/pages`),
  posts: (q: IPageQuery) => http<IPaged<ISocialPost>>(`${base}/posts?${pageQs(q)}`),
  create: (body: ISocialPostRequest) => httpPost<ISocialPost>(`${base}/posts`, body),
  cancel: (id: string) => httpPost<ISocialPost>(`${base}/posts/${id}/cancel`),
  retry: (targetId: string) => httpPost<ISocialPost>(`${base}/targets/${targetId}/retry`),
  mediaUrl: (id: string) => http<{ url: string }>(`${base}/media/${id}/url`),
  /** Xin link → trình duyệt PUT thẳng lên S3 (đúng Content-Type) → xác nhận. */
  upload: async (file: File) => {
    const t = await httpPost<{ id: string; uploadUrl: string; contentType: string; kind: SocialMediaKind }>(`${base}/media`, { fileName: file.name, size: file.size });
    const put = await fetch(t.uploadUrl, { method: 'PUT', headers: { 'Content-Type': t.contentType }, body: file });
    if (!put.ok) throw new Error(`Tải "${file.name}" lên kho thất bại (${put.status})`);
    return httpPost<ISocialMedia>(`${base}/media/${t.id}/confirm`, {});
  },
};
