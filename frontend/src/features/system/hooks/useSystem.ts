import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { systemApi, systemKeys } from '../api/system.api';

export const useSystemInfo = () => useQuery({ queryKey: systemKeys.info, queryFn: systemApi.info, staleTime: 30_000 });

/** Báo cáo dung lượng S3: chỉ tải khi bấm (quét có thể mất vài giây); `rescan` bắt server quét lại. */
export function useStorageReport() {
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const q = useQuery({ queryKey: systemKeys.storage, queryFn: () => systemApi.storage(), enabled, staleTime: 5 * 60_000 });
  const [rescanning, setRescanning] = useState(false);
  const rescan = async () => {
    setRescanning(true);
    try { qc.setQueryData(systemKeys.storage, await systemApi.storage(true)); } finally { setRescanning(false); }
  };
  return { ...q, load: () => setEnabled(true), started: enabled, rescan, rescanning };
}
