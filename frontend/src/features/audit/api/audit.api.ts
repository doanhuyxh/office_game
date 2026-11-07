import { http, pageQs } from '@/services/api-client';
import type { IPaged, IPageQuery } from '@/types/api';
import type { IChange, IChangeFilter } from '../types/audit.types';

export const auditKeys = {
  all: ['audit'] as const,
  changesPage: (f: IChangeFilter, q: IPageQuery) => ['audit', 'changes', 'page', f, q] as const,
};

export const auditApi = {
  changesPage: (f: IChangeFilter, q: IPageQuery) => {
    const qs = new URLSearchParams();
    if (f.entity) qs.set('entity', f.entity);
    if (f.entityId) qs.set('entityId', f.entityId);
    if (f.search?.trim()) qs.set('search', f.search.trim());
    return http<IPaged<IChange>>(`/api/audit/changes?${qs}${qs.size ? '&' : ''}${pageQs(q)}`);
  },
};
