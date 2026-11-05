import type { LucideIcon } from 'lucide-react';
import { Ban, Bell, CheckCircle2, Inbox, XCircle } from 'lucide-react';

/** Icon + màu (token theme) theo loại thông báo. */
export const CATEGORY: Record<string, { icon: LucideIcon; className: string }> = {
  approval_requested: { icon: Inbox, className: 'text-primary' },
  approval_approved: { icon: CheckCircle2, className: 'text-success' },
  approval_rejected: { icon: XCircle, className: 'text-destructive' },
  approval_cancelled: { icon: Ban, className: 'text-muted-foreground' },
};
export const FALLBACK = { icon: Bell, className: 'text-muted-foreground' };

/** "vừa xong" / "5 phút trước" / "3 giờ trước" / "2 ngày trước" / dd/MM/yyyy */
export function timeAgo(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} ngày trước`;
  return new Date(iso).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}
