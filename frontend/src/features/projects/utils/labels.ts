import type { StatusTone } from '@/components/common/StatusBadge';
import type { ChangeRequestStatus, ITaskColumn, ProjectHealth, ProjectKind, ProjectStatus, TaskActivityKind } from '../types/project.types';

/** Bảng màu gợi ý cho cột trạng thái (khớp TaskColumnRules.Palette ở back-end). */
export const COLUMN_PALETTE = ['#64748b', '#3b82f6', '#06b6d4', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e'];
/** Lịch sử cũ (trước khi có cột tự do) lưu tên enum. */
const LEGACY_STATE: Record<string, string> = { Todo: 'Cần làm', Doing: 'Đang làm', Review: 'Chờ review', Done: 'Xong' };
export const stateLabel = (s: string | null) => (s ? (LEGACY_STATE[s] ?? s) : '');
/** Chuyển lùi cần lý do (khớp TaskWorkflow.NeedsNote ở back-end — back-end vẫn là nơi kiểm). */
export const needsMoveNote = (columns: ITaskColumn[], from: string, to: string, sequential: boolean) => {
  const i = (id: string) => columns.findIndex((c) => c.id === id);
  return sequential && i(to) < i(from);
};
/** Cột được chọn khi tạo việc (khớp TaskWorkflow.CreateError — back-end vẫn kiểm). */
export function createColumns(columns: ITaskColumn[], sequential: boolean, canApprove: boolean) {
  const gate = columns.findIndex((c) => c.approverOnly || c.isDone);
  return columns.filter((c, i) => !(sequential && gate >= 0 && i >= gate) && (canApprove || !c.approverOnly));
}
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
