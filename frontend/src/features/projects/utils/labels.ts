import type { StatusTone } from '@/components/common/StatusBadge';
import type { ProjectKind, ProjectStatus, TaskState } from '../types/project.types';

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
/** "2026-11-01" → "11/2026". */
export const fmtMonth = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
