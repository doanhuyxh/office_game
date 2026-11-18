import { http, httpPost } from '@/services/api-client';
import type { ICommentUploadTicket } from '@/features/projects';
import type { IPublicUploadDone, IPublicUploadLink } from '../types/upload-link.types';

// Endpoint công khai (TEST-175): chỉ token link trong đường dẫn, không cần đăng nhập. 404 = link không tồn tại, 410 = hết hạn / thu hồi.
const base = (token: string) => `/api/projects/public/upload-links/${encodeURIComponent(token)}`;

export const uploadLinkKeys = { info: (token: string) => ['upload-link', token] as const };

export const uploadLinkApi = {
  info: (token: string) => http<IPublicUploadLink>(base(token)),
  /** Xin vé presigned PUT cho một tệp (rồi `putToS3`). */
  createUpload: (token: string, file: File) => httpPost<ICommentUploadTicket>(`${base(token)}/uploads`, { fileName: file.name, size: file.size }),
  /** Đăng một bình luận gồm các tệp đã PUT + ghi chú tuỳ chọn. */
  post: (token: string, content: string, uploadIds: string[]) => httpPost<IPublicUploadDone>(`${base(token)}/comments`, { content, uploadIds }),
};
