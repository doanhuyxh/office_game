import { addDays, formatDate, todayVn, toVnDate } from '@/utils/date';
import type { IMessage } from '../types/chat.types';

export const MAX_TEXT = 1000;
export const MAX_FILES = 5;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

// Cùng danh sách chặn ở server (kiểm tra phía client chỉ để báo nhanh).
const BLOCKED_EXT = new Set(['.exe', '.msi', '.bat', '.cmd', '.com', '.scr', '.ps1', '.vbs', '.jar', '.apk', '.dll', '.sh', '.app', '.dmg', '.pkg']);

export const isImageFile = (f: { type: string }) => f.type.startsWith('image/');

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Lỗi của một tệp định đính kèm (null = hợp lệ). */
export function fileProblem(f: File): string | null {
  const dot = f.name.lastIndexOf('.');
  if (dot >= 0 && BLOCKED_EXT.has(f.name.slice(dot).toLowerCase())) return `"${f.name}": không gửi file chạy chương trình (${f.name.slice(dot)})`;
  if (f.size === 0) return `"${f.name}": file rỗng`;
  if (isImageFile(f)) return f.size > MAX_IMAGE_BYTES ? `"${f.name}": ảnh tối đa 10 MB` : null;
  return f.size > MAX_FILE_BYTES ? `"${f.name}": file tối đa 25 MB` : null;
}

/** Dòng xem trước (danh sách hội thoại) của một tin. */
export function previewOf(m: Pick<IMessage, 'text' | 'deleted' | 'attachments'>): string {
  if (m.deleted) return 'Tin nhắn đã thu hồi';
  if (m.text) return m.text;
  const a = m.attachments[0];
  if (!a) return '';
  const more = m.attachments.length > 1 ? ` (+${m.attachments.length - 1})` : '';
  return a.isImage ? `Ảnh${more}` : `Tệp: ${a.fileName}${more}`;
}

/** Nhãn ngày của dải phân cách: Hôm nay / Hôm qua / dd/MM/yyyy. */
export function dayLabel(iso: string): string {
  const d = toVnDate(iso);
  const today = todayVn();
  if (d === today) return 'Hôm nay';
  if (d === addDays(today, -1)) return 'Hôm qua';
  return formatDate(iso);
}

export const dayKey = (iso: string) => toVnDate(iso);

/** Bỏ dấu + hạ chữ thường để tìm không dấu. */
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
