import { http, httpPost } from '@/services/api-client';
import type {
  IComment, ICommentPage, IDepartment, IEditPostRequest, IFeed, IPerson, IPost, IPostRequest, IReactionSummary, IReactor, IUploadTicket, ReactionType,
} from '../types/news.types';

const base = '/api/news';
const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const newsKeys = {
  all: ['news'] as const,
  feed: (authorId?: string | null, mine?: boolean) => ['news', 'feed', authorId ?? null, !!mine] as const,
  post: (id: string) => ['news', 'post', id] as const,
  comments: (postId: string) => ['news', 'comments', postId] as const,
  unseen: ['news', 'unseen'] as const,
  people: (s: string) => ['news', 'people', s] as const,
  departments: ['news', 'departments'] as const,
  reactors: (kind: 'posts' | 'comments', id: string) => ['news', 'reactors', kind, id] as const,
};

export const newsApi = {
  feed: (cursor: number | null, authorId?: string | null, mine?: boolean, take = 10) =>
    http<IFeed>(`${base}/feed?take=${take}${cursor ? `&cursor=${cursor}` : ''}${authorId ? `&authorId=${authorId}` : ''}${mine ? '&mine=true' : ''}`),
  post: (id: string) => http<IPost>(`${base}/posts/${id}`),
  create: (req: IPostRequest) => httpPost<IPost>(`${base}/posts`, req),
  edit: (id: string, req: IEditPostRequest) => http<IPost>(`${base}/posts/${id}`, json('PUT', req)),
  remove: (id: string) => http<void>(`${base}/posts/${id}`, { method: 'DELETE' }),

  react: (kind: 'posts' | 'comments', id: string, type: ReactionType) => http<IReactionSummary>(`${base}/${kind}/${id}/reaction`, json('PUT', { type })),
  unreact: (kind: 'posts' | 'comments', id: string) => http<IReactionSummary>(`${base}/${kind}/${id}/reaction`, { method: 'DELETE' }),
  reactors: (kind: 'posts' | 'comments', id: string) => http<IReactor[]>(`${base}/${kind}/${id}/reactions`),

  comments: (postId: string, after?: number | null) => http<ICommentPage>(`${base}/posts/${postId}/comments?take=20${after ? `&after=${after}` : ''}`),
  addComment: (postId: string, text: string | null, parentId: string | null, uploadId: string | null) =>
    httpPost<IComment>(`${base}/posts/${postId}/comments`, { text, parentId, uploadId }),
  editComment: (id: string, text: string) => http<IComment>(`${base}/comments/${id}`, json('PUT', { text })),
  removeComment: (id: string) => http<void>(`${base}/comments/${id}`, { method: 'DELETE' }),

  upload: (file: File, forComment = false) =>
    httpPost<IUploadTicket>(`${base}/uploads`, { fileName: file.name, contentType: file.type || null, size: file.size, forComment }),
  mediaUrl: (id: string, download: boolean) => http<{ url: string }>(`${base}/media/${id}/url?download=${download}`),
  people: (search: string) => http<IPerson[]>(`${base}/people?search=${encodeURIComponent(search)}`),
  departments: () => http<IDepartment[]>(`${base}/departments`),
  unseen: () => http<{ count: number }>(`${base}/unseen-count`),
  markSeen: () => httpPost<void>(`${base}/seen`),

  // HR / admin
  hide: (kind: 'posts' | 'comments', id: string, reason: string) => httpPost<void>(`${base}/admin/${kind}/${id}/hide`, { reason }),
  unhide: (kind: 'posts' | 'comments', id: string) => httpPost<void>(`${base}/admin/${kind}/${id}/unhide`),
  pin: (id: string, days: number) => httpPost<void>(`${base}/admin/posts/${id}/pin`, { days }),
  unpin: (id: string) => httpPost<void>(`${base}/admin/posts/${id}/unpin`),
};
