import { fold } from '@/components/common/SearchSelectField';
import type { IMember, ITask, ITaskColumn } from '../types/project.types';

/** Chế độ xem tab Công việc (TEST-192): bảng cột (kanban) / danh sách. */
export type TaskView = 'board' | 'list';
export type TaskGroupBy = 'status' | 'assignee' | 'due' | 'none';
export type TaskSort = 'rank' | 'dueAsc' | 'dueDesc';
/** Lọc hạn: quá hạn / 7 ngày tới (chưa xong) / chưa có hạn. */
export type TaskDueFilter = 'all' | 'overdue' | 'week' | 'none';
/** Lọc người làm: 'all' / 'none' (chưa giao) / employeeId. */
export interface ITaskListFilter { search: string; columnId: string; assignee: string; due: TaskDueFilter; mine: boolean }

export const EMPTY_FILTER: ITaskListFilter = { search: '', columnId: 'all', assignee: 'all', due: 'all', mine: false };
export const isFiltered = (f: ITaskListFilter) =>
  !!f.search.trim() || f.columnId !== 'all' || f.assignee !== 'all' || f.due !== 'all' || f.mine;

export const GROUP_LABEL: Record<TaskGroupBy, string> = { status: 'Trạng thái', assignee: 'Người làm', due: 'Hạn', none: 'Không nhóm' };
export const SORT_LABEL: Record<TaskSort, string> = { rank: 'Thứ tự bảng', dueAsc: 'Hạn gần nhất', dueDesc: 'Hạn xa nhất' };
export const DUE_LABEL: Record<TaskDueFilter, string> = { all: 'Tất cả', overdue: 'Quá hạn', week: '7 ngày tới', none: 'Chưa có hạn' };

/** "yyyy-MM-dd" + n ngày (so sánh chuỗi ngày, không lệch múi giờ). */
function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Lọc trên dữ liệu `useTasks` (client — không gọi API). `today` = ngày hôm nay giờ VN (yyyy-MM-dd). */
export function filterTasks(tasks: ITask[], f: ITaskListFilter, myEmployeeId: string | null, today: string) {
  const q = fold(f.search.trim());
  const weekEnd = addDays(today, 7);
  return tasks.filter((t) =>
    (!q || fold(`${t.code} ${t.title}`).includes(q))
    && (f.columnId === 'all' || t.columnId === f.columnId)
    && (f.assignee === 'all' || (f.assignee === 'none' ? !t.assigneeEmployeeId : t.assigneeEmployeeId === f.assignee))
    && (!f.mine || (!!myEmployeeId && t.assigneeEmployeeId === myEmployeeId))
    && (f.due === 'all'
      || (f.due === 'overdue' && t.overdue)
      || (f.due === 'none' && !t.dueOn)
      || (f.due === 'week' && !t.done && !!t.dueOn && t.dueOn >= today && t.dueOn <= weekEnd)));
}

/** Sắp xếp: thứ tự bảng (rank, như kanban) / hạn tăng / giảm — việc không hạn luôn ở cuối, cùng hạn giữ thứ tự bảng. */
export function sortTasks(tasks: ITask[], sort: TaskSort) {
  const byRank = (a: ITask, b: ITask) => a.rank - b.rank;
  if (sort === 'rank') return [...tasks].sort(byRank);
  const dir = sort === 'dueAsc' ? 1 : -1;
  return [...tasks].sort((a, b) => {
    if (!a.dueOn || !b.dueOn) return a.dueOn ? -1 : b.dueOn ? 1 : byRank(a, b);
    return a.dueOn === b.dueOn ? byRank(a, b) : (a.dueOn < b.dueOn ? -dir : dir);
  });
}

export interface ITaskGroup {
  key: string; label: string;
  /** Màu chấm (nhóm theo trạng thái). */
  color?: string;
  /** Nhóm của cột hoàn thành → thu gọn sẵn. */
  isDone?: boolean;
  tasks: ITask[];
}

const DUE_GROUPS = [
  { key: 'overdue', label: 'Quá hạn' }, { key: 'week', label: '7 ngày tới' }, { key: 'later', label: 'Sau đó' },
  { key: 'none', label: 'Chưa có hạn' }, { key: 'done', label: 'Đã xong' },
] as const;

/**
 * Chia nhóm (đã lọc + sắp xếp trước). Theo trạng thái: thứ tự nhóm = thứ tự cột của dự án (kể cả cột tự đặt), nhóm trống vẫn hiện
 * khi không lọc trạng thái — giữ đủ quy trình như ảnh thiết kế; theo người làm: thứ tự thành viên, "Chưa giao" cuối; theo hạn: các khoảng cố định.
 */
export function groupTasks(tasks: ITask[], by: TaskGroupBy, columns: ITaskColumn[], members: IMember[], today: string, keepEmpty: boolean): ITaskGroup[] {
  if (by === 'none') return [{ key: 'all', label: 'Tất cả', tasks }];
  if (by === 'status') {
    return columns.map((c) => ({ key: c.id, label: c.name, color: c.color, isDone: c.isDone, tasks: tasks.filter((t) => t.columnId === c.id) }))
      .filter((g) => keepEmpty || g.tasks.length > 0);
  }
  if (by === 'assignee') {
    const order = new Map(members.map((m, i) => [m.employeeId, i]));
    const groups = new Map<string, ITaskGroup>();
    for (const t of tasks) {
      const key = t.assigneeEmployeeId ?? 'none';
      if (!groups.has(key)) groups.set(key, { key, label: t.assigneeName ?? 'Chưa giao', tasks: [] });
      groups.get(key)!.tasks.push(t);
    }
    const rank = (k: string) => (k === 'none' ? Number.MAX_SAFE_INTEGER : order.get(k) ?? Number.MAX_SAFE_INTEGER - 1);
    return [...groups.values()].sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label, 'vi'));
  }
  const weekEnd = addDays(today, 7);
  const bucket = (t: ITask) => (t.done ? 'done' : t.overdue ? 'overdue' : !t.dueOn ? 'none' : t.dueOn <= weekEnd ? 'week' : 'later');
  return DUE_GROUPS.map((g) => ({ key: g.key, label: g.label, isDone: g.key === 'done', tasks: tasks.filter((t) => bucket(t) === g.key) }))
    .filter((g) => g.tasks.length > 0);
}

/** Đọc / ghi localStorage bọc try/catch (trình duyệt chặn lưu trữ → dùng mặc định). */
export function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch { return fallback; }
}
export function writeStored(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* bỏ qua: trình duyệt chặn lưu trữ */ }
}
