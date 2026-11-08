import type { StatusTone } from '@/components/common/StatusBadge';
import type { ChangeRequestStatus, ProjectKind, ProjectStatus, TaskState } from '../types/project.types';

export const TASK_STATES: TaskState[] = ['Todo', 'Doing', 'Review', 'Done'];
export const TASK_STATE: Record<TaskState, { label: string; tone: StatusTone }> = {
  Todo: { label: 'Cần làm', tone: 'muted' },
  Doing: { label: 'Đang làm', tone: 'info' },
  Review: { label: 'Chờ review', tone: 'warning' },
  Done: { label: 'Xong', tone: 'success' },
};
export const PROJECT_KIND: Record<ProjectKind, string> = { Internal: 'Nội bộ', Client: 'Làm cho khách' };
export const PROJECT_STATUS: Record<ProjectStatus, { label: string; tone: StatusTone }> = {
  Active: { label: 'Đang chạy', tone: 'success' },
  Closed: { label: 'Đã đóng', tone: 'muted' },
};
export const CR_STATUS: Record<ChangeRequestStatus, { label: string; tone: StatusTone }> = {
  Draft: { label: 'Nháp', tone: 'muted' },
  Sent: { label: 'Đã gửi khách', tone: 'info' },
  Approved: { label: 'Khách đồng ý', tone: 'success' },
  Rejected: { label: 'Khách từ chối', tone: 'danger' },
  Cancelled: { label: 'Đã huỷ', tone: 'muted' },
};
/** "2026-11-01" → "11/2026". */
export const fmtMonth = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
