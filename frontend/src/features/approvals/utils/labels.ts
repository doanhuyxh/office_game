import type { ApprovalStatus, StepStatus } from '../types/approval.types';

export const APPROVAL_STATUS: Record<ApprovalStatus, { label: string; className: string }> = {
  Pending: { label: 'Chờ duyệt', className: 'bg-amber-100 text-amber-800' },
  Approved: { label: 'Đã duyệt', className: 'bg-emerald-100 text-emerald-800' },
  Rejected: { label: 'Từ chối', className: 'bg-red-100 text-red-800' },
  Cancelled: { label: 'Đã huỷ', className: 'bg-slate-100 text-slate-500' },
};

export const STEP_ICON: Record<StepStatus, string> = { Waiting: '○', Pending: '⏳', Approved: '✓', Rejected: '✕' };

export const APPROVAL_TYPE: Record<string, string> = {
  leave: '🌴 Nghỉ phép',
  attendance_correction: '🕘 Giải trình chấm công',
};
