import { http, pageQs } from '@/services/api-client';
import type { IPaged, IPageQuery } from '@/types/api';
import type { IAiSession, IAiUsageFilter, IAiUsageSummary } from '../types/aiUsage.types';

/** Tham số chung của /api/ai-usage/* (bỏ giá trị trống). */
export function aiUsageQs(f: Partial<IAiUsageFilter>) {
  const p = new URLSearchParams();
  if (f.group) p.set('group', f.group);
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.kind) p.set('kind', f.kind);
  if (f.status) p.set('status', f.status);
  if (f.userId) p.set('userId', f.userId);
  return p.toString();
}

export const aiUsageKeys = {
  all: ['ai-usage'] as const,
  summary: (f: Partial<IAiUsageFilter>) => ['ai-usage', 'summary', f] as const,
  sessions: (f: Partial<IAiUsageFilter>, q: IPageQuery) => ['ai-usage', 'sessions', f, q] as const,
};

/** Mức dùng AI theo phiên agent (token / chi phí) — TEST-134. Quyền kiểm ở BE: của mình; admin / HR xem người khác / all. */
export const aiUsageApi = {
  summary: (f: Partial<IAiUsageFilter>) => http<IAiUsageSummary>(`/api/ai-usage/summary?${aiUsageQs(f)}`),
  sessions: (f: Partial<IAiUsageFilter>, q: IPageQuery) =>
    http<IPaged<IAiSession>>(`/api/ai-usage/sessions?${aiUsageQs({ ...f, group: undefined })}&${pageQs(q)}`),
  /** Link tải Excel (GET, cookie cùng origin) — dùng với `downloadUrl`. */
  exportUrl: (f: Partial<IAiUsageFilter>) => `/api/ai-usage/export?${aiUsageQs(f)}`,
};
