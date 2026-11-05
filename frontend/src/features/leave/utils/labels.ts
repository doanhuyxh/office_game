import type { LeavePeriod, LeaveStatus } from '../types/leave.types';

export const LEAVE_STATUS: Record<LeaveStatus, { label: string; className: string }> = {
  Pending: { label: 'Chờ duyệt', className: 'bg-amber-100 text-amber-800' },
  Approved: { label: 'Đã duyệt', className: 'bg-emerald-100 text-emerald-800' },
  Rejected: { label: 'Từ chối', className: 'bg-red-100 text-red-800' },
  Cancelled: { label: 'Đã huỷ', className: 'bg-slate-100 text-slate-500' },
};

export const PERIOD_LABEL: Record<LeavePeriod, string> = { FullDay: 'Cả ngày', Morning: 'Buổi sáng', Afternoon: 'Buổi chiều' };

/** 2.5 → "2,5" */
export const fmtDays = (n: number) => (Math.round(n * 100) / 100).toLocaleString('vi-VN');

export const todayStr = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
