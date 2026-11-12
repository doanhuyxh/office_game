import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { systemApi, systemKeys } from '../api/system.api';
import type { ISaveSettingsRequest, ISettingsGroup, ISettingsTestRequest, SettingsGroupKey } from '../types/system.types';

export const useSystemInfo = () => useQuery({ queryKey: systemKeys.info, queryFn: systemApi.info, staleTime: 30_000 });
/** Tab Vận hành: chỉ tải khi mở tab; tự làm mới mỗi phút khi đang mở. */
export const useOpsReport = (enabled: boolean) =>
  useQuery({ queryKey: systemKeys.ops, queryFn: systemApi.ops, enabled, staleTime: 15_000, refetchInterval: enabled ? 60_000 : false });

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
  const load = useCallback(() => setEnabled(true), []);
  return { ...q, load, started: enabled, rescan, rescanning };
}

/** Cấu hình hệ thống (tab Cấu hình). */
export const useSystemSettings = () => useQuery({ queryKey: systemKeys.settings, queryFn: systemApi.settings });

/** Lưu / dùng lại .env cho một nhóm: cập nhật cache nhóm đó + làm mới tab Tổng quan (tình trạng S3 / SMTP). */
export function useSettingsMutations(group: SettingsGroupKey) {
  const qc = useQueryClient();
  const apply = (g: ISettingsGroup) => {
    qc.setQueryData<ISettingsGroup[]>(systemKeys.settings, (old) => old?.map((x) => (x.group === g.group ? g : x)));
    void qc.invalidateQueries({ queryKey: systemKeys.info });
  };
  const save = useMutation({ mutationFn: (body: ISaveSettingsRequest) => systemApi.saveSettings(group, body), onSuccess: apply });
  const reset = useMutation({ mutationFn: () => systemApi.resetSettings(group), onSuccess: apply });
  const test = useMutation({ mutationFn: (body: ISettingsTestRequest = {}) => systemApi.testSettings(group, body) });
  return { save, reset, test };
}
