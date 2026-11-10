import type { StatusTone } from '@/components/common/StatusBadge';
import type { ChangeRequestStatus, ProjectHealth, ProjectKind, ProjectStatus, TaskActivityKind, TaskState } from '../types/project.types';

export const TASK_STATES: TaskState[] = ['Todo', 'Doing', 'Review', 'Done'];
export const TASK_STATE: Record<TaskState, { label: string; tone: StatusTone }> = {
  Todo: { label: 'Cần làm', tone: 'muted' },
  Doing: { label: 'Đang làm', tone: 'info' },
  Review: { label: 'Chờ review', tone: 'warning' },
  Done: { label: 'Xong', tone: 'success' },
};
const ORDER: Record<TaskState, number> = { Todo: 0, Doing: 1, Review: 2, Done: 3 };
/** Chuyển lùi cần lý do (khớp TaskWorkflow.NeedsNote ở back-end — back-end vẫn là nơi kiểm). */
export const needsMoveNote = (from: TaskState, to: TaskState, requireReview: boolean) =>
  requireReview && ORDER[to] < ORDER[from] && (from === 'Review' || from === 'Done');
export const ACTIVITY_LABEL: Record<TaskActivityKind, string> = {
  Created: 'tạo việc', Moved: 'chuyển trạng thái', Assigned: 'đổi người làm', DueChanged: 'đổi hạn', Edited: 'sửa nội dung',
};
export const PROJECT_HEALTH: Record<ProjectHealth, { label: string; tone: StatusTone; rank: number }> = {
  Late: { label: 'Trễ', tone: 'danger', rank: 0 },
  AtRisk: { label: 'Có rủi ro', tone: 'warning', rank: 1 },
  OnTrack: { label: 'Đúng tiến độ', tone: 'success', rank: 2 },
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
