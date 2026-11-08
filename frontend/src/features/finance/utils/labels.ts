import type { StatusTone } from '@/components/common/StatusBadge';
import type { AccountKind, ExpenseStatus, TxKind } from '../types/finance.types';

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
/** Ô nhập tiền: bỏ mọi ký tự không phải số ("1.500.000" → 1500000). */
export const parseMoney = (s: string) => Number(s.replace(/\D/g, '')) || 0;
export const groupDigits = (n: number) => (n ? n.toLocaleString('vi-VN') : '');
