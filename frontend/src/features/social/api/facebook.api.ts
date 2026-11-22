import { http, httpPost, pageQs } from '@/services/api-client';
import type { IPaged, IPageQuery } from '@/types/api';
import type {
  IFacebookMedia, IFacebookPage, IFacebookPageDetail, IFacebookPagePost, IFacebookPost, IFacebookPostRequest, FacebookMediaKind,
} from '../types/facebook.types';

/** Facebook (Fanpage của BM) — mỗi nền tảng một tiền tố API (TEST-207). */
const base = '/api/assets/social/facebook';

export const facebookKeys = {
  all: ['social', 'facebook'] as const,
  pages: ['social', 'facebook', 'pages'] as const,
  posts: (q: IPageQuery) => ['social', 'facebook', 'posts', q] as const,
  mediaUrl: (id: string) => ['social', 'facebook', 'media-url', id] as const,
  page: (id: string) => ['social', 'facebook', 'page', id] as const,
  pagePosts: (id: string, q: IPageQuery, deleted = false) => ['social', 'facebook', 'page', id, 'posts', deleted, q] as const,
};

export const facebookApi = {
  pages: () => http<IFacebookPage[]>(`${base}/pages`),
  posts: (q: IPageQuery) => http<IPaged<IFacebookPost>>(`${base}/posts?${pageQs(q)}`),
  create: (body: IFacebookPostRequest) => httpPost<IFacebookPost>(`${base}/posts`, body),
  /** Sửa bài đã hẹn còn chờ (TEST-208): 409 = đã / đang gửi đi, không sửa được nữa. */
  update: (id: string, body: IFacebookPostRequest) => http<IFacebookPost>(`${base}/posts/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  cancel: (id: string) => httpPost<IFacebookPost>(`${base}/posts/${id}/cancel`),
  retry: (targetId: string) => httpPost<IFacebookPost>(`${base}/targets/${targetId}/retry`),
  mediaUrl: (id: string) => http<{ url: string }>(`${base}/media/${id}/url`),
  /** Chi tiết Fanpage + bài đồng bộ từ Facebook (TEST-206): HR / người giữ BM; người khác 404. */
  page: (id: string) => http<IFacebookPageDetail>(`${base}/pages/${id}`),
  /** `deleted` = chỉ bài đã xoá trên Facebook từ OfficeHub (TEST-211); mặc định bỏ bài đã xoá. */
  pagePosts: (id: string, q: IPageQuery, deleted = false) =>
    http<IPaged<IFacebookPagePost>>(`${base}/pages/${id}/posts?${pageQs(q)}${deleted ? '&deleted=true' : ''}`),
  syncPosts: (id: string) => httpPost<IFacebookPageDetail>(`${base}/pages/${id}/sync-posts`),
  /** Ẩn / hiện lại / xoá bài trên Facebook (TEST-211): 409 = Facebook từ chối / token lỗi / bài đã xoá (kèm lý do). */
  hidePagePost: (id: string, postId: string) => httpPost<IFacebookPagePost>(`${base}/pages/${id}/posts/${postId}/hide`),
  unhidePagePost: (id: string, postId: string) => httpPost<IFacebookPagePost>(`${base}/pages/${id}/posts/${postId}/unhide`),
  deletePagePost: (id: string, postId: string) => http<IFacebookPagePost>(`${base}/pages/${id}/posts/${postId}`, { method: 'DELETE' }),
  /** Xin link → trình duyệt PUT thẳng lên S3 (đúng Content-Type) → xác nhận. */
  upload: async (file: File) => {
    const t = await httpPost<{ id: string; uploadUrl: string; contentType: string; kind: FacebookMediaKind }>(`${base}/media`, { fileName: file.name, size: file.size });
    const put = await fetch(t.uploadUrl, { method: 'PUT', headers: { 'Content-Type': t.contentType }, body: file });
    if (!put.ok) throw new Error(`Tải "${file.name}" lên kho thất bại (${put.status})`);
    return httpPost<IFacebookMedia>(`${base}/media/${t.id}/confirm`, {});
  },
};
