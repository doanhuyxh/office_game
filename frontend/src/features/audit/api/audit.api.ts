import { http } from '@/services/api-client';
import type { IChange, IChangeFilter } from '../types/audit.types';

export const auditKeys = {
  changes: (f: IChangeFilter) => ['audit', 'changes', f] as const,
};

export const auditApi = {
  /** before: thời điểm ISO kèm múi giờ (phân trang lùi). */
  changes: (f: IChangeFilter, before?: string) => {
    const q = new URLSearchParams({ take: '50' });
    if (f.entity) q.set('entity', f.entity);
    if (f.entityId) q.set('entityId', f.entityId);
    if (f.search?.trim()) q.set('search', f.search.trim());
    if (before) q.set('before', before);
    return http<IChange[]>(`/api/audit/changes?${q}`);
  },
};
