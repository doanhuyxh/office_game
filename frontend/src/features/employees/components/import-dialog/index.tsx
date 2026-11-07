import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { Input } from '@/components/common/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { ApiError } from '@/services/api-client';
import { formatDate } from '@/utils/date';
import { cn } from '@/utils/cn';
import { errorMessage } from '@/utils/errors';
import { downloadUrl } from '@/utils/money';
import { employeesApi, orgKeys } from '../../api/org.api';
import type { IImportPreview } from '../../types/employee.types';

/** Nhập nhân viên từ Excel: tải mẫu → chọn file → xem trước (lỗi từng dòng) → nhập (có lỗi thì không nhập dòng nào). */
export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<IImportPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => { setFile(null); setPreview(null); if (fileRef.current) fileRef.current.value = ''; };
  const close = (o: boolean) => { if (!o) { onOpenChange(false); setTimeout(reset, 200); } };

  const pick = async (f: File | null) => {
    setFile(f);
    setPreview(null);
    if (!f) return;
    setBusy(true);
    try { setPreview(await employeesApi.importPreview(f)); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const commit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await employeesApi.importCommit(file);
      toast.success(`Đã nhập ${r.created} nhân viên (${r.codes.slice(0, 5).join(', ')}${r.codes.length > 5 ? '…' : ''}). Cấp tài khoản ở từng nhân viên.`);
      await qc.invalidateQueries({ queryKey: orgKeys.all });
      close(false);
    } catch (err) {
      // 400 kèm bản xem trước mới (dữ liệu đã đổi giữa lúc xem và lúc nhập)
      if (err instanceof ApiError && Array.isArray((err.problem as unknown as IImportPreview).rows)) setPreview(err.problem as unknown as IImportPreview);
      else toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };

  const ok = preview && !preview.fileError && preview.errorCount === 0 && preview.validCount > 0;
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Nhập nhân viên từ Excel</DialogTitle>
          <DialogDescription>
            Dùng file mẫu (dòng 1 là tiêu đề). Phòng ban, chức vụ phải có sẵn; mã NV để trống sẽ tự cấp. Có lỗi ở bất kỳ dòng nào thì chưa nhập — sửa file rồi chọn lại.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => downloadUrl(employeesApi.importTemplateUrl)}><Download className="size-4" /> Tải file mẫu</Button>
          <Input ref={fileRef} type="file" accept=".xlsx" className="max-w-sm" onChange={(e) => pick(e.target.files?.[0] ?? null)} aria-label="Chọn file Excel" />
          {busy && <span className="text-sm text-muted-foreground">Đang kiểm tra…</span>}
        </div>

        {preview?.fileError && (
          <div className="flex gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{preview.fileError}</div>
        )}
        {preview && !preview.fileError && (
          <>
            <div className={cn('flex items-center gap-2 text-sm', preview.errorCount ? 'text-destructive' : 'text-success')}>
              {preview.errorCount ? <AlertTriangle className="size-4" /> : <CheckCircle2 className="size-4" />}
              {preview.validCount} dòng hợp lệ{preview.errorCount ? ` · ${preview.errorCount} dòng có lỗi` : ' — sẵn sàng nhập'}
            </div>
            <div className="max-h-[50vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Dòng</TableHead><TableHead>Mã</TableHead><TableHead>Họ tên</TableHead><TableHead>Email</TableHead>
                    <TableHead>Phòng ban</TableHead><TableHead>Chức vụ</TableHead><TableHead>Quản lý</TableHead><TableHead>Vào làm</TableHead><TableHead>Trạng thái</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((r) => (
                    <TableRow key={r.row} className={r.errors.length ? 'bg-destructive/5' : undefined}>
                      <TableCell className="text-muted-foreground">{r.row}</TableCell>
                      <TableCell className="font-mono text-xs">{r.code}</TableCell>
                      <TableCell>
                        {r.fullName ?? <span className="text-muted-foreground">—</span>}
                        {r.errors.map((e) => <div key={e} className="text-xs text-destructive">{e}</div>)}
                      </TableCell>
                      <TableCell className="text-xs">{r.email}</TableCell>
                      <TableCell className="text-xs">{r.departmentName}</TableCell>
                      <TableCell className="text-xs">{r.positionName}{r.jobTitle && <div className="text-muted-foreground">{r.jobTitle}</div>}</TableCell>
                      <TableCell className="text-xs">{r.managerCode && `${r.managerCode}${r.managerName ? ` · ${r.managerName}` : ''}`}</TableCell>
                      <TableCell className="text-xs">{r.joinedAt ? formatDate(r.joinedAt) : ''}</TableCell>
                      <TableCell className="text-xs">{r.status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>Đóng</Button>
          <Button disabled={!ok || busy} onClick={commit}><FileSpreadsheet className="size-4" /> Nhập {preview?.validCount ?? 0} nhân viên</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
