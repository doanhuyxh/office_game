import type { DayStatus, WorkModeValue } from '../types/attendance.types';

export const DAY_STATUS: Record<DayStatus, { label: string; className: string }> = {
  Present: { label: 'Đủ công', className: 'bg-emerald-100 text-emerald-800' },
  Working: { label: 'Đang làm', className: 'bg-blue-100 text-blue-800' },
  MissingCheckout: { label: 'Thiếu giờ ra', className: 'bg-amber-100 text-amber-800' },
  Absent: { label: 'Vắng', className: 'bg-red-100 text-red-800' },
  NotYet: { label: 'Chưa chấm', className: 'bg-slate-100 text-slate-600' },
  DayOff: { label: 'Nghỉ', className: 'bg-slate-50 text-slate-400' },
  Holiday: { label: 'Ngày lễ', className: 'bg-violet-100 text-violet-800' },
  NotEmployed: { label: '—', className: 'text-slate-300' },
  Leave: { label: 'Nghỉ phép', className: 'bg-violet-100 text-violet-800' },
};

export const WORK_MODE: Record<WorkModeValue, string> = {
  Onsite: '🏢 Văn phòng',
  Remote: '🏠 Từ xa',
  Mixed: '🔀 Kết hợp',
};

export const WEEKDAY_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
export const WEEKDAY_LONG = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

/** "yyyy-MM" của tháng hiện tại theo giờ Việt Nam. */
export const currentMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7);

/** 485 → "8:05" (giờ:phút, gọn cho bảng). 0 → "—" */
export const hm = (min: number) => (min > 0 ? `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}` : '—');

/** Thứ trong tuần của "yyyy-MM-dd" (không lệch múi giờ). */
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00`).getDay();
