import { useState } from 'react';
import { Pencil, RotateCcw, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/common/alert-dialog';
import { Button } from '@/components/common/button';
import { Label } from '@/components/common/label';
import { SearchSelectField } from '@/components/common/SearchSelectField';
import { SelectField } from '@/components/common/SelectField';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/common/sheet';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Textarea } from '@/components/common/textarea';
import { Spinner } from '@/components/feedback/Spinner';
import { useEmployees } from '@/features/employees';
import { formatDate, formatDateTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { formatMoney } from '@/utils/money';
import { assetApi } from '../../api/asset.api';
import { useAssetMutation, useDevice } from '../../hooks/useAssets';
import type { DeviceStatus, IDeviceDetail } from '../../types/asset.types';
import { DEVICE_STATUS, employeeOptions } from '../../utils/labels';
import { DeviceFormDialog } from '../device-form-dialog';

/** Chi tiết thiết bị (sheet): thông tin, cấp phát / thu hồi, đổi trạng thái, sửa, xoá, lịch sử giao nhận. */
export function DeviceSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading, error } = useDevice(id);
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl" data-testid="device-sheet">
        {isLoading && <div className="p-6"><Spinner /></div>}
        {error && <div className="p-6 text-sm text-destructive">{errorMessage(error)}</div>}
        {data && <Detail key={data.device.id} d={data} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}

const STATUS_TARGETS: DeviceStatus[] = ['Repair', 'Retired', 'Lost', 'InStock'];

function Detail({ d, onClose }: { d: IDeviceDetail; onClose: () => void }) {
  const v = d.device;
  const employees = useEmployees();
  const [editing, setEditing] = useState(false);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [reason, setReason] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const run = useAssetMutation((f: () => Promise<unknown>) => f());
  const act = (f: () => Promise<unknown>, ok: string, after?: () => void) =>
    run.mutate(f, { onSuccess: () => { toast.success(ok); after?.(); }, onError: (e) => toast.error(errorMessage(e)) });
  const st = DEVICE_STATUS[v.status];
  const closed = v.status === 'Retired' || v.status === 'Lost';
  const needReason = status === 'Retired' || status === 'Lost';

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex flex-wrap items-center gap-2">{v.name}<StatusBadge tone={st.tone}>{st.label}</StatusBadge></SheetTitle>
        <SheetDescription>{v.code} · {v.categoryName}{v.statusReason ? ` · Lý do: ${v.statusReason}` : ''}</SheetDescription>
      </SheetHeader>
      <div className="grid gap-5 px-4 pb-6">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Info label="Hãng / model" value={[v.brand, v.model].filter(Boolean).join(' ') || '—'} />
          <Info label="Số serial" value={v.serialNumber ?? '—'} />
          <Info label="Ngày mua" value={v.purchaseDate ? formatDate(v.purchaseDate) : '—'} />
          <Info label="Giá mua" value={formatMoney(v.purchasePrice)} />
          <Info label="Bảo hành đến" value={v.warrantyUntil ? formatDate(v.warrantyUntil) : '—'} />
          <Info label="Người đang giữ" value={v.holderName ? `${v.holderName} (${v.holderCode})` : '—'} />
          {v.note && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Ghi chú</dt><dd className="whitespace-pre-wrap">{v.note}</dd></div>}
        </dl>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil /> Sửa</Button>
          <Button size="sm" variant="outline" onClick={() => setConfirmDelete(true)}><Trash2 /> Xoá</Button>
        </div>

        {v.status === 'InStock' && (
          <section className="grid gap-3 rounded-lg border p-3">
            <h4 className="text-sm font-semibold">Cấp phát</h4>
            <SearchSelectField id="dv-assign-emp" label="Nhân viên nhận *" value={employeeId} onChange={setEmployeeId} options={employeeOptions(employees.data)} />
            <div className="grid gap-2"><Label htmlFor="dv-assign-note">Ghi chú</Label><Textarea id="dv-assign-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <Button className="justify-self-start" disabled={!employeeId || run.isPending}
              onClick={() => act(() => assetApi.assign(v.id, employeeId!, note.trim() || null), 'Đã cấp thiết bị', () => { setEmployeeId(null); setNote(''); })}>
              <UserPlus /> Cấp phát
            </Button>
          </section>
        )}
        {v.status === 'InUse' && (
          <section className="grid gap-3 rounded-lg border p-3">
            <h4 className="text-sm font-semibold">Thu hồi</h4>
            <div className="grid gap-2"><Label htmlFor="dv-return-note">Tình trạng khi trả</Label><Textarea id="dv-return-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <Button className="justify-self-start" variant="outline" disabled={run.isPending}
              onClick={() => act(() => assetApi.returnDevice(v.id, note.trim() || null), 'Đã thu hồi thiết bị', () => setNote(''))}>
              <RotateCcw /> Thu hồi về kho
            </Button>
          </section>
        )}
        {!closed && (
          <section className="grid gap-3 rounded-lg border p-3">
            <h4 className="text-sm font-semibold">Đổi trạng thái</h4>
            <SelectField id="dv-status" label="Trạng thái mới" value={status} onChange={(x) => setStatus(x as DeviceStatus | null)}
              options={STATUS_TARGETS.filter((s) => s !== v.status).map((s) => ({ value: s, label: DEVICE_STATUS[s].label }))} />
            {needReason && <div className="grid gap-2"><Label htmlFor="dv-reason">Lý do *</Label><Textarea id="dv-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></div>}
            {v.status === 'InUse' && <p className="text-xs text-muted-foreground">Thiết bị đang có người dùng: chỉ đánh dấu "Mất" được; muốn bảo trì / thanh lý hãy thu hồi trước.</p>}
            <Button className="justify-self-start" variant="outline" disabled={!status || (needReason && !reason.trim()) || run.isPending}
              onClick={() => act(() => assetApi.setStatus(v.id, status!, reason.trim() || null), 'Đã đổi trạng thái', () => { setStatus(null); setReason(''); })}>
              Áp dụng
            </Button>
          </section>
        )}

        <section className="grid gap-2">
          <h4 className="text-sm font-semibold">Lịch sử giao nhận</h4>
          <div className="rounded-lg border">
            <Table>
              <TableHeader><TableRow><TableHead>Người nhận</TableHead><TableHead>Cấp</TableHead><TableHead>Trả</TableHead></TableRow></TableHeader>
              <TableBody>
                {d.history.length === 0 && <TableRow><TableCell colSpan={3} className="py-4 text-center text-muted-foreground">Chưa từng cấp phát.</TableCell></TableRow>}
                {d.history.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell>{h.employeeName} <span className="text-xs text-muted-foreground">({h.employeeCode})</span></TableCell>
                    <TableCell className="text-xs">{formatDateTime(h.assignedAt)}{h.assignedByName ? <div className="text-muted-foreground">bởi {h.assignedByName}</div> : null}{h.assignNote ? <div>{h.assignNote}</div> : null}</TableCell>
                    <TableCell className="text-xs">{h.returnedAt ? <>{formatDateTime(h.returnedAt)}{h.returnedByName ? <div className="text-muted-foreground">bởi {h.returnedByName}</div> : null}{h.returnNote ? <div>{h.returnNote}</div> : null}</> : <span className="text-success">Đang giữ</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>

      <DeviceFormDialog open={editing} onOpenChange={setEditing} device={v} />
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xoá thiết bị {v.code}?</AlertDialogTitle>
            <AlertDialogDescription>Chỉ xoá được thiết bị chưa từng cấp phát. Đã dùng rồi thì hãy chuyển sang "Thanh lý".</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction onClick={() => act(() => assetApi.deleteDevice(v.id), 'Đã xoá thiết bị', onClose)}>Xoá</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const Info = ({ label, value }: { label: string; value: string }) => (
  <div><dt className="text-xs text-muted-foreground">{label}</dt><dd>{value}</dd></div>
);
