import type { StatusTone } from '@/components/common/StatusBadge';
import type { DayStatus, WorkModeValue } from '../types/attendance.types';

export const DAY_STATUS: Record<DayStatus, { label: string; tone: StatusTone }> = {
  Present: { label: 'Đủ công', tone: 'success' },
  Working: { label: 'Đang làm', tone: 'primary' },
  MissingCheckout: { label: 'Thiếu giờ ra', tone: 'warning' },
  Absent: { label: 'Vắng', tone: 'danger' },
  NotYet: { label: 'Chưa chấm', tone: 'muted' },
  DayOff: { label: 'Nghỉ', tone: 'faint' },
  Holiday: { label: 'Ngày lễ', tone: 'info' },
  NotEmployed: { label: '—', tone: 'faint' },
  Leave: { label: 'Nghỉ phép', tone: 'info' },
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
