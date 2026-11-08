// Public API của module Tài chính (sổ thu chi, đề nghị chi). Quyền theo chức vụ — xem features/employees (FINANCE_PERMISSION).
export { FinancePage } from './components/finance-page';
export { useAccounts, useCategories, useFinancePerms, useLines } from './hooks/useFinance';
export type { IAccount, ICategory, ILine } from './types/finance.types';
export { fmtDate, todayVn } from './utils/labels';
