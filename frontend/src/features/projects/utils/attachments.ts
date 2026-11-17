import type { ICommentUploadTicket } from '../types/project.types';

// Tệp đính kèm bình luận việc — cùng giới hạn với server (kiểm tra phía client chỉ để báo lỗi sớm, server vẫn kiểm tra lại).
// Cùng quy tắc với tệp đính kèm chat (features/chat/utils/labels.ts + upload.ts — module khác không import chéo được).
export const MAX_COMMENT_FILES = 5;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const BLOCKED_EXT = new Set(['.exe', '.msi', '.bat', '.cmd', '.com', '.scr', '.ps1', '.vbs', '.jar', '.apk', '.dll', '.sh', '.app', '.dmg', '.pkg']);

/** Ảnh xem trực tiếp (jpg / png / webp / gif) — loại khác tính là tệp. */
export const isImageFile = (f: { type: string }) => IMAGE_TYPES.has(f.type.toLowerCase());

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Lỗi của một tệp định đính kèm (null = hợp lệ). */
export function fileProblem(f: File): string | null {
  const dot = f.name.lastIndexOf('.');
  if (dot >= 0 && BLOCKED_EXT.has(f.name.slice(dot).toLowerCase())) return `"${f.name}": không đính kèm file chạy chương trình (${f.name.slice(dot)})`;
  if (f.size === 0) return `"${f.name}": file rỗng`;
  if (isImageFile(f)) return f.size > MAX_IMAGE_BYTES ? `"${f.name}": ảnh tối đa 10 MB` : null;
  return f.size > MAX_FILE_BYTES ? `"${f.name}": file tối đa 25 MB` : null;
}

/** PUT tệp thẳng lên S3 bằng presigned URL (bucket bật CORS cho PUT từ domain app; không gửi cookie). */
export function putToS3(ticket: ICommentUploadTicket, file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', ticket.url);
    xhr.setRequestHeader('Content-Type', ticket.contentType);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Kho S3 từ chối file "${file.name}" (HTTP ${xhr.status})`)));
    xhr.onerror = () => reject(new Error(`Không tải được "${file.name}" lên kho (mạng lỗi hoặc bucket chưa bật CORS)`));
    xhr.send(file);
  });
}
