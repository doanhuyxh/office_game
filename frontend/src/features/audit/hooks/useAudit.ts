import { useInfiniteQuery } from '@tanstack/react-query';
import { auditApi, auditKeys } from '../api/audit.api';
import type { IChangeFilter } from '../types/audit.types';

/** Lịch sử sửa, 50 dòng / trang, "Tải thêm" lùi theo thời điểm dòng cuối. */
export const useChanges = (f: IChangeFilter) =>
  useInfiniteQuery({
    queryKey: auditKeys.changes(f),
    queryFn: ({ pageParam }) => auditApi.changes(f, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.length < 50 ? undefined : last[last.length - 1].occurredAt),
  });
