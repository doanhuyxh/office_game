import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Label } from '@/components/common/label';
import { Textarea } from '@/components/common/textarea';
import { Spinner } from '@/components/feedback/Spinner';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useDecideProfileRequest, useEmployeePrivate, useProfileRequests, useSaveEmployeePrivate } from '../hooks/useProfile';
import type { IContact, IProfileRequest, ISensitive } from '../types/profile.types';
import { RequestSummary } from './ProfilePage';

/** Số yêu cầu chờ duyệt (badge tab). */
export const usePendingProfileRequestCount = (enabled: boolean) => useProfileRequests(undefined, enabled).data?.length ?? 0;

function RejectDialog({ request, onClose }: { request: IProfileRequest | null; onClose: () => void }) {
  const decide = useDecideProfileRequest();
  const [reason, setReason] = useState('');
  useEffect(() => { if (request) { setReason(''); decide.reset(); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [request?.id]);
  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Từ chối yêu cầu của {request?.employeeName}</DialogTitle><DialogDescription>Lý do được gửi cho nhân viên.</DialogDescription></DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="rj-reason">Lý do *</Label>
          <Textarea id="rj-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Vd: Số CCCD không khớp bản chụp, vui lòng kiểm tra lại" />
          {fieldErrors(decide.error).reason && <p className="text-xs text-destructive">{fieldErrors(decide.error).reason}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Huỷ</Button>
          <Button variant="destructive" disabled={!reason.trim() || decide.isPending} onClick={() => request && decide.mutate({ id: request.id, approve: false, reason }, {
            onSuccess: () => { toast.success('Đã từ chối'); onClose(); }, onError: (e) => toast.error(errorMessage(e)),
          })}>Từ chối</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** HR: yêu cầu cập nhật thông tin cá nhân chờ duyệt (ngày sinh, CCCD, tài khoản ngân hàng). */
export function ProfileRequestsPanel() {
  const { data = [], isLoading } = useProfileRequests();
  const decide = useDecideProfileRequest();
  const [rejecting, setRejecting] = useState<IProfileRequest | null>(null);
  if (isLoading) return <Spinner />;
  return (
    <div className="grid gap-3">
      {data.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Không có yêu cầu nào chờ duyệt.</p>}
      {data.map((r) => (
        <div key={r.id} className="grid gap-2 rounded-xl border bg-card p-4" data-testid="profile-request">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium"><span className="font-mono text-xs text-muted-foreground">{r.employeeCode}</span> {r.employeeName}</span>
            <div className="ms-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setRejecting(r)}><X className="size-4" /> Từ chối</Button>
              <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, approve: true }, {
                onSuccess: () => toast.success(`Đã duyệt — cập nhật hồ sơ ${r.employeeName}`), onError: (e) => toast.error(errorMessage(e)),
              })}><Check className="size-4" /> Duyệt</Button>
            </div>
          </div>
          <RequestSummary r={r} />
          {r.note && <p className="text-sm text-muted-foreground">Ghi chú: {r.note}</p>}
        </div>
      ))}
      <RejectDialog request={rejecting} onClose={() => setRejecting(null)} />
    </div>
  );
}

const C_FIELDS: { key: keyof IContact; label: string; wide?: boolean }[] = [
  { key: 'phone', label: 'Số điện thoại' }, { key: 'emergencyContactPhone', label: 'SĐT liên hệ khẩn cấp' },
  { key: 'currentAddress', label: 'Địa chỉ hiện tại', wide: true }, { key: 'permanentAddress', label: 'Địa chỉ thường trú', wide: true },
  { key: 'emergencyContactName', label: 'Người liên hệ khẩn cấp' }, { key: 'emergencyContactRelation', label: 'Quan hệ' },
];
const S_FIELDS: { key: keyof ISensitive; label: string; type?: string; wide?: boolean }[] = [
  { key: 'dateOfBirth', label: 'Ngày sinh', type: 'date' }, { key: 'idNumber', label: 'Số CCCD' },
  { key: 'idIssuedOn', label: 'Ngày cấp CCCD', type: 'date' }, { key: 'idIssuedPlace', label: 'Nơi cấp' },
  { key: 'bankName', label: 'Ngân hàng' }, { key: 'bankAccount', label: 'Số tài khoản' }, { key: 'bankAccountHolder', label: 'Chủ tài khoản', wide: true },
];

/** HR xem / sửa thẳng thông tin cá nhân của một nhân viên (không qua duyệt; có lịch sử sửa). */
export function EmployeePrivateDialog({ employeeId, name, onClose }: { employeeId: string | null; name?: string; onClose: () => void }) {
  const { data, isLoading } = useEmployeePrivate(employeeId);
  const save = useSaveEmployeePrivate();
  const [c, setC] = useState<IContact | null>(null);
  const [s, setS] = useState<ISensitive | null>(null);
  useEffect(() => { if (data) { setC(data.contact); setS(data.sensitive); } }, [data]);
  useEffect(() => { if (!employeeId) { setC(null); setS(null); save.reset(); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [employeeId]);
  const errors = fieldErrors(save.error);
  return (
    <Dialog open={!!employeeId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Thông tin cá nhân · {name}</DialogTitle>
          <DialogDescription>HR sửa trực tiếp, có hiệu lực ngay và ghi vào lịch sử thay đổi. CCCD / số tài khoản lưu mã hoá.</DialogDescription>
        </DialogHeader>
        {isLoading || !c || !s ? <Spinner /> : (
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate({ id: employeeId!, contact: c, sensitive: s }, {
            onSuccess: () => { toast.success('Đã lưu thông tin cá nhân'); onClose(); },
            onError: (x) => !Object.keys(fieldErrors(x)).length && toast.error(errorMessage(x)),
          }); }}>
            <div className="text-xs font-semibold uppercase text-muted-foreground sm:col-span-2">Liên hệ</div>
            {C_FIELDS.map((f) => <div key={f.key} className={f.wide ? 'sm:col-span-2' : undefined}>
              <FormField id={`hp-${f.key}`} label={f.label} value={c[f.key] ?? ''} error={errors[f.key]} onChange={(e) => setC({ ...c, [f.key]: e.target.value || null })} /></div>)}
            <div className="pt-2 text-xs font-semibold uppercase text-muted-foreground sm:col-span-2">Giấy tờ & ngân hàng</div>
            {S_FIELDS.map((f) => <div key={f.key} className={f.wide ? 'sm:col-span-2' : undefined}>
              <FormField id={`hp-${f.key}`} label={f.label} type={f.type} value={s[f.key] ?? ''} error={errors[f.key]} onChange={(e) => setS({ ...s, [f.key]: e.target.value || null })} /></div>)}
            {data?.pending && <p className="text-sm text-warning sm:col-span-2">Nhân viên đang có yêu cầu cập nhật chờ duyệt — xem tab "Yêu cầu cập nhật".</p>}
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
              <Button type="submit" disabled={save.isPending}>Lưu</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
