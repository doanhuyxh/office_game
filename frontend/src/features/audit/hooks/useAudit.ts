import { useQuery } from '@tanstack/react-query';
import type { IPageQuery } from '@/types/api';
import { auditApi, auditKeys } from '../api/audit.api';
import type { IChangeFilter } from '../types/audit.types';

/** Lịch sử sửa theo trang (BE cắt trang, mới nhất trước). */
export const useChangesPage = (f: IChangeFilter, q: IPageQuery) =>
  useQuery({ queryKey: auditKeys.changesPage(f, q), queryFn: () => auditApi.changesPage(f, q), placeholderData: (prev) => prev });
