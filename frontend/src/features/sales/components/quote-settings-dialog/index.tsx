import { confirmDialog } from '@/components/common/confirm-dialog';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileDown, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { downloadUrl } from '@/utils/money';
import { salesApi } from '../../api/sales.api';
import { useQuoteFields, useSalesMutation, useSalesSettings } from '../../hooks/useSales';

/** Cấu hình báo giá: ngưỡng chiết khấu cần duyệt (Quản trị tài chính), mẫu Word riêng của công ty (HR / Quản trị tài chính) + danh sách trường. */
export function QuoteSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSalesSettings().data;
  const fields = useQuoteFields(open).data ?? [];
  const [limit, setLimit] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const saveLimit = useSalesMutation((v: number) => salesApi.saveSettings(v));
  const upload = useSalesMutation(salesApi.uploadQuoteTemplate);
  const remove = useSalesMutation(salesApi.deleteQuoteTemplate);
  useEffect(() => { if (open && s) setLimit(String(s.quoteDiscountLimitPercent)); }, [open, s]);
  const errs = { ...fieldErrors(saveLimit.error), ...fieldErrors(upload.error) };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Cấu hình báo giá</DialogTitle>
          <DialogDescription>Ngưỡng chiết khấu: vượt ngưỡng phải qua người có quyền Duyệt chi. Mẫu Word: điền trường dạng {'{{SoBaoGia}}'}; dòng bảng có {'{{HM_…}}'} lặp theo hạng mục.</DialogDescription>
        </DialogHeader>
        {s && <div className="grid gap-4">
          <div className="flex items-end gap-2">
            <FormField id="qs-limit" label="Ngưỡng chiết khấu cần duyệt (%)" type="number" min={0} max={100} step="0.01" disabled={!s.canEditLimit}
              value={limit} onChange={(e) => setLimit(e.target.value)} error={errs.quoteDiscountLimitPercent} />
            {s.canEditLimit && <Button className="mb-1" disabled={saveLimit.isPending} onClick={() => saveLimit.mutate(Number(limit), {
              onSuccess: () => toast.success('Đã lưu ngưỡng'), onError: (e) => !Object.keys(fieldErrors(e)).length && toast.error(errorMessage(e)) })}>Lưu</Button>}
          </div>
          {!s.canEditLimit && <p className="-mt-3 text-xs text-muted-foreground">Chỉ người có quyền Quản trị tài chính đổi ngưỡng.</p>}
          <div className="grid gap-2 rounded-lg border p-3 text-sm">
            <div className="font-medium">Mẫu Word</div>
            <div>{s.quoteTemplateName ? <>Đang dùng mẫu của công ty: <b>{s.quoteTemplateName}</b></> : 'Đang dùng mẫu mặc định của hệ thống.'}</div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => downloadUrl(salesApi.defaultQuoteTemplateUrl)}><FileDown /> Tải mẫu mặc định để sửa</Button>
              {s.canEditTemplate && <>
                <input ref={input} type="file" accept=".docx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f, {
                  onSuccess: () => toast.success('Đã dùng mẫu mới'), onError: (er) => !Object.keys(fieldErrors(er)).length && toast.error(errorMessage(er)) }); e.target.value = ''; }} />
                <Button size="sm" disabled={upload.isPending} onClick={() => input.current?.click()}><Upload /> Tải mẫu riêng (.docx)</Button>
                {s.quoteTemplateName && <Button size="sm" variant="ghost" onClick={async () => await confirmDialog({ title: 'Quay về mẫu mặc định?', description: 'Mẫu báo giá riêng sẽ bị bỏ.', confirmText: 'Bỏ mẫu riêng', destructive: true }) && remove.mutate(undefined, { onError: (er) => toast.error(errorMessage(er)) })}><Trash2 /> Bỏ mẫu riêng</Button>}
              </>}
            </div>
            {errs.file && <p className="text-xs text-destructive">{errs.file}</p>}
            <details><summary className="cursor-pointer text-xs text-muted-foreground">Danh sách trường ({fields.length})</summary>
              <div className="mt-2 grid gap-1 text-xs">{fields.map((x) => <div key={x.name}><code>{`{{${x.name}}}`}</code> — {x.description}{x.example && <span className="text-muted-foreground"> (vd: {x.example})</span>}</div>)}</div>
            </details>
          </div>
        </div>}
        <DialogFooter><Button variant="outline" onClick={onClose}>Đóng</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
