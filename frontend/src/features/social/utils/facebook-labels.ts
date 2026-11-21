import type { StatusTone } from '@/components/common/StatusBadge';
import type { FacebookPostStatus, FacebookTargetStatus } from '../types/facebook.types';

export const POST_STATUS: Record<FacebookPostStatus, { label: string; tone: StatusTone }> = {
  Scheduled: { label: 'Chờ đăng', tone: 'info' },
  Publishing: { label: 'Đang đăng', tone: 'warning' },
  Published: { label: 'Đã đăng', tone: 'success' },
  PartiallyFailed: { label: 'Lỗi một phần', tone: 'warning' },
  Failed: { label: 'Lỗi', tone: 'danger' },
  Cancelled: { label: 'Đã huỷ', tone: 'muted' },
};

export const TARGET_STATUS: Record<FacebookTargetStatus, { label: string; tone: StatusTone }> = {
  Pending: { label: 'Chờ', tone: 'info' },
  Publishing: { label: 'Đang đăng', tone: 'warning' },
  Published: { label: 'Đã đăng', tone: 'success' },
  Failed: { label: 'Lỗi', tone: 'danger' },
  Cancelled: { label: 'Đã huỷ', tone: 'muted' },
};
