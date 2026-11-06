import type { StatusTone } from '@/components/common/StatusBadge';
import type { LeavePeriod, LeaveStatus } from '../types/leave.types';
import { todayVn } from '@/utils/date';

export const LEAVE_STATUS: Record<LeaveStatus, { label: string; tone: StatusTone }> = {
  Pending: { label: 'Chờ duyệt', tone: 'warning' },
  Approved: { label: 'Đã duyệt', tone: 'success' },
  Rejected: { label: 'Từ chối', tone: 'danger' },
  Cancelled: { label: 'Đã huỷ', tone: 'muted' },
};

export const PERIOD_LABEL: Record<LeavePeriod, string> = { FullDay: 'Cả ngày', Morning: 'Buổi sáng', Afternoon: 'Buổi chiều' };

/** 2.5 → "2,5" */
export const fmtDays = (n: number) => (Math.round(n * 100) / 100).toLocaleString('vi-VN');

export const todayStr = todayVn;
