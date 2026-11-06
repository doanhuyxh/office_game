import type { LucideIcon } from 'lucide-react';
import { AlarmClock, Ban, Bell, CalendarClock, CalendarX, CheckCircle2, FileClock, FilePen, FileSignature, Inbox, UserCheck, UserPen, UserX, Wallet, XCircle } from 'lucide-react';
import { formatDate } from '@/utils/date';

/** Icon + màu (token theme) theo loại thông báo. */
export const CATEGORY: Record<string, { icon: LucideIcon; className: string }> = {
  approval_requested: { icon: Inbox, className: 'text-primary' },
  approval_approved: { icon: CheckCircle2, className: 'text-success' },
  approval_rejected: { icon: XCircle, className: 'text-destructive' },
  approval_cancelled: { icon: Ban, className: 'text-muted-foreground' },
  contract_expiring: { icon: FileClock, className: 'text-warning' },
  meeting_invited: { icon: CalendarClock, className: 'text-info' },
  meeting_cancelled: { icon: CalendarX, className: 'text-muted-foreground' },
  attendance_reminder: { icon: AlarmClock, className: 'text-warning' },
  payslip_ready: { icon: Wallet, className: 'text-success' },
  contract_sign_requested: { icon: FilePen, className: 'text-primary' },
  contract_signed: { icon: FileSignature, className: 'text-success' },
  profile_change_requested: { icon: UserPen, className: 'text-primary' },
  profile_change_approved: { icon: UserCheck, className: 'text-success' },
  profile_change_rejected: { icon: UserX, className: 'text-destructive' },
};
export const FALLBACK = { icon: Bell, className: 'text-muted-foreground' };

/** "vừa xong" / "5 phút trước" / "3 giờ trước" / "2 ngày trước" / dd/MM/yyyy */
export function timeAgo(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} ngày trước`;
  return formatDate(iso);
}
