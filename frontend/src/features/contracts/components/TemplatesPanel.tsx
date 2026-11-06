import { useRef, useState } from 'react';
import { AlertTriangle, Download, FileText, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { SelectField } from '@/components/common/SelectField';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { formatDate } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { downloadUrl } from '@/utils/money';
import { contractApi } from '../api/contract.api';
import { useRemoveTemplate, useTemplateFields, useTemplates, useUploadTemplate } from '../hooks/useContracts';
import type { IContract } from '../types/contract.types';
import { CONTRACT_TYPE } from '../utils/labels';

const TYPE_OPTIONS = Object.entries(CONTRACT_TYPE).map(([value, label]) => ({ value, label }));

/** HR: tải mẫu Word (.docx) có {{TenTruong}}, xem danh sách trường hỗ trợ. */
export function TemplatesPanel() {
  const templates = useTemplates();
  const fields = useTemplateFields();
  const upload = useUploadTemplate();
  const remove = useRemoveTemplate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<string | null>(null);
  const errors = fieldErrors(upload.error);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    upload.mutate({ file, name: name.trim(), contractType: type }, {
      onSuccess: (t) => {
        toast.success(t.unknownFields.length ? `Đã tải mẫu. Trường không hỗ trợ (sẽ giữ nguyên): ${t.unknownFields.join(', ')}` : 'Đã tải mẫu');
        setFile(null); setName(''); setType(null);
        if (fileRef.current) fileRef.current.value = '';
      },
      onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
    });
  };

  const openOriginal = async (id: string) => {
    try { downloadUrl((await contractApi.templateFileUrl(id)).url); } catch (err) { toast.error(errorMessage(err)); }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="grid content-start gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tải mẫu mới</CardTitle>
            <CardDescription>
              Soạn hợp đồng trong Word như bình thường, chỗ cần điền gõ <code className="font-mono">{'{{TenTruong}}'}</code> (vd <code className="font-mono">{'{{HoTen}}'}</code>),
              lưu dạng .docx rồi tải lên. Thông tin cố định của công ty (tên, địa chỉ, người đại diện) gõ thẳng vào mẫu.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
              <FormField id="tpl-name" label="Tên mẫu *" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Vd: HĐLĐ xác định thời hạn 2026" error={errors.name} />
              <SelectField id="tpl-type" label="Dùng cho loại" value={type} onChange={setType} options={TYPE_OPTIONS} allowEmpty emptyLabel="— Mọi loại —" />
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="tpl-file">File Word (.docx, ≤ 5 MB) *</Label>
                <Input id="tpl-file" ref={fileRef} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-invalid={!!errors.file} />
                {errors.file && <p className="text-xs text-destructive">{errors.file}</p>}
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={!file || !name.trim() || upload.isPending}><Upload className="size-4" /> {upload.isPending ? 'Đang tải…' : 'Tải mẫu lên'}</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mẫu đã có</CardTitle>
            <CardDescription>Xuất hợp đồng: ở tab "Tất cả hợp đồng", bấm ⋯ ở dòng hợp đồng → "Xuất từ mẫu…".</CardDescription>
          </CardHeader>
          <CardContent>
            {!templates.data?.length ? <p className="py-4 text-center text-sm text-muted-foreground">{templates.isLoading ? 'Đang tải…' : 'Chưa có mẫu nào.'}</p> : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Tên mẫu</TableHead><TableHead>Loại</TableHead><TableHead>Trường</TableHead><TableHead>Tải lên</TableHead><TableHead className="w-0" /></TableRow>
                  </TableHeader>
                  <TableBody>
                    {templates.data.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium"><FileText className="mr-1 inline size-4 text-muted-foreground" />{t.name}
                          <div className="text-xs text-muted-foreground">{t.fileName}</div></TableCell>
                        <TableCell className="text-sm">{t.contractType ? CONTRACT_TYPE[t.contractType] : 'Mọi loại'}</TableCell>
                        <TableCell className="text-xs">
                          {t.fields.length} trường
                          {t.unknownFields.length > 0 && (
                            <div className="flex items-center gap-1 text-warning" title="Hệ thống không hỗ trợ — giữ nguyên khi xuất">
                              <AlertTriangle className="size-3.5" />{t.unknownFields.join(', ')}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{formatDate(t.createdAt)}<div className="text-xs text-muted-foreground">{t.createdByName}</div></TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Button size="icon" variant="ghost" className="size-8" aria-label="Tải file mẫu gốc" onClick={() => openOriginal(t.id)}><Download className="size-4" /></Button>
                          <Button size="icon" variant="ghost" className="size-8 text-destructive" aria-label="Xoá mẫu"
                            onClick={() => confirm(`Xoá mẫu "${t.name}"?`) && remove.mutate(t.id, { onSuccess: () => toast.success('Đã xoá mẫu'), onError: (e) => toast.error(errorMessage(e)) })}>
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="content-start">
        <CardHeader>
          <CardTitle className="text-base">Trường dùng được</CardTitle>
          <CardDescription>Không phân biệt hoa thường. Bấm để chép.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1.5">
          {fields.data?.map((f) => (
            <button key={f.name} type="button" className="rounded-md px-2 py-1 text-left text-sm hover:bg-muted"
              onClick={() => { void navigator.clipboard.writeText(`{{${f.name}}}`); toast.success(`Đã chép {{${f.name}}}`); }}>
              <code className="font-mono text-xs text-primary">{`{{${f.name}}}`}</code>
              <div className="text-xs text-muted-foreground">{f.description} · vd: {f.example}</div>
            </button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/** Chọn mẫu → tải hợp đồng đã điền (.docx) để in / ký. */
export function GenerateFromTemplateDialog({ contract, onClose }: { contract: IContract | null; onClose: () => void }) {
  const templates = useTemplates(!!contract);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const options = (templates.data ?? [])
    .filter((t) => !t.contractType || t.contractType === contract?.type)
    .map((t) => ({ value: t.id, label: t.name }));
  const picked = templateId ?? options[0]?.value ?? null;
  return (
    <Dialog open={!!contract} onOpenChange={(o) => { if (!o) { onClose(); setTemplateId(null); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Xuất hợp đồng {contract?.number} từ mẫu</DialogTitle>
          <DialogDescription>
            {contract?.employee.fullName}. File Word được điền sẵn thông tin nhân viên và hợp đồng; in, ký rồi tải bản đã ký vào mục file của hợp đồng.
          </DialogDescription>
        </DialogHeader>
        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">{templates.isLoading ? 'Đang tải…' : 'Chưa có mẫu phù hợp loại hợp đồng này. Tải mẫu ở tab "Mẫu hợp đồng".'}</p>
        ) : (
          <SelectField id="gen-tpl" label="Mẫu" value={picked} onChange={setTemplateId} options={options} />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Đóng</Button>
          <Button disabled={!picked || !contract} onClick={() => { if (contract && picked) { downloadUrl(contractApi.generateUrl(contract.id, picked)); onClose(); } }}>
            <Download className="size-4" /> Tải file Word
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
