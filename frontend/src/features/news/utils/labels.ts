import { Building2, Globe, Lock, Users, type LucideIcon } from 'lucide-react';
import type { PostAudience, ReactionType } from '../types/news.types';

export const AUDIENCE: Record<PostAudience, { label: string; hint: string; icon: LucideIcon }> = {
  Company: { label: 'Toàn công ty', hint: 'Mọi người trong công ty', icon: Globe },
  Departments: { label: 'Phòng ban', hint: 'Chỉ thành viên các phòng ban được chọn', icon: Building2 },
  Custom: { label: 'Tuỳ chọn', hint: 'Chỉ những người được chọn', icon: Users },
  Private: { label: 'Chỉ mình tôi', hint: 'Chỉ bạn xem được', icon: Lock },
};

export const REACTIONS: { type: ReactionType; emoji: string; label: string; className: string }[] = [
  { type: 'Like', emoji: '👍', label: 'Thích', className: 'text-info' },
  { type: 'Love', emoji: '❤️', label: 'Yêu thích', className: 'text-destructive' },
  { type: 'Haha', emoji: '😆', label: 'Haha', className: 'text-warning' },
  { type: 'Wow', emoji: '😮', label: 'Wow', className: 'text-warning' },
  { type: 'Sad', emoji: '😢', label: 'Buồn', className: 'text-warning' },
  { type: 'Angry', emoji: '😡', label: 'Phẫn nộ', className: 'text-destructive' },
];
export const reactionOf = (t: ReactionType) => REACTIONS.find((r) => r.type === t)!;

export const EMOJIS = ['😀', '😄', '😂', '🥰', '😍', '😎', '🤔', '😢', '😡', '👍', '👏', '🙏', '💪', '🎉', '🎂', '🌟', '🔥', '❤️', '✅', '📢', '📌', '📅', '☕', '🍀'];

export const formatSize = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Bình luận lưu @nhắc dạng `@[Tên](guid)`. */
export const MENTION_TOKEN = /@\[([^\]\r\n]{1,100})\]\(([0-9a-fA-F-]{36})\)/g;
export const mentionToken = (name: string, userId: string) => `@[${name}](${userId})`;

export const ACCEPT_MEDIA = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime';
export const MAX_IMAGE = 10 * 1024 * 1024;
export const MAX_VIDEO = 200 * 1024 * 1024;
export const MAX_FILE = 25 * 1024 * 1024;
export const MAX_MEDIA = 10;
const BLOCKED = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|jar|apk|dll|sh|app|dmg|pkg|html?|svg)$/i;

/** Kiểm tra nhanh phía client (BE kiểm tra lại): trả thông báo lỗi hoặc null. */
export function checkFile(f: File, imageOnly = false): string | null {
  if (BLOCKED.test(f.name)) return `"${f.name}": không đăng file chạy chương trình hoặc trang web`;
  const image = /^image\/(jpeg|png|webp|gif)$/.test(f.type);
  const video = /^video\/(mp4|webm|quicktime)$/.test(f.type);
  if (imageOnly && !image) return 'Bình luận chỉ đính kèm được ảnh (jpeg, png, webp, gif)';
  const max = image ? MAX_IMAGE : video ? MAX_VIDEO : MAX_FILE;
  if (f.size <= 0) return `"${f.name}": tệp rỗng`;
  if (f.size > max) return `"${f.name}": tối đa ${image ? '10 MB cho ảnh' : video ? '200 MB cho video' : '25 MB cho tệp'}`;
  return null;
}

/** Giới hạn ký tự chữ thuần của một bài (BE kiểm tra lại: NewsRules.MaxPlainLength). */
export const MAX_POST_CHARS = 20000;
