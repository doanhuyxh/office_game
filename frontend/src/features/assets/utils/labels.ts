import type { StatusTone } from '@/components/common/StatusBadge';
import type { SearchOption } from '@/components/common/SearchSelectField';
import type { IEmployee } from '@/features/employees';
import type {
  AttachmentKind, BillingCycle, DeviceStatus, HandoverKind, IHandover, ReviewDecision, ReviewStatus, ServiceStatus, StocktakeResult,
} from '../types/asset.types';

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

export const ATTACHMENT_KIND: Record<AttachmentKind, { label: string; accept: string }> = {
  Photo: { label: 'Ảnh', accept: '.png,.jpg,.jpeg,.webp,.heic' },
  Invoice: { label: 'Hoá đơn', accept: '.pdf,.png,.jpg,.jpeg,.webp,.heic,.xml,.zip' },
  Other: { label: 'Tệp khác', accept: '.pdf,.png,.jpg,.jpeg,.webp,.heic,.xml,.zip,.docx,.doc,.xlsx,.xls,.txt' },
};

export const HANDOVER_KIND: Record<HandoverKind, string> = { Assign: 'Bàn giao', Return: 'Thu hồi' };

/** Trạng thái xác nhận biên bản của nhân viên. */
export function handoverState(h: IHandover): { label: string; tone: StatusTone } {
  if (h.confirmedAt) return { label: 'Đã xác nhận', tone: 'success' };
  if (!h.requiresConfirmation) return { label: 'Không cần xác nhận', tone: 'muted' };
  return { label: 'Chờ xác nhận', tone: 'warning' };
}

/** 1 234 567 → "1,2 MB". */
export const fileSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
