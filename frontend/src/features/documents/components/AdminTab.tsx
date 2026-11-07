import { useState } from 'react';
import { AlertTriangle, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { SearchSelectField } from '@/components/common/SearchSelectField';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { Spinner } from '@/components/feedback/Spinner';
import { useEmployees } from '@/features/employees';
import { formatDate } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { documentApi } from '../api/document.api';
import { useDocMutation, useDocStats, useDocTypes, useOrphans, useRetentionDue } from '../hooks/useDocuments';
import type { ICountSize, IDocType, IOrphan } from '../types/document.types';
import { formatSize } from '../utils/labels';
import { AssetTable } from './AssetTable';

/** Quản trị kho (HR / admin): bảng tài sản số, tài liệu đến hạn lưu trữ, bàn giao tài liệu người nghỉ việc, loại tài liệu. */
export function AdminTab({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <div className="grid gap-6">
      <Stats />
      <RetentionDue onOpen={onOpen} />
      <Orphans />
      <DocTypes />
    </div>
  );
}

function Stat({ label, value, hint, warn }: { label: string; value: string | number; hint?: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${warn ? 'text-warning' : ''}`}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** Thanh ngang theo dung lượng (độ dài so với mục lớn nhất). */
function Bars({ title, rows, by = 'size' }: { title: string; rows: ICountSize[]; by?: 'size' | 'count' }) {
  const max = Math.max(1, ...rows.map((r) => (by === 'size' ? r.size : r.count)));
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">Chưa có dữ liệu.</p> : (
        <ul className="grid gap-2 text-sm">
          {rows.map((r) => (
            <li key={r.key} className="grid gap-1">
              <div className="flex justify-between gap-2"><span className="truncate">{r.label}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">{r.count} · {formatSize(r.size)}</span></div>
              <div className="h-1.5 overflow-hidden rounded bg-muted">
                <div className="h-full rounded bg-primary" style={{ width: `${((by === 'size' ? r.size : r.count) / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 12 tháng gần nhất: cột theo số tài liệu tải lên, rê chuột xem dung lượng. */
function Monthly({ rows }: { rows: ICountSize[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">Tải lên 12 tháng gần nhất</h3>
      <div className="grid h-36 grid-cols-12 items-end gap-1.5">
        {rows.map((r) => (
          <div key={r.key} className="flex h-full flex-col items-center justify-end gap-1" title={`${r.label}: ${r.count} tài liệu · ${formatSize(r.size)}`}>
            <span className="text-[10px] text-muted-foreground tabular-nums">{r.count || ''}</span>
            <div className="w-full rounded-t bg-primary" style={{ height: `${(r.count / max) * 100}%`, minHeight: r.count ? 2 : 0 }} />
            <span className="text-[10px] text-muted-foreground">{r.label.replace(/\/\d+$/, '')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stats() {
  const { data, isLoading } = useDocStats();
  if (isLoading || !data) return <Spinner />;
  return (
    <section className="grid gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Tài liệu" value={data.totalAssets.toLocaleString('vi-VN')} hint={`${data.published} ban hành · ${data.drafts} nháp · ${data.pending} chờ duyệt`} />
        <Stat label="Dung lượng" value={formatSize(data.totalSize)} hint="Tính cả mọi phiên bản" />
        <Stat label="Sắp hết hạn lưu trữ" value={data.retentionDueCount} hint="Trong 30 ngày tới" warn={data.retentionDueCount > 0} />
        <Stat label="Chưa bàn giao" value={data.orphanCount} hint={`Người phụ trách đã nghỉ · ${data.trashCount} trong thùng rác`} warn={data.orphanCount > 0} />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Bars title="Theo kho" rows={data.bySpace} />
        <Bars title="Theo nhóm file" rows={data.byKind} />
        <Bars title="Theo loại tài liệu" rows={data.byType} by="count" />
      </div>
      <Monthly rows={data.monthly} />
    </section>
  );
}

function RetentionDue({ onOpen }: { onOpen: (id: string) => void }) {
  const pg = usePageState('doc-retention');
  const { data, isLoading } = useRetentionDue(pg.query);
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-semibold">Đến hạn xem xét lưu trữ</h3>
      <p className="text-xs text-muted-foreground">Mở tài liệu để gia hạn ("Đổi hạn lưu trữ") hoặc huỷ (xoá file, giữ biên bản). HR và người phụ trách được nhắc trước 30 ngày.</p>
      <div className="rounded-xl border bg-card">
        <AssetTable rows={data?.items ?? []} loading={isLoading} onOpen={(r) => onOpen(r.id)} empty="Không có tài liệu nào sắp hết hạn."
          extraHead="Hạn" extra={(r) => <span className="text-warning">{r.retentionUntil && formatDate(r.retentionUntil)}</span>} />
        <TablePagination state={pg} total={data?.total} unit="tài liệu" />
      </div>
    </section>
  );
}

function Orphans() {
  const { data = [], isLoading } = useOrphans();
  const [from, setFrom] = useState<IOrphan | null>(null);
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-semibold">Bàn giao tài liệu của người nghỉ việc</h3>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Nhân viên</TableHead><TableHead>Nghỉ ngày</TableHead><TableHead className="text-right">Tài liệu</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={4}><Spinner /></TableCell></TableRow>}
            {!isLoading && data.length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">Không có tài liệu nào chờ bàn giao.</TableCell></TableRow>}
            {data.map((o) => (
              <TableRow key={o.employeeId}>
                <TableCell><span className="flex items-center gap-2"><AlertTriangle className="size-4 text-warning" />{o.fullName} <span className="text-xs text-muted-foreground">{o.code}</span></span></TableCell>
                <TableCell>{o.leftAt ? formatDate(o.leftAt) : '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{o.assetCount} · {formatSize(o.size)}</TableCell>
                <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => setFrom(o)}>Bàn giao</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <HandoverDialog from={from} onClose={() => setFrom(null)} />
    </section>
  );
}

function HandoverDialog({ from, onClose }: { from: IOrphan | null; onClose: () => void }) {
  const employees = useEmployees();
  const [to, setTo] = useState<string | null>(null);
  const run = useDocMutation(() => documentApi.handover(from!.employeeId, to!));
  if (!from) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bàn giao tài liệu của {from.fullName}</DialogTitle>
          <DialogDescription>{from.assetCount} tài liệu chuyển sang người nhận làm người phụ trách; người nhận cũng được thêm vào các dự án người cũ tham gia.</DialogDescription>
        </DialogHeader>
        <SearchSelectField id="ho-to" label="Người nhận *" value={to} onChange={setTo}
          options={(employees.data ?? []).filter((e) => e.status !== 'Resigned').map((e) => ({ value: e.id, label: `${e.fullName} (${e.code}${e.departmentName ? ` · ${e.departmentName}` : ''})` }))} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Huỷ</Button>
          <Button disabled={!to || run.isPending}
            onClick={() => run.mutate(undefined, { onSuccess: (n) => { toast.success(`Đã bàn giao ${n} tài liệu`); onClose(); }, onError: (e) => toast.error(errorMessage(e)) })}>
            Bàn giao
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocTypes() {
  const { data = [], isLoading } = useDocTypes();
  const [edit, setEdit] = useState<IDocType | 'new' | null>(null);
  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Loại tài liệu &amp; hạn lưu trữ</h3>
        <Button size="sm" variant="outline" onClick={() => setEdit('new')}><Plus /> Thêm loại</Button>
      </div>
      <p className="text-xs text-muted-foreground">Mã loại dùng trong số hiệu ban hành (vd 012/2026/QĐ-KTH). Hạn lưu trữ tính từ ngày ban hành (chưa ban hành: từ ngày tạo); đổi số năm chỉ áp dụng cho tài liệu mới. Số năm mặc định chỉ để tham khảo — nhờ kế toán xác nhận.</p>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Mã</TableHead><TableHead>Tên</TableHead><TableHead>Lưu trữ</TableHead><TableHead>Trạng thái</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={5}><Spinner /></TableCell></TableRow>}
            {data.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.code}</TableCell><TableCell>{t.name}</TableCell>
                <TableCell>{t.retentionYears ? `${t.retentionYears} năm` : 'Vĩnh viễn'}</TableCell>
                <TableCell>{t.isActive ? 'Đang dùng' : <span className="text-muted-foreground">Ngừng dùng</span>}</TableCell>
                <TableCell className="text-right"><Button size="icon-sm" variant="ghost" aria-label={`Sửa ${t.name}`} onClick={() => setEdit(t)}><Pencil /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <DocTypeDialog type={edit} next={data.length + 1} onClose={() => setEdit(null)} />
    </section>
  );
}

function DocTypeDialog({ type, next, onClose }: { type: IDocType | 'new' | null; next: number; onClose: () => void }) {
  const t = type === 'new' ? null : type;
  const [form, setForm] = useState({ code: '', name: '', years: '', sortOrder: next, isActive: true });
  const [seen, setSeen] = useState<typeof type>(null);
  if (type !== seen) {
    setSeen(type);
    setForm(t ? { code: t.code, name: t.name, years: t.retentionYears?.toString() ?? '', sortOrder: t.sortOrder, isActive: t.isActive }
      : { code: '', name: '', years: '', sortOrder: next, isActive: true });
  }
  const save = useDocMutation(() => documentApi.saveDocType({ id: t?.id, code: form.code.trim(), name: form.name.trim(),
    retentionYears: form.years ? Number(form.years) : null, sortOrder: form.sortOrder, isActive: form.isActive }));
  const errors = fieldErrors(save.error);
  if (!type) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t ? `Sửa loại ${t.code}` : 'Thêm loại tài liệu'}</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined, { onSuccess: () => { toast.success('Đã lưu'); onClose(); }, onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)) }); }}>
          <div className="grid grid-cols-[6rem_1fr] gap-3">
            <FormField id="dt-code" label="Mã *" maxLength={10} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} error={errors.code} />
            <FormField id="dt-name" label="Tên *" maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="dt-years" label="Lưu trữ (năm)" type="number" min={1} max={100} placeholder="Trống = vĩnh viễn" value={form.years}
              onChange={(e) => setForm({ ...form, years: e.target.value })} error={errors.retentionYears} />
            <FormField id="dt-sort" label="Thứ tự" type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} />
          </div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.isActive} onCheckedChange={(c) => setForm({ ...form, isActive: c === true })} /> Đang dùng</label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
            <Button type="submit" disabled={save.isPending || !form.code.trim() || !form.name.trim()}>Lưu</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
