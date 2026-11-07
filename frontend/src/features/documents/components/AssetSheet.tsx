import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Download, History, RotateCcw, Send, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { FormField } from '@/components/common/FormField';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { SelectField } from '@/components/common/SelectField';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/common/sheet';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Textarea } from '@/components/common/textarea';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { Spinner } from '@/components/feedback/Spinner';
import { useEmployees } from '@/features/employees';
import { formatDate, formatDateTime } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { documentApi } from '../api/document.api';
import { useAccessLog, useAsset, useDocMutation, useDocTypes, useFolders } from '../hooks/useDocuments';
import type { IAssetDetail, IFileUrl, IFolder, IUpdateAsset } from '../types/document.types';
import { formatSize, KIND, STATUS } from '../utils/labels';
import { uploadNewVersion } from '../utils/upload';
import { PromptDialog, type PromptSpec } from './PromptDialog';

/** Đường dẫn đầy đủ của thư mục: "Hợp đồng / 2026". */
export function folderOptions(folders: IFolder[]) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path = (f: IFolder) => {
    const parts: string[] = [];
    for (let c: IFolder | undefined = f; c && parts.length < 30; c = c.parentId ? byId.get(c.parentId) : undefined) parts.unshift(c.name);
    return parts.join(' / ');
  };
  return folders.map((f) => ({ value: f.id, label: path(f) })).sort((a, b) => a.label.localeCompare(b.label, 'vi'));
}

/** Chi tiết tài liệu (sheet bên phải): xem trước, tải về, sửa thông tin, phiên bản, vòng đời, nhật ký truy cập. */
export function AssetSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading, error } = useAsset(id);
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl" data-testid="asset-sheet">
        {isLoading && <div className="p-6"><Spinner /></div>}
        {error && <div className="p-6 text-sm text-destructive">{errorMessage(error)}</div>}
        {data && <Detail key={data.asset.id} d={data} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}

function Detail({ d, onClose }: { d: IAssetDetail; onClose: () => void }) {
  const a = d.asset;
  const k = KIND[a.kind];
  const [prompt, setPrompt] = useState<PromptSpec | null>(null);
  const run = useDocMutation((f: () => Promise<unknown>) => f());
  const act = (f: () => Promise<unknown>, ok: string, close = false) =>
    run.mutate(f, { onSuccess: () => { toast.success(ok); if (close) onClose(); }, onError: (e) => toast.error(errorMessage(e)) });
  const download = async (version?: number) => {
    try {
      const f = await documentApi.fileUrl(a.id, version, true);
      window.location.assign(f.url);
    } catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <div className="grid gap-5 px-4 pb-6">
      <SheetHeader className="px-0">
        <SheetTitle className="flex items-start gap-2 pr-8"><k.icon className={`mt-1 size-5 shrink-0 ${k.className}`} /><span>{a.title}</span></SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</StatusBadge>
          <span>{a.code}</span>
          {a.documentNumber && <span className="font-medium text-foreground">Số {a.documentNumber}</span>}
        </SheetDescription>
      </SheetHeader>

      {d.rejectReason && a.status === 'Draft' && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">Bị từ chối ban hành: {d.rejectReason}</div>
      )}
      {a.status === 'Destroyed' && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          Đã huỷ ngày {d.destroyedAt && formatDateTime(d.destroyedAt)} bởi {d.destroyedByName}. Lý do: {d.destroyReason}. File đã xoá khỏi kho, chỉ còn hồ sơ.
        </div>
      )}
      {a.deletedAt && <div className="rounded-md bg-warning/10 p-3 text-sm text-warning">Trong thùng rác (xoá bởi {d.deletedByName}) — tự xoá hẳn sau 30 ngày.</div>}

      {a.status !== 'Destroyed' && !a.deletedAt && <Preview assetId={a.id} version={a.currentVersion} />}

      <div className="flex flex-wrap gap-2">
        {a.status !== 'Destroyed' && <Button size="sm" variant="outline" onClick={() => download()}><Download /> Tải về</Button>}
        {d.can.submit && (
          <Button size="sm" onClick={() => setPrompt({ title: 'Gửi duyệt ban hành?', confirm: 'Gửi duyệt',
            description: 'Quản lý trực tiếp của bạn duyệt (không có thì HR). Duyệt xong tài liệu được cấp số hiệu và khoá nội dung.',
            onConfirm: () => run.mutateAsync(() => documentApi.submit(a.id)).then(() => toast.success('Đã gửi duyệt')) })}>
            <Send /> Gửi duyệt ban hành
          </Button>
        )}
        {d.can.archive && <Button size="sm" variant="outline" onClick={() => act(() => documentApi.archive(a.id), 'Đã chuyển sang lưu trữ')}><Archive /> Lưu trữ</Button>}
        {d.can.delete && (
          <Button size="sm" variant="outline" className="text-destructive" onClick={() => setPrompt({ title: 'Chuyển vào thùng rác?', confirm: 'Xoá', destructive: true,
            description: 'Khôi phục được trong 30 ngày (tab Thùng rác).', onConfirm: () => run.mutateAsync(() => documentApi.trashAsset(a.id)).then(() => { toast.success('Đã chuyển vào thùng rác'); onClose(); }) })}>
            <Trash2 /> Xoá
          </Button>
        )}
        {d.can.restore && <Button size="sm" variant="outline" onClick={() => act(() => documentApi.restore(a.id), 'Đã khôi phục')}><RotateCcw /> Khôi phục</Button>}
        {d.can.purge && (
          <Button size="sm" variant="outline" className="text-destructive" onClick={() => setPrompt({ title: 'Xoá hẳn tài liệu?', confirm: 'Xoá hẳn', destructive: true,
            description: 'Xoá mọi phiên bản trên kho, không khôi phục được.', onConfirm: () => run.mutateAsync(() => documentApi.purge(a.id)).then(() => { toast.success('Đã xoá hẳn'); onClose(); }) })}>
            <Trash2 /> Xoá hẳn
          </Button>
        )}
        {d.can.hrAdmin && a.status !== 'Destroyed' && !a.deletedAt && a.status !== 'PendingApproval' && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setPrompt({ title: 'Đổi hạn lưu trữ', input: 'date', label: 'Lưu đến ngày (để trống = vĩnh viễn)',
              initial: a.retentionUntil ?? '', confirm: 'Lưu', onConfirm: (v) => run.mutateAsync(() => documentApi.setRetention(a.id, v || null)).then(() => toast.success('Đã đổi hạn lưu trữ')) })}>
              Đổi hạn lưu trữ
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setPrompt({ title: `Huỷ tài liệu ${a.code}?`, input: 'text', label: 'Lý do huỷ *', required: true,
              confirm: 'Huỷ tài liệu', destructive: true,
              description: 'Xoá file mọi phiên bản khỏi kho, chỉ giữ hồ sơ (mã, số hiệu, người huỷ, lý do) làm biên bản. Không khôi phục được.',
              onConfirm: (v) => run.mutateAsync(() => documentApi.destroy(a.id, v)).then(() => toast.success('Đã huỷ tài liệu')) })}>
              Huỷ tài liệu
            </Button>
          </>
        )}
      </div>

      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Kho</dt><dd>{d.spaceName}{d.folderPath ? ` / ${d.folderPath}` : ''}</dd>
        <dt className="text-muted-foreground">Loại</dt><dd>{a.docTypeName} · {k.label}</dd>
        <dt className="text-muted-foreground">Dung lượng</dt><dd>{formatSize(a.size)}{a.currentVersion > 1 ? ` (tất cả ${a.currentVersion} phiên bản: ${formatSize(a.totalSize)})` : ''}</dd>
        <dt className="text-muted-foreground">Người tạo</dt><dd>{a.createdByName ?? '—'} · {formatDateTime(a.createdAt)}</dd>
        <dt className="text-muted-foreground">Phụ trách</dt><dd><Custodian d={d} /></dd>
        {d.publishedAt && <><dt className="text-muted-foreground">Ban hành</dt><dd>{formatDate(d.publishedAt)}</dd></>}
        <dt className="text-muted-foreground">Lưu đến</dt><dd>{a.retentionUntil ? formatDate(a.retentionUntil) : 'Vĩnh viễn'}</dd>
      </dl>

      {d.can.edit ? <EditForm d={d} /> : (d.description && <p className="whitespace-pre-line text-sm">{d.description}</p>)}
      <Versions d={d} onDownload={download} />
      {d.can.manage && <AccessLog assetId={a.id} />}
      <PromptDialog spec={prompt} onClose={() => setPrompt(null)} />
    </div>
  );
}

/** Xem trước ngay trong trang (ảnh, video, âm thanh, PDF, văn bản thuần); loại khác chỉ tải về. Mỗi lần mở = 1 dòng "Xem" trong nhật ký. */
function Preview({ assetId, version }: { assetId: string; version: number }) {
  const [file, setFile] = useState<IFileUrl | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setFile(null); setErr(null);
    documentApi.fileUrl(assetId, version).then((f) => alive && setFile(f)).catch((e) => alive && setErr(errorMessage(e)));
    return () => { alive = false; };
  }, [assetId, version]);
  if (err) return <p className="text-sm text-destructive">{err}</p>;
  if (!file) return <div className="flex h-40 items-center justify-center rounded-lg border"><Spinner /></div>;
  if (!file.inline) return <p className="rounded-lg border p-4 text-sm text-muted-foreground">Loại file này không xem trước được — bấm "Tải về" để mở.</p>;
  const box = 'w-full rounded-lg border bg-muted/30';
  if (file.kind === 'Image') return <img src={file.url} alt={file.fileName} className={`${box} max-h-[60vh] object-contain`} />;
  if (file.kind === 'Video') return <video src={file.url} controls preload="metadata" className={`${box} max-h-[60vh]`} />;
  if (file.kind === 'Audio') return <audio src={file.url} controls className="w-full" />;
  return <iframe src={file.url} title={file.fileName} className={`${box} h-[60vh]`} />;
}

function Custodian({ d }: { d: IAssetDetail }) {
  const employees = useEmployees();
  const [editing, setEditing] = useState(false);
  const save = useDocMutation((employeeId: string) => documentApi.custodian(d.asset.id, employeeId));
  if (!editing || !d.can.manage) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        {d.asset.custodianName ?? '—'}
        {d.can.manage && d.asset.status !== 'Destroyed' && <button type="button" className="text-xs text-primary hover:underline" onClick={() => setEditing(true)}>Đổi</button>}
      </span>
    );
  }
  const options = (employees.data ?? []).filter((e) => e.status !== 'Resigned').map((e) => ({ value: e.id, label: `${e.fullName} (${e.code})` }));
  return (
    <SelectField id="as-custodian" label="" value={d.custodianEmployeeId} options={options}
      onChange={(v) => v && save.mutate(v, { onSuccess: () => { toast.success('Đã đổi người phụ trách'); setEditing(false); }, onError: (e) => toast.error(errorMessage(e)) })} />
  );
}

function EditForm({ d }: { d: IAssetDetail }) {
  const a = d.asset;
  const types = useDocTypes();
  const folders = useFolders({ kind: a.spaceKind, id: a.spaceId });
  const [form, setForm] = useState<IUpdateAsset>({ title: a.title, description: d.description, tags: a.tags, docTypeId: a.docTypeId, folderId: a.folderId });
  const [tagText, setTagText] = useState(a.tags.join(', '));
  const save = useDocMutation((body: IUpdateAsset) => documentApi.update(a.id, body));
  const errors = fieldErrors(save.error);
  const typeOptions = (types.data ?? []).filter((t) => t.isActive || t.id === a.docTypeId).map((t) => ({ value: t.id, label: `${t.name} (${t.code})` }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate({ ...form, tags: tagText.split(',').map((t) => t.trim()).filter(Boolean) }, {
      onSuccess: () => toast.success('Đã lưu thông tin'), onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
    });
  };
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border p-3">
      <FormField id="as-title" label="Tiêu đề *" maxLength={300} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} error={errors.title} />
      <div className="grid gap-2">
        <Label htmlFor="as-desc">Mô tả</Label>
        <Textarea id="as-desc" rows={3} maxLength={4000} value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField id="as-type" label={a.status === 'Draft' ? 'Loại tài liệu' : 'Loại tài liệu (chỉ đổi khi còn nháp)'} value={form.docTypeId}
          options={typeOptions} onChange={(v) => v && a.status === 'Draft' && setForm({ ...form, docTypeId: v })} error={errors.docTypeId} />
        <SelectField id="as-folder" label="Thư mục" value={form.folderId} allowEmpty emptyLabel="— Gốc kho —"
          options={folderOptions(folders.data ?? [])} onChange={(v) => setForm({ ...form, folderId: v })} error={errors.folderId} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="as-tags">Thẻ (cách nhau bằng dấu phẩy)</Label>
        <Input id="as-tags" value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="Vd: khách hàng A, logo, 2026" />
      </div>
      <div className="flex justify-end"><Button type="submit" size="sm" disabled={save.isPending || !form.title.trim()}>{save.isPending ? 'Đang lưu…' : 'Lưu thông tin'}</Button></div>
    </form>
  );
}

function Versions({ d, onDownload }: { d: IAssetDetail; onDownload: (v: number) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const upload = useDocMutation((file: File) => uploadNewVersion(d.asset.id, file, note.trim() || null, setProgress));
  const pick = (file: File | undefined) => {
    if (!file) return;
    setProgress(0);
    upload.mutate(file, {
      onSuccess: () => { toast.success('Đã tải phiên bản mới'); setNote(''); },
      onError: (e) => toast.error(errorMessage(e)),
      onSettled: () => { setProgress(null); if (input.current) input.current.value = ''; },
    });
  };
  return (
    <section className="grid gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><History className="size-4" /> Phiên bản</h3>
      {d.can.changeFile && (
        <div className="flex flex-wrap items-center gap-2">
          <Input className="h-8 min-w-0 flex-1" placeholder="Ghi chú thay đổi (tuỳ chọn)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          <input ref={input} type="file" hidden onChange={(e) => pick(e.target.files?.[0])} />
          <Button size="sm" variant="outline" disabled={progress !== null} onClick={() => input.current?.click()}>
            <Upload /> {progress !== null ? `Đang tải ${Math.round(progress * 100)}%` : 'Tải phiên bản mới'}
          </Button>
        </div>
      )}
      <ul className="divide-y rounded-lg border text-sm">
        {d.versions.map((v) => (
          <li key={v.number} className="flex items-center gap-3 px-3 py-2">
            <span className="w-8 shrink-0 font-medium">v{v.number}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate">{v.fileName}</div>
              <div className="text-xs text-muted-foreground">{formatSize(v.size)} · {v.uploadedByName} · {formatDateTime(v.uploadedAt)}{v.note ? ` · ${v.note}` : ''}</div>
            </div>
            {v.available ? <Button size="icon-sm" variant="ghost" aria-label={`Tải phiên bản ${v.number}`} onClick={() => onDownload(v.number)}><Download /></Button>
              : <span className="text-xs text-muted-foreground">đã huỷ</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AccessLog({ assetId }: { assetId: string }) {
  const [open, setOpen] = useState(false);
  const pg = usePageState('doc-access-log');
  const log = useAccessLog(assetId, pg.query, open);
  const rows = useMemo(() => log.data?.items ?? [], [log.data]);
  if (!open) return <button type="button" className="justify-self-start text-sm text-primary hover:underline" onClick={() => setOpen(true)}>Xem nhật ký xem / tải</button>;
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-semibold">Nhật ký xem / tải</h3>
      <div className="rounded-lg border">
        <Table>
          <TableHeader><TableRow><TableHead>Thời điểm</TableHead><TableHead>Người</TableHead><TableHead>Thao tác</TableHead><TableHead>Bản</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={`${r.at}-${i}`}>
                <TableCell>{formatDateTime(r.at)}</TableCell><TableCell>{r.userName}</TableCell>
                <TableCell>{r.action === 'View' ? 'Xem' : 'Tải về'}</TableCell><TableCell>v{r.versionNumber}</TableCell>
              </TableRow>
            ))}
            {!log.isLoading && rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Chưa có lượt xem.</TableCell></TableRow>}
          </TableBody>
        </Table>
        <TablePagination state={pg} total={log.data?.total} unit="lượt" />
      </div>
    </section>
  );
}
