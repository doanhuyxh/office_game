import { useQuery } from '@tanstack/react-query';
import type { IPageQuery } from '@/types/api';
import { aiUsageApi, aiUsageKeys } from '../api/aiUsage.api';
import type { IAiUsageFilter } from '../types/aiUsage.types';

export const useAiUsageSummary = (f: Partial<IAiUsageFilter>, enabled = true) =>
  useQuery({ queryKey: aiUsageKeys.summary(f), queryFn: () => aiUsageApi.summary(f), enabled, placeholderData: (prev) => prev });

export const useAiUsageSessions = (f: Partial<IAiUsageFilter>, q: IPageQuery) =>
  useQuery({ queryKey: aiUsageKeys.sessions(f, q), queryFn: () => aiUsageApi.sessions(f, q), placeholderData: (prev) => prev });
