import { CheckCircle2, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { confirmDialog } from '@/components/common/confirm-dialog';
import { StatusBadge } from '@/components/common/StatusBadge';
import { formatDateTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { downloadUrl } from '@/utils/money';
import { assetApi } from '../../api/asset.api';
import { useAssetMutation } from '../../hooks/useAssets';
import type { IHandover } from '../../types/asset.types';
import { HANDOVER_KIND, handoverState } from '../../utils/labels';

/**
 * Danh sách biên bản giao nhận: số, loại, thiết bị / nhân viên, trạng thái xác nhận, tải Word.
 * `canConfirm` (tab "Của tôi"): hiện nút "Xác nhận" cho biên bản đang chờ — back-end vẫn chỉ cho đúng người trong biên bản.
 */
export function HandoverList({ items, show, canConfirm = false, empty = 'Chưa có biên bản.' }: {
  /** Cột phụ: 'device' (đang ở chi tiết thiết bị) hiện nhân viên; 'employee' hiện thiết bị; 'both' hiện cả hai. */
  items: IHandover[]; show: 'device' | 'employee' | 'both'; canConfirm?: boolean; empty?: string;
}) {
  const confirm = useAssetMutation(assetApi.confirmHandover);
  const onConfirm = async (h: IHandover) => {
    const ok = await confirmDialog({
      title: `Xác nhận biên bản ${h.number}?`,
      description: h.kind === 'Assign'
        ? `Bạn xác nhận đã nhận thiết bị ${h.deviceCode} · ${h.deviceName}${h.serialNumber ? ` (serial ${h.serialNumber})` : ''} đúng như biên bản.`
        : `Bạn xác nhận đã trả thiết bị ${h.deviceCode} · ${h.deviceName} cho công ty.`,
      confirmText: 'Xác nhận',
    });
    if (ok) confirm.mutate(h.id, { onSuccess: () => toast.success('Đã xác nhận biên bản'), onError: (e) => toast.error(errorMessage(e)) });
  };
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="grid gap-1.5">
      {items.map((h) => {
        const st = handoverState(h);
        const pending = h.requiresConfirmation && !h.confirmedAt;
        return (
          <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm" data-testid="handover-row">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{h.number}</span>
                <span className="text-xs text-muted-foreground">{HANDOVER_KIND[h.kind]}</span>
                <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
              </div>
              <div className="text-xs text-muted-foreground">
                {show !== 'device' && <>{h.deviceCode} · {h.deviceName}</>}
                {show === 'both' && ' · '}
                {show !== 'employee' && <>{h.employeeName} ({h.employeeCode})</>}
                {' · '}lập {formatDateTime(h.createdAt)} bởi {h.createdByName}
                {h.confirmedAt && <> · xác nhận {formatDateTime(h.confirmedAt)}{h.confirmedIp ? ` (IP ${h.confirmedIp})` : ''}</>}
              </div>
              {h.note && <div className="text-xs">{h.note}</div>}
            </div>
            <div className="flex shrink-0 gap-1">
              {canConfirm && pending && (
                <Button size="sm" disabled={confirm.isPending} onClick={() => void onConfirm(h)} data-testid="handover-confirm"><CheckCircle2 /> Xác nhận</Button>
              )}
              <Button size="sm" variant="ghost" aria-label="Tải biên bản Word" onClick={() => downloadUrl(assetApi.handoverDocxUrl(h.id))}><FileDown /> Word</Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
