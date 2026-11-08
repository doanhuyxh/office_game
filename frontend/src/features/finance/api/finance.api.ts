import { http, httpPost, pageQs } from '@/services/api-client';
import type { IPaged, IPageQuery } from '@/types/api';
import type {
  ExpenseStatus, IAccount, IAccountRequest, ICategory, ICategoryRequest, IEntry, IEntryFilter, IEntryRequest, IExpense, IExpenseRequest, ILine, ILineRequest,
  AttachmentOwner, IAttachment, IOverview, IPayExpense, IProjectOption,
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
  projects: ['finance', 'projects'] as const,
  attachments: (type: AttachmentOwner, id: string) => ['finance', 'attachments', type, id] as const,
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
  projects: () => http<IProjectOption[]>(`${base}/projects`),
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
  attachments: (type: AttachmentOwner, id: string) => http<IAttachment[]>(`${base}/attachments?${qs({ ownerType: type, ownerId: id })}`),
  attachmentUrl: (id: string, download: boolean) => http<{ url: string }>(`${base}/attachments/${id}/url${download ? '?download=true' : ''}`),
  deleteAttachment: (id: string) => send<void>('DELETE', `${base}/attachments/${id}`),
  /** Xin link → trình duyệt PUT thẳng lên S3 (đúng Content-Type) → xác nhận. */
  uploadAttachment: async (type: AttachmentOwner, id: string, file: File) => {
    const t = await httpPost<{ id: string; uploadUrl: string; contentType: string }>(`${base}/attachments`,
      { ownerType: type, ownerId: id, fileName: file.name, contentType: file.type || null, size: file.size });
    const put = await fetch(t.uploadUrl, { method: 'PUT', headers: { 'Content-Type': t.contentType }, body: file });
    if (!put.ok) throw new Error(`Tải "${file.name}" lên kho thất bại (${put.status})`);
    return httpPost<IAttachment>(`${base}/attachments/${t.id}/confirm`, {});
  },
  /** Excel sổ thu chi + sổ quỹ + tổng hợp (quyền Xem tài chính). */
  exportUrl: (f: { from?: string; to?: string; accountId?: string; lineId?: string; projectId?: string }) => `${base}/entries/export.xlsx?${qs({ ...f })}`,
};
