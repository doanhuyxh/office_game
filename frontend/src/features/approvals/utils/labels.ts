import type { StatusTone } from '@/components/common/StatusBadge';
import type { ApprovalStatus, StepStatus } from '../types/approval.types';

export const APPROVAL_STATUS: Record<ApprovalStatus, { label: string; tone: StatusTone }> = {
  Pending: { label: 'Chờ duyệt', tone: 'warning' },
  Approved: { label: 'Đã duyệt', tone: 'success' },
  Rejected: { label: 'Từ chối', tone: 'danger' },
  Cancelled: { label: 'Đã huỷ', tone: 'muted' },
};

export const STEP_ICON: Record<StepStatus, string> = { Waiting: '○', Pending: '⏳', Approved: '✓', Rejected: '✕' };

export const APPROVAL_TYPE: Record<string, string> = {
  leave: '🌴 Nghỉ phép',
  attendance_correction: '🕘 Giải trình chấm công',
  overtime: '⏱ Tăng ca',
  document_publish: '📄 Ban hành tài liệu',
};
