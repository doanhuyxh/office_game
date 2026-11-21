import { http, httpPost, pageQs } from '@/services/api-client';
import type { IPaged, IPageQuery } from '@/types/api';
import type { IFacebookMedia, IFacebookPage, IFacebookPost, IFacebookPostRequest, FacebookMediaKind } from '../types/facebook.types';

/** Facebook (Fanpage của BM) — mỗi nền tảng một tiền tố API (TEST-207). */
const base = '/api/assets/social/facebook';

export const facebookKeys = {
  all: ['social', 'facebook'] as const,
  pages: ['social', 'facebook', 'pages'] as const,
  posts: (q: IPageQuery) => ['social', 'facebook', 'posts', q] as const,
  mediaUrl: (id: string) => ['social', 'facebook', 'media-url', id] as const,
};

export const facebookApi = {
  pages: () => http<IFacebookPage[]>(`${base}/pages`),
  posts: (q: IPageQuery) => http<IPaged<IFacebookPost>>(`${base}/posts?${pageQs(q)}`),
  create: (body: IFacebookPostRequest) => httpPost<IFacebookPost>(`${base}/posts`, body),
  cancel: (id: string) => httpPost<IFacebookPost>(`${base}/posts/${id}/cancel`),
  retry: (targetId: string) => httpPost<IFacebookPost>(`${base}/targets/${targetId}/retry`),
  mediaUrl: (id: string) => http<{ url: string }>(`${base}/media/${id}/url`),
  /** Xin link → trình duyệt PUT thẳng lên S3 (đúng Content-Type) → xác nhận. */
  upload: async (file: File) => {
    const t = await httpPost<{ id: string; uploadUrl: string; contentType: string; kind: FacebookMediaKind }>(`${base}/media`, { fileName: file.name, size: file.size });
    const put = await fetch(t.uploadUrl, { method: 'PUT', headers: { 'Content-Type': t.contentType }, body: file });
    if (!put.ok) throw new Error(`Tải "${file.name}" lên kho thất bại (${put.status})`);
    return httpPost<IFacebookMedia>(`${base}/media/${t.id}/confirm`, {});
  },
};
