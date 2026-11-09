import { useRef, useState } from 'react';
import { Download, Eye, FileText, ImagePlus, Receipt, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { confirmDialog } from '@/components/common/confirm-dialog';
import { Spinner } from '@/components/feedback/Spinner';
import { formatDate } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { assetApi } from '../../api/asset.api';
import { useAssetMutation, useDeviceAttachments } from '../../hooks/useAssets';
import type { AttachmentKind } from '../../types/asset.types';
import { ATTACHMENT_KIND, fileSize } from '../../utils/labels';

const KINDS: { kind: AttachmentKind; icon: typeof ImagePlus; add: string }[] = [
  { kind: 'Photo', icon: ImagePlus, add: 'Thêm ảnh' },
  { kind: 'Invoice', icon: Receipt, add: 'Thêm hoá đơn' },
  { kind: 'Other', icon: FileText, add: 'Tệp khác' },
];

/**
 * Ảnh / hoá đơn / tệp khác của thiết bị (HR): trình duyệt tải thẳng lên S3 (≤ 20 MB / tệp), xem, tải về, xoá (ẩn, file giữ lại).
 * Dùng trong chi tiết thiết bị.
 */
export function DeviceAttachments({ deviceId }: { deviceId: string }) {
  const { data = [], isLoading, error } = useDeviceAttachments(deviceId);
  const input = useRef<HTMLInputElement>(null);
  const kind = useRef<AttachmentKind>('Photo'); // ref: hộp chọn tệp mở xong mới đọc loại
  const [busy, setBusy] = useState(false);
  const upload = useAssetMutation((a: { kind: AttachmentKind; file: File }) => assetApi.uploadAttachment(deviceId, a.kind, a.file));
  const remove = useAssetMutation(assetApi.deleteAttachment);

  const open = async (id: string, download: boolean) => {
    try { window.open((await assetApi.attachmentUrl(id, download)).url, '_blank', 'noopener'); } catch (e) { toast.error(errorMessage(e)); }
  };
  const pick = (k: AttachmentKind) => {
    kind.current = k;
    if (input.current) { input.current.accept = ATTACHMENT_KIND[k].accept; input.current.click(); }
  };
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    for (const f of Array.from(files)) {
      try { await upload.mutateAsync({ kind: kind.current, file: f }); toast.success(`Đã tải ${f.name}`); } catch (e) { toast.error(errorMessage(e)); }
    }
    setBusy(false);
    if (input.current) input.current.value = '';
  };

  return (
    <section className="grid gap-2" data-testid="device-attachments">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Ảnh &amp; hoá đơn</h4>
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map(({ kind: k, icon: Icon, add }) => (
            <Button key={k} size="sm" variant="outline" disabled={busy} onClick={() => pick(k)}><Icon /> {add}</Button>
          ))}
        </div>
      </div>
      <input ref={input} type="file" multiple className="hidden" onChange={(e) => void onFiles(e.target.files)} data-testid="device-attachment-input" />
      {busy && <p className="text-xs text-muted-foreground">Đang tải lên…</p>}
      {isLoading ? <Spinner /> : error ? <p className="text-sm text-destructive">{errorMessage(error)}</p> : data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Chưa có ảnh hay hoá đơn. Ảnh: PNG, JPG, WEBP, HEIC · Hoá đơn: PDF, ảnh, XML hoá đơn điện tử · tối đa 20 MB / tệp.</p>
      ) : (
        <ul className="grid gap-1.5">
          {data.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm" data-testid="device-attachment-row">
              <div className="min-w-0">
                <div className="truncate font-medium" title={a.fileName}>{a.fileName}</div>
                <div className="text-xs text-muted-foreground">{ATTACHMENT_KIND[a.kind].label} · {fileSize(a.size)} · {a.createdByName} · {formatDate(a.createdAt)}</div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="icon" aria-label="Xem" onClick={() => void open(a.id, false)}><Eye /></Button>
                <Button variant="ghost" size="icon" aria-label="Tải về" onClick={() => void open(a.id, true)}><Download /></Button>
                <Button variant="ghost" size="icon" aria-label="Xoá tệp" onClick={async () => await confirmDialog({ title: `Xoá "${a.fileName}"?`, confirmText: 'Xoá', destructive: true })
                  && remove.mutate(a.id, { onSuccess: () => toast.success('Đã xoá'), onError: (e) => toast.error(errorMessage(e)) })}><Trash2 /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
