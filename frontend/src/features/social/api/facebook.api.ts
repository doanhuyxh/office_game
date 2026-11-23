import { http, httpPost, pageQs } from '@/services/api-client';
import type { IPaged, IPageQuery } from '@/types/api';
import type {
  IFacebookCommentList, IFacebookMedia, IFacebookPage, IFacebookPageDetail, IFacebookPagePost, IFacebookPost, IFacebookPostCounts, IFacebookPostRequest, IFacebookReplyResult,
  FacebookMediaKind,
} from '../types/facebook.types';

/** Facebook (Fanpage của BM) — mỗi nền tảng một tiền tố API (TEST-207). */
const base = '/api/assets/social/facebook';

export const facebookKeys = {
  all: ['social', 'facebook'] as const,
  pages: ['social', 'facebook', 'pages'] as const,
  posts: (q: IPageQuery, deleted = false) => ['social', 'facebook', 'posts', deleted, q] as const,
  postCounts: ['social', 'facebook', 'post-counts'] as const,
  mediaUrl: (id: string) => ['social', 'facebook', 'media-url', id] as const,
  page: (id: string) => ['social', 'facebook', 'page', id] as const,
  pagePosts: (id: string, q: IPageQuery, deleted = false) => ['social', 'facebook', 'page', id, 'posts', deleted, q] as const,
  /** Bình luận (TEST-212) — không nằm dưới `all` để làm mới danh sách bài không tải lại bình luận từ Facebook. */
  comments: (pageId: string, postId: string) => ['social-comments', 'facebook', pageId, postId] as const,
  replies: (pageId: string, postId: string, commentId: string) => ['social-comments', 'facebook', pageId, postId, commentId] as const,
};

const afterQs = (after: string | null) => (after ? `?after=${encodeURIComponent(after)}` : '');

export const facebookApi = {
  pages: () => http<IFacebookPage[]>(`${base}/pages`),
  /** `deleted` = chỉ bài đã xoá khỏi danh sách OfficeHub (TEST-214, HR / Quản trị viên — người khác 403); mặc định bỏ bài đã xoá. */
  posts: (q: IPageQuery, deleted = false) => http<IPaged<IFacebookPost>>(`${base}/posts?${pageQs(q)}${deleted ? '&deleted=true' : ''}`),
  /** Số bài đã xoá cho bộ lọc "Đã xoá (N)" — chỉ HR / Quản trị viên. */
  postCounts: () => http<IFacebookPostCounts>(`${base}/posts/counts`),
  /** Xoá mềm (TEST-214): chỉ gỡ khỏi danh sách OfficeHub, không gọi Facebook. 409 = còn trang chờ đăng; 403 = không phải người đăng / HR. */
  remove: (id: string) => http<IFacebookPost>(`${base}/posts/${id}`, { method: 'DELETE' }),
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
  /** Bình luận cấp 1 của bài, mới nhất trước, 25 / lượt — lấy thẳng từ Facebook (TEST-212). 404 = bài không còn; 502 = không gọi được Facebook. */
  comments: (id: string, postId: string, after: string | null) =>
    http<IFacebookCommentList>(`${base}/pages/${id}/posts/${postId}/comments${afterQs(after)}`),
  /** Trả lời của một bình luận, cũ nhất trước. */
  replies: (id: string, postId: string, commentId: string, after: string | null) =>
    http<IFacebookCommentList>(`${base}/pages/${id}/posts/${postId}/comments/${commentId}/replies${afterQs(after)}`),
  /** Trả lời dưới tên Trang: 409 = token thiếu quyền / lỗi; 404 = bình luận đã xoá; bấm trùng 30 giây → trả lại trả lời cũ. */
  reply: (id: string, postId: string, commentId: string, message: string) =>
    httpPost<IFacebookReplyResult>(`${base}/pages/${id}/posts/${postId}/comments/${commentId}/replies`, { message }),
  /** Xin link → trình duyệt PUT thẳng lên S3 (đúng Content-Type) → xác nhận. */
  upload: async (file: File) => {
    const t = await httpPost<{ id: string; uploadUrl: string; contentType: string; kind: FacebookMediaKind }>(`${base}/media`, { fileName: file.name, size: file.size });
    const put = await fetch(t.uploadUrl, { method: 'PUT', headers: { 'Content-Type': t.contentType }, body: file });
    if (!put.ok) throw new Error(`Tải "${file.name}" lên kho thất bại (${put.status})`);
    return httpPost<IFacebookMedia>(`${base}/media/${t.id}/confirm`, {});
  },
};
