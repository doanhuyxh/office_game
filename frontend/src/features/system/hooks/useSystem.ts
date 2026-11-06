import { useQuery } from '@tanstack/react-query';
import { systemApi, systemKeys } from '../api/system.api';

export const useSystemInfo = () => useQuery({ queryKey: systemKeys.info, queryFn: systemApi.info, staleTime: 30_000 });
