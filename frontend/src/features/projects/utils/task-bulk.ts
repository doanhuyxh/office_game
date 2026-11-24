import type { ITask, ITaskColumn } from '../types/project.types';
import { moveBlockReason, needsMoveNote } from './labels';

/** Chữ phải gõ để xoá hàng loạt — khớp `BulkTaskRules.DeleteConfirmWord` (back-end kiểm lại). */
export const BULK_DELETE_WORD = 'delete';
/** Số việc tối đa mỗi lần — khớp `BulkTaskRules.MaxIds`. */
export const BULK_MAX = 100;
/** Dời hạn tối đa ± số ngày — khớp `BulkTaskRules.MaxShiftDays`. */
export const BULK_MAX_SHIFT = 365;

export const isDeleteConfirmed = (typed: string) => typed.trim().toLowerCase() === BULK_DELETE_WORD;

/** Việc chuyển được / bị bỏ qua khi chuyển hàng loạt sang `to` (xem trước — back-end vẫn là nơi kiểm từng việc). */
export interface IMovePlan { ok: ITask[]; same: ITask[]; blocked: { task: ITask; reason: string }[]; needsNote: boolean }

export function movePlan(tasks: ITask[], to: ITaskColumn | undefined, columns: ITaskColumn[], sequential: boolean, canApprove: boolean): IMovePlan {
  const plan: IMovePlan = { ok: [], same: [], blocked: [], needsNote: false };
  if (!to) return plan;
  for (const t of tasks) {
    if (t.columnId === to.id) { plan.same.push(t); continue; }
    const reason = moveBlockReason(columns, t.columnId, to.id, sequential, canApprove);
    if (reason) { plan.blocked.push({ task: t, reason }); continue; }
    plan.ok.push(t);
    if (needsMoveNote(columns, t.columnId, to.id, sequential)) plan.needsNote = true;
  }
  return plan;
}

/** Id trong khoảng giữa hai id (gồm cả hai đầu) theo thứ tự hiển thị `order` — Shift+click. Id không có trong `order` → chỉ `to`. */
export function rangeIds(order: string[], from: string | null, to: string): string[] {
  const a = from ? order.indexOf(from) : -1, b = order.indexOf(to);
  if (b < 0) return [];
  if (a < 0) return [to];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** Thêm / bỏ `ids` khỏi tập chọn (trả tập mới). */
export function withIds(set: ReadonlySet<string>, ids: string[], on: boolean): Set<string> {
  const next = new Set(set);
  for (const id of ids) (on ? next.add(id) : next.delete(id));
  return next;
}

/** Trạng thái ô tích tổng của một nhóm id: true / false / 'indeterminate'. */
export function checkState(set: ReadonlySet<string>, ids: string[]): boolean | 'indeterminate' {
  const n = ids.filter((id) => set.has(id)).length;
  return n === 0 ? false : n === ids.length ? true : 'indeterminate';
}

/** Việc chưa có hạn (bị bỏ qua khi dời hạn). */
export const withoutDue = (tasks: ITask[]) => tasks.filter((t) => !t.dueOn);
