import type { StatusTone } from '@/components/common/StatusBadge';
import type { AccountKind, ExpenseStatus, ForecastLine, IAgingBucket, IForecastWeek, IPipelineStage, TxKind } from '../types/finance.types';

export const TX_KIND_LABEL: Record<TxKind, string> = { Income: 'Thu', Expense: 'Chi', Transfer: 'Chuyển quỹ' };
export const TX_KIND_TONE: Record<TxKind, StatusTone> = { Income: 'success', Expense: 'danger', Transfer: 'info' };
export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = { Cash: 'Tiền mặt', Bank: 'Ngân hàng' };
export const EXPENSE_STATUS: Record<ExpenseStatus, { label: string; tone: StatusTone }> = {
  Pending: { label: 'Chờ duyệt', tone: 'warning' },
  Approved: { label: 'Đã duyệt · chờ chi', tone: 'info' },
  Paid: { label: 'Đã chi', tone: 'success' },
  Rejected: { label: 'Từ chối', tone: 'danger' },
  Cancelled: { label: 'Đã huỷ', tone: 'muted' },
};

/** Hôm nay theo giờ VN (yyyy-MM-dd) — chỉ để điền sẵn ô ngày; server mới là nơi quyết định. */
export const todayVn = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
/** "2026-11-08" → "08/11/2026". */
export const fmtDate = (d: string | null | undefined) => (d ? d.split('-').reverse().join('/') : '—');
export { groupDigits, parseMoney } from '@/utils/money';

/** "2026-11-01" → "T11/2026"; bản ngắn "11/26" cho trục biểu đồ. */
export const fmtMonth = (d: string) => { const [y, m] = d.split('-'); return `T${Number(m)}/${y}`; };
export const fmtMonthShort = (d: string) => { const [y, m] = d.split('-'); return `${m}/${y.slice(2)}`; };
/** "2026-11-23" → "23/11". */
export const fmtDayMonth = (d: string) => { const [, m, day] = d.split('-'); return `${day}/${m}`; };
/** Số tiền gọn cho trục / nhãn biểu đồ: 1,2 tỷ · 350 tr · 12 k. */
export function fmtMoneyShort(v: number) {
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  const f = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: n < 10 ? 1 : 0 });
  if (a >= 1e9) return `${s}${f(a / 1e9)} tỷ`;
  if (a >= 1e6) return `${s}${f(a / 1e6)} tr`;
  if (a >= 1e3) return `${s}${f(a / 1e3)} k`;
  return `${s}${a}`;
}

export const STAGE_LABEL: Record<IPipelineStage['stage'], string> = { Lead: 'Tiềm năng', Contacted: 'Đã liên hệ', Quoted: 'Đã báo giá', Negotiating: 'Đàm phán' };
export const AGING_LABEL: Record<IAgingBucket['bucket'], string> = { '1-30': '1–30 ngày', '31-60': '31–60 ngày', '61-90': '61–90 ngày', '>90': '> 90 ngày' };

/** Một dòng của bảng dự báo: `field` = cột trong `IForecastWeek`; `out` = tiền ra (hiện dấu −); `expectedOnly` = chỉ thuộc đường Kỳ vọng. */
export interface IForecastLineDef { line: ForecastLine; field: keyof IForecastWeek; label: string; out?: boolean; expectedOnly?: boolean }
export const FORECAST_LINES: IForecastLineDef[] = [
  { line: 'Installment', field: 'installments', label: 'Đợt thu sắp đến hạn' },
  { line: 'Overdue', field: 'overdue', label: 'Công nợ quá hạn', expectedOnly: true },
  { line: 'Pipeline', field: 'pipeline', label: 'Cơ hội × xác suất', expectedOnly: true },
  { line: 'RecurringIncome', field: 'recurringIncome', label: 'Khoản định kỳ thu' },
  { line: 'Payroll', field: 'payroll', label: 'Lương dự kiến', out: true },
  { line: 'Renewal', field: 'renewals', label: 'Gia hạn dịch vụ', out: true },
  { line: 'Expense', field: 'expenses', label: 'Đề nghị chi đã duyệt', out: true },
  { line: 'RecurringExpense', field: 'recurringExpense', label: 'Khoản định kỳ chi', out: true },
];
