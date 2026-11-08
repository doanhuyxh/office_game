import type { StatusTone } from '@/components/common/StatusBadge';
import type { ActivityKind, BillingKind, ContractStatus, CustomerKind, InstallmentState, OpportunityStage } from '../types/sales.types';

export const CUSTOMER_KIND: Record<CustomerKind, string> = { Company: 'Doanh nghiệp', Individual: 'Cá nhân' };
export const ACTIVITY_KIND: Record<ActivityKind, string> = { Call: 'Gọi điện', Meeting: 'Gặp mặt', Email: 'Email', Message: 'Nhắn tin', Note: 'Ghi chú' };
export const OPEN_STAGES: OpportunityStage[] = ['Lead', 'Contacted', 'Quoted', 'Negotiating'];
export const STAGE: Record<OpportunityStage, { label: string; tone: StatusTone }> = {
  Lead: { label: 'Tiềm năng', tone: 'muted' },
  Contacted: { label: 'Đã liên hệ', tone: 'info' },
  Quoted: { label: 'Đã báo giá', tone: 'primary' },
  Negotiating: { label: 'Đàm phán', tone: 'warning' },
  Won: { label: 'Thắng', tone: 'success' },
  Lost: { label: 'Thua', tone: 'danger' },
};
export const BILLING: Record<BillingKind, string> = { Milestone: 'Theo mốc', Monthly: 'Hằng tháng', OneTime: 'Một lần' };
export const CONTRACT_STATUS: Record<ContractStatus, { label: string; tone: StatusTone }> = {
  Active: { label: 'Đang hiệu lực', tone: 'success' },
  Completed: { label: 'Đã kết thúc', tone: 'muted' },
  Cancelled: { label: 'Đã huỷ', tone: 'danger' },
};
export const INSTALLMENT_STATE: Record<InstallmentState, { label: string; tone: StatusTone }> = {
  Upcoming: { label: 'Chưa đến hạn', tone: 'muted' },
  DueSoon: { label: 'Sắp đến hạn', tone: 'warning' },
  Overdue: { label: 'Quá hạn', tone: 'danger' },
  Partial: { label: 'Đã thu một phần', tone: 'info' },
  Paid: { label: 'Đã thu', tone: 'success' },
  Cancelled: { label: 'Đã huỷ', tone: 'faint' },
};
export const VAT_RATES = [0, 5, 8, 10];
/** Tổng sau thuế — khớp SalesRules.Total ở back-end (làm tròn nửa lên). */
export const totalWithVat = (beforeTax: number, vat: number) => beforeTax + Math.round((beforeTax * vat) / 100);
