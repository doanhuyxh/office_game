import type { StatusTone } from '@/components/common/StatusBadge';
import type { ContractStatus, ContractType } from '../types/contract.types';

export const CONTRACT_TYPE: Record<ContractType, string> = {
  Indefinite: 'Không xác định thời hạn',
  Fixed: 'Xác định thời hạn',
  Probation: 'Thử việc',
};

export const CONTRACT_STATUS: Record<ContractStatus, { label: string; tone: StatusTone }> = {
  Upcoming: { label: 'Chưa hiệu lực', tone: 'primary' },
  Active: { label: 'Đang hiệu lực', tone: 'success' },
  Expired: { label: 'Hết hạn', tone: 'muted' },
  Terminated: { label: 'Đã chấm dứt', tone: 'danger' },
};

/** Khớp ContractRules.RemindDays ở back-end: hiện cảnh báo "sắp hết hạn". */
export const EXPIRING_DAYS = 30;

export { formatMoney } from '@/utils/money';

export const ACCEPT_FILES = 'application/pdf,image/jpeg,image/png';
