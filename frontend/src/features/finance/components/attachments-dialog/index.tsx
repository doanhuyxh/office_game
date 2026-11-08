import { confirmDialog } from '@/components/common/confirm-dialog';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Download, Eye, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { Spinner } from '@/components/feedback/Spinner';
import { errorMessage } from '@/utils/errors';
import { financeApi } from '../../api/finance.api';
import { useAttachments, useFinanceMutation } from '../../hooks/useFinance';
import type { AttachmentOwner } from '../../types/finance.types';
import { fmtDate } from '../../utils/labels';

const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/**
 * Chứng từ của dòng sổ / đề nghị chi: xem, tải, thêm (PDF, ảnh, Excel, Word, XML hoá đơn điện tử, zip — ≤ 20 MB), xoá (ẩn, file giữ lại).
 * Quyền do back-end quyết; <paramref name="canUpload"/> chỉ để ẩn nút.
 */
export function AttachmentsDialog({ owner, title, canUpload, onClose }: {
  owner: { type: AttachmentOwner; id: string } | null; title: string; canUpload: boolean; onClose: () => void;
}) {
  const { data = [], isLoading, error } = useAttachments(owner?.type ?? 'Entry', owner?.id ?? null);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = useFinanceMutation((f: File) => financeApi.uploadAttachment(owner!.type, owner!.id, f));
  const remove = useFinanceMutation(financeApi.deleteAttachment);
  const open = async (id: string, download: boolean) => {
    try { window.open((await financeApi.attachmentUrl(id, download)).url, '_blank', 'noopener'); } catch (e) { toast.error(errorMessage(e)); }
  };
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    for (const f of Array.from(files)) {
      try { await upload.mutateAsync(f); toast.success(`Đã tải ${f.name}`); } catch (e) { toast.error(errorMessage(e)); }
    }
    setBusy(false);
    if (input.current) input.current.value = '';
  };
  return (
    <Dialog open={!!owner} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Chứng từ — {title}</DialogTitle>
          <DialogDescription>Hoá đơn, biên nhận, sao kê… (PDF, ảnh, Excel, Word, XML hoá đơn điện tử, zip — tối đa 20 MB / tệp).</DialogDescription>
        </DialogHeader>
        {isLoading ? <Spinner /> : error ? <p className="text-sm text-destructive">{errorMessage(error)}</p> : (
          <div className="grid gap-2">
            {data.length === 0 && <p className="text-sm text-muted-foreground">Chưa có chứng từ.</p>}
            {data.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm" data-testid="attachment-row">
                <div className="min-w-0">
                  <div className="truncate font-medium" title={a.fileName}>{a.fileName}</div>
                  <div className="text-xs text-muted-foreground">{size(a.size)} · {a.createdByName} · {fmtDate(a.createdAt.slice(0, 10))}
                    {owner?.type === 'Entry' && a.ownerType === 'Expense' && ' · từ đề nghị chi'}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon" aria-label="Xem" onClick={() => void open(a.id, false)}><Eye /></Button>
                  <Button variant="ghost" size="icon" aria-label="Tải về" onClick={() => void open(a.id, true)}><Download /></Button>
                  {a.canDelete && <Button variant="ghost" size="icon" aria-label="Xoá chứng từ" onClick={async () => await confirmDialog({ title: `Xoá chứng từ "${a.fileName}"?`, confirmText: 'Xoá', destructive: true })
                    && remove.mutate(a.id, { onSuccess: () => toast.success('Đã xoá'), onError: (e) => toast.error(errorMessage(e)) })}><Trash2 /></Button>}
                </div>
              </div>
            ))}
            {canUpload && (
              <>
                <input ref={input} type="file" multiple className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.xlsx,.xls,.csv,.docx,.doc,.xml,.zip,.txt"
                  onChange={(e) => void onFiles(e.target.files)} data-testid="attachment-input" />
                <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}><Upload /> {busy ? 'Đang tải…' : 'Thêm chứng từ'}</Button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
