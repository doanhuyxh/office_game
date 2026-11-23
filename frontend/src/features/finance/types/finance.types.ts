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
  status: TxStatus; voidReason: string | null; createdAt: string; createdByName: string; projectId: string | null; projectName: string | null; attachmentCount: number;
}
export interface IEntryRequest {
  kind: TxKind; date: string; amount: number; accountId: string; toAccountId?: string | null; categoryId?: string | null; businessLineId?: string | null;
  counterparty?: string | null; description?: string | null; invoiceNumber?: string | null; projectId?: string | null;
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
  projectId: string | null; projectName: string | null; attachmentCount: number;
}
export interface IExpenseRequest {
  amount: number; reason: string; payee?: string | null; categoryId?: string | null; businessLineId?: string | null; neededBy?: string | null; projectId?: string | null;
}
/** Dự án gắn được vào giao dịch / đề nghị chi (Xem tài chính: mọi dự án đang chạy; người khác: dự án mình tham gia). */
export interface IProjectOption { id: string; code: string; name: string }
export interface IPayExpense { accountId: string; date: string; invoiceNumber?: string | null }

export type AttachmentOwner = 'Entry' | 'Expense';
/** Chứng từ (hoá đơn, biên nhận…) — dòng sổ chi theo đề nghị kèm cả chứng từ của đề nghị (ownerType = Expense, không xoá được ở đó). */
export interface IAttachment {
  id: string; ownerType: AttachmentOwner; ownerId: string; fileName: string; contentType: string; size: number; createdAt: string; createdByName: string; canDelete: boolean;
}

/** Tổng quan giám đốc (TEST-220) — `GET /api/finance/dashboard`. Số theo tiền thực thu / thực chi của sổ, không tính chuyển quỹ. */
export interface IDashboardMonth { month: string; income: number; expense: number; profit: number; byLine: ILineSummary[] }
export interface IAgingBucket { bucket: '1-30' | '31-60' | '61-90' | '>90'; amount: number; count: number }
export interface IPipelineStage { stage: 'Lead' | 'Contacted' | 'Quoted' | 'Negotiating'; count: number; value: number; weighted: number }
export interface IDashboard {
  from: string; today: string; months: number; monthly: IDashboardMonth[];
  totals: { income: number; expense: number; profit: number; byLine: ILineSummary[] };
  receivables: { outstanding: number; overdue: number; overdueCount: number; dueSoon: number; aging: IAgingBucket[] };
  pipeline: { openCount: number; openValue: number; weighted: number; byStage: IPipelineStage[] };
}
/** Dự án đang chạy cần chú ý — `GET /api/projects/financials/alerts` (module Projects, gọi từ đây, không import feature projects). */
export interface IProjectAlert {
  projectId: string; code: string; name: string; kind: 'Internal' | 'Client'; revenue: number; profit: number; marginPercent: number | null;
  manDays: number; budgetManDays: number | null; budgetUsedPercent: number | null; hasEstimate: boolean; loss: boolean; overBudget: boolean; nearBudget: boolean;
}

/** Dự báo dòng tiền 13 tuần (TEST-221) — `GET /api/finance/forecast`. Tiền luôn dương; dòng ra giao diện tự hiện dấu −. */
export type ForecastLine = 'Installment' | 'Overdue' | 'Pipeline' | 'RecurringIncome' | 'Payroll' | 'Renewal' | 'Expense' | 'RecurringExpense';
export interface IForecastWeek {
  week: number; from: string; to: string;
  installments: number; overdue: number; pipeline: number; recurringIncome: number;
  payroll: number; renewals: number; expenses: number; recurringExpense: number;
  inConservative: number; inExpected: number; out: number; closingConservative: number; closingExpected: number;
}
export interface IForecastItem {
  week: number; line: ForecastLine; date: string | null; amount: number; name: string; refId: string | null; refCode: string | null; customerId: string | null; late: boolean;
}
export interface IForecastSettings { payrollPayDay: number; pipelineDelayDays: number }
export interface IForecast {
  today: string; to: string; opening: number; settings: IForecastSettings; payroll: { monthlyCost: number; estimated: boolean };
  weeks: IForecastWeek[]; items: IForecastItem[]; firstNegativeConservative: number | null; firstNegativeExpected: number | null;
  undatedOpportunities: number; undatedValue: number; undatedWeighted: number;
}
/** Khoản định kỳ dự kiến (thuê văn phòng, thuế…) — chỉ là số cho dự báo: không sinh dòng sổ / đề nghị chi; không xoá, chỉ ngừng. */
export interface IRecurringItem {
  id: string; name: string; kind: CategoryKind; amount: number; dayOfMonth: number; businessLineId: string | null; businessLineName: string | null; isActive: boolean; note: string | null;
}
export interface IRecurringItemRequest { name: string; kind: CategoryKind; amount: number; dayOfMonth: number; businessLineId: string | null; isActive: boolean; note: string | null }
