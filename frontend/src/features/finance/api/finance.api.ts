import { http, httpPost, pageQs } from '@/services/api-client';
import type { IPaged, IPageQuery } from '@/types/api';
import type {
  ExpenseStatus, IAccount, IAccountRequest, ICategory, ICategoryRequest, IEntry, IEntryFilter, IEntryRequest, IExpense, IExpenseRequest, ILine, ILineRequest,
  IOverview, IPayExpense,
} from '../types/finance.types';

const base = '/api/finance';
const send = <T>(method: string, url: string, body?: unknown) => http<T>(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const qs = (o: Record<string, string | number | boolean | undefined | null>) =>
  Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');

export const financeKeys = {
  all: ['finance'] as const,
  overview: ['finance', 'overview'] as const,
  accounts: ['finance', 'accounts'] as const,
  lines: ['finance', 'lines'] as const,
  categories: ['finance', 'categories'] as const,
  lock: ['finance', 'lock'] as const,
  entries: (f: IEntryFilter, q: IPageQuery) => ['finance', 'entries', f, q] as const,
  expenses: (scope: 'mine' | 'all', status: ExpenseStatus | undefined, q: IPageQuery) => ['finance', 'expenses', scope, status, q] as const,
};

export const financeApi = {
  overview: () => http<IOverview>(`${base}/overview`),
  accounts: () => http<IAccount[]>(`${base}/accounts`),
  saveAccount: (id: string | undefined, b: IAccountRequest): Promise<unknown> => (id ? send<void>('PUT', `${base}/accounts/${id}`, b) : httpPost<string>(`${base}/accounts`, b)),
  lines: () => http<ILine[]>(`${base}/lines`),
  saveLine: (id: string | undefined, b: ILineRequest): Promise<unknown> => (id ? send<void>('PUT', `${base}/lines/${id}`, b) : httpPost<string>(`${base}/lines`, b)),
  categories: () => http<ICategory[]>(`${base}/categories`),
  saveCategory: (id: string | undefined, b: ICategoryRequest): Promise<unknown> => (id ? send<void>('PUT', `${base}/categories/${id}`, b) : httpPost<string>(`${base}/categories`, b)),
  lock: () => http<{ lockedThrough: string | null }>(`${base}/lock`),
  setLock: (lockedThrough: string | null) => send<void>('PUT', `${base}/lock`, { lockedThrough }),
  entries: (f: IEntryFilter, q: IPageQuery) => http<IPaged<IEntry>>(`${base}/entries?${pageQs(q)}&${qs({ ...f })}`),
  createEntry: (b: IEntryRequest) => httpPost<string>(`${base}/entries`, b),
  voidEntry: (id: string, reason: string) => httpPost<void>(`${base}/entries/${id}/void`, { reason }),
  expenses: (scope: 'mine' | 'all', status: ExpenseStatus | undefined, q: IPageQuery) =>
    http<IPaged<IExpense>>(`${base}/expenses?${pageQs(q)}&${qs({ scope, status })}`),
  createExpense: (b: IExpenseRequest) => httpPost<string>(`${base}/expenses`, b),
  payExpense: (id: string, b: IPayExpense) => httpPost<void>(`${base}/expenses/${id}/pay`, b),
};
