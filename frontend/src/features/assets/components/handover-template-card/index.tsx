import { useRef } from 'react';
import { FileDown, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { confirmDialog } from '@/components/common/confirm-dialog';
import { formatDateTime } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { downloadUrl } from '@/utils/money';
import { assetApi } from '../../api/asset.api';
import { useAssetMutation, useAssetSettings, useTemplateFields } from '../../hooks/useAssets';

/** Mẫu Word biên bản giao nhận thiết bị (HR): tải mẫu mặc định để sửa, tải mẫu riêng (.docx có trường {{…}}), quay về mẫu mặc định. */
export function HandoverTemplateCard() {
  const { data: s } = useAssetSettings();
  const fields = useTemplateFields().data ?? [];
  const input = useRef<HTMLInputElement>(null);
  const upload = useAssetMutation(assetApi.uploadTemplate);
  const remove = useAssetMutation(assetApi.deleteTemplate);
  const errs = fieldErrors(upload.error);
  return (
    <section className="grid gap-2 rounded-xl border bg-card p-4 text-sm" data-testid="handover-template">
      <h3 className="font-semibold">Mẫu biên bản giao nhận (Word)</h3>
      <div>
        {s?.handoverTemplateName ? <>Đang dùng mẫu của công ty: <b>{s.handoverTemplateName}</b></> : 'Đang dùng mẫu mặc định của hệ thống.'}
        {s?.updatedAt && <span className="text-xs text-muted-foreground"> · đổi {formatDateTime(s.updatedAt)}{s.updatedByName ? ` bởi ${s.updatedByName}` : ''}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => downloadUrl(assetApi.defaultTemplateUrl)}><FileDown /> Tải mẫu mặc định để sửa</Button>
        <input ref={input} type="file" accept=".docx" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload.mutate(f, { onSuccess: () => toast.success('Đã dùng mẫu mới'), onError: (er) => !Object.keys(fieldErrors(er)).length && toast.error(errorMessage(er)) });
          e.target.value = '';
        }} />
        <Button size="sm" disabled={upload.isPending} onClick={() => input.current?.click()}><Upload /> Tải mẫu riêng (.docx)</Button>
        {s?.handoverTemplateName && (
          <Button size="sm" variant="ghost" onClick={async () => await confirmDialog({ title: 'Quay về mẫu mặc định?', description: 'Mẫu biên bản riêng sẽ bị bỏ.', confirmText: 'Bỏ mẫu riêng', destructive: true })
            && remove.mutate(undefined, { onError: (er) => toast.error(errorMessage(er)) })}><Trash2 /> Bỏ mẫu riêng</Button>
        )}
      </div>
      {errs.file && <p className="text-xs text-destructive">{errs.file}</p>}
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">Danh sách trường ({fields.length})</summary>
        <div className="mt-2 grid gap-1 text-xs">
          {fields.map((x) => <div key={x.name}><code>{`{{${x.name}}}`}</code> — {x.description}{x.example && <span className="text-muted-foreground"> (vd: {x.example})</span>}</div>)}
        </div>
      </details>
    </section>
  );
}
