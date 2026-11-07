import type { StatusTone } from '@/components/common/StatusBadge';
import type { SearchOption } from '@/components/common/SearchSelectField';
import type { IEmployee } from '@/features/employees';
import type { BillingCycle, DeviceStatus, ReviewDecision, ReviewStatus, ServiceStatus, StocktakeResult } from '../types/asset.types';

export const DEVICE_STATUS: Record<DeviceStatus, { label: string; tone: StatusTone }> = {
  InStock: { label: 'Trong kho', tone: 'info' },
  InUse: { label: 'Đang dùng', tone: 'success' },
  Repair: { label: 'Bảo trì', tone: 'warning' },
  Retired: { label: 'Thanh lý', tone: 'muted' },
  Lost: { label: 'Mất', tone: 'danger' },
};

export const BILLING: Record<BillingCycle, string> = { None: 'Không định kỳ', Monthly: 'Hàng tháng', Yearly: 'Hàng năm' };
export const SERVICE_STATUS: Record<ServiceStatus, { label: string; tone: StatusTone }> = {
  Active: { label: 'Đang dùng', tone: 'success' },
  Cancelled: { label: 'Đã huỷ', tone: 'muted' },
};
export const REVIEW_STATUS: Record<ReviewStatus, { label: string; tone: StatusTone }> = {
  Open: { label: 'Đang mở', tone: 'warning' },
  Closed: { label: 'Đã đóng', tone: 'muted' },
};
export const DECISION: Record<ReviewDecision, { label: string; tone: StatusTone }> = {
  Pending: { label: 'Chưa quyết', tone: 'muted' },
  Keep: { label: 'Giữ', tone: 'success' },
  Revoke: { label: 'Thu hồi', tone: 'danger' },
};
export const CHECK_RESULT: Record<StocktakeResult, { label: string; tone: StatusTone }> = {
  Pending: { label: 'Chưa kiểm', tone: 'muted' },
  Found: { label: 'Có', tone: 'success' },
  Missing: { label: 'Không thấy', tone: 'danger' },
};

export const DEVICE_STATUS_OPTIONS = (Object.keys(DEVICE_STATUS) as DeviceStatus[]).map((v) => ({ value: v, label: DEVICE_STATUS[v].label }));
export const BILLING_OPTIONS = (Object.keys(BILLING) as BillingCycle[]).map((v) => ({ value: v, label: BILLING[v] }));

/** Danh sách chọn nhân viên đang làm (cho SearchSelectField). */
export const employeeOptions = (list: IEmployee[] | undefined): SearchOption[] =>
  (list ?? []).filter((e) => e.status !== 'Resigned').map((e) => ({ value: e.id, label: `${e.fullName} (${e.code})`, hint: e.departmentName ?? undefined }));

/** Số còn lại → "2 ngày" / "hôm nay" / "quá hạn" cho hạn bảo hành, gia hạn. */
export function daysLeft(date: string, today: string) {
  const d = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
  if (d < 0) return 'quá hạn';
  if (d === 0) return 'hôm nay';
  return `còn ${d} ngày`;
}

/** Ô nhập số tiền → số | null. */
export const parseMoney = (s: string): number | null => {
  const t = s.replace(/[^\d]/g, '');
  return t ? Number(t) : null;
};
