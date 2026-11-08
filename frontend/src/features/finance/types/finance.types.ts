/** Khớp DTO module Finance (back-end). Tiền: VND, số nguyên. Ngày: yyyy-MM-dd (giờ VN). */
export type TxKind = 'Income' | 'Expense' | 'Transfer';
export type TxStatus = 'Active' | 'Voided';
export type AccountKind = 'Cash' | 'Bank';
export type CategoryKind = 'Income' | 'Expense';
export type ExpenseStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled' | 'Paid';

export interface ILine { id: string; code: string; name: string; sortOrder: number; isActive: boolean }
export interface ILineRequest { code: string; name: string; sortOrder: number; isActive: boolean }
export interface ICategory { id: string; name: string; kind: CategoryKind; sortOrder: number; isActive: boolean }
export interface ICategoryRequest { name: string; kind: CategoryKind; sortOrder: number; isActive: boolean }
export interface IAccount {
  id: string; name: string; kind: AccountKind; bankName: string | null; last4: string | null;
  openingBalance: number; openingDate: string; balance: number; isActive: boolean; sortOrder: number;
}
export interface IAccountRequest {
  name: string; kind: AccountKind; bankName: string | null; last4: string | null; openingBalance: number; openingDate: string; isActive: boolean; sortOrder: number;
}
export interface IEntry {
  id: string; kind: TxKind; date: string; amount: number; accountId: string; accountName: string; toAccountId: string | null; toAccountName: string | null;
  categoryId: string | null; categoryName: string | null; businessLineId: string | null; businessLineName: string | null;
  counterparty: string | null; description: string | null; invoiceNumber: string | null; sourceType: string | null; sourceId: string | null;
  status: TxStatus; voidReason: string | null; createdAt: string; createdByName: string;
}
export interface IEntryRequest {
  kind: TxKind; date: string; amount: number; accountId: string; toAccountId?: string | null; categoryId?: string | null; businessLineId?: string | null;
  counterparty?: string | null; description?: string | null; invoiceNumber?: string | null;
}
export interface IEntryFilter { from?: string; to?: string; kind?: TxKind; accountId?: string; lineId?: string; voided?: boolean; search?: string }
export interface ILineSummary { businessLineId: string | null; name: string; income: number; expense: number }
export interface IOverview {
  totalBalance: number; accounts: IAccount[]; monthStart: string; monthIncome: number; monthExpense: number; byLine: ILineSummary[];
  expensePending: number; expensePendingAmount: number; expenseAwaitingPayment: number; expenseAwaitingAmount: number; lockedThrough: string | null;
}
export interface IExpense {
  id: string; code: string; requesterEmployeeId: string; requesterName: string; amount: number; reason: string; payee: string | null;
  categoryId: string | null; categoryName: string | null; businessLineId: string | null; businessLineName: string | null; neededBy: string | null;
  status: ExpenseStatus; approvalRequestId: string | null; rejectReason: string | null; paidEntryId: string | null; paidAt: string | null; createdAt: string;
}
export interface IExpenseRequest { amount: number; reason: string; payee?: string | null; categoryId?: string | null; businessLineId?: string | null; neededBy?: string | null }
export interface IPayExpense { accountId: string; date: string; invoiceNumber?: string | null }
