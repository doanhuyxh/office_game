import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Camera, Clock, Eye, EyeOff, Lock, Send, Shirt, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Label } from '@/components/common/label';
import { PersonAvatar } from '@/components/common/PersonAvatar';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Textarea } from '@/components/common/textarea';
import { Spinner } from '@/components/feedback/Spinner';
import { PageHeader } from '@/components/layout/PageHeader';
import { TwoFactorCard, useMe } from '@/features/auth';
import { formatDate, formatDateTime } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useCancelProfileRequest, useDeleteAvatar, useMyProfile, useSaveContact, useSubmitProfileRequest, useUploadAvatar } from '../../hooks/useProfile';
import type { IContact, IMyProfile, IProfileRequest, ISensitive, ISensitiveChange } from '../../types/profile.types';

const mask = (s: string | null) => (!s ? '—' : s.length <= 4 ? '••••' : `${'•'.repeat(s.length - 4)}${s.slice(-4)}`);
const fmtDate = (d: string | null) => (d ? formatDate(d) : '—');

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid gap-0.5"><span className="text-xs text-muted-foreground">{label}</span><span className="text-sm">{children || '—'}</span></div>;
}

// ---------------- Ảnh đại diện + thông tin công việc (chỉ xem) ----------------

function Overview({ p }: { p: IMyProfile }) {
  const upload = useUploadAvatar();
  const remove = useDeleteAvatar();
  const input = useRef<HTMLInputElement>(null);
  return (
    <Card>
      <CardContent className="flex flex-col gap-6 pt-6 sm:flex-row sm:items-start">
        <div className="flex flex-col items-center gap-2">
          <PersonAvatar name={p.fullName} url={p.avatarUrl} className="size-24" fallbackClassName="text-2xl" />
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" data-testid="avatar-input"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload.mutate(f, { onSuccess: () => toast.success('Đã cập nhật ảnh đại diện'), onError: (x) => toast.error(errorMessage(x)) }); }} />
          <div className="flex gap-1">
            <Button size="sm" variant="outline" disabled={upload.isPending} onClick={() => input.current?.click()}><Camera className="size-4" /> {p.avatarUrl ? 'Đổi ảnh' : 'Tải ảnh'}</Button>
            {p.avatarUrl && <Button size="icon" variant="ghost" className="size-8" aria-label="Xoá ảnh" disabled={remove.isPending}
              onClick={() => remove.mutate(undefined, { onSuccess: () => toast.success('Đã xoá ảnh'), onError: (x) => toast.error(errorMessage(x)) })}><Trash2 className="size-4" /></Button>}
          </div>
          <span className="text-[11px] text-muted-foreground">JPG / PNG / WebP, tối đa 2 MB</span>
        </div>
        <div className="grid flex-1 gap-4">
          <div>
            <div className="text-xl font-semibold">{p.fullName}</div>
            <div className="text-sm text-muted-foreground">{p.code}{p.jobTitle ? ` · ${p.jobTitle}` : ''}{p.positionName ? ` · ${p.positionName}` : ''}</div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Info label="Phòng ban">{p.departmentName}</Info>
            <Info label="Quản lý trực tiếp">{p.managerName}</Info>
            <Info label="Ngày vào làm">{formatDate(p.joinedAt)}</Info>
            <Info label="Email (HR quản lý)"><span className="inline-flex items-center gap-1">{p.email ?? '—'} <Lock className="size-3 text-muted-foreground" /></span></Info>
          </div>
          <p className="text-xs text-muted-foreground">Phòng ban, chức vụ, email do HR cập nhật. Cần sửa, liên hệ bộ phận Nhân sự.</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------- Liên hệ (tự sửa) ----------------

const CONTACT_FIELDS: { key: keyof IContact; label: string; placeholder?: string; wide?: boolean }[] = [
  { key: 'phone', label: 'Số điện thoại', placeholder: '0901 234 567' },
  { key: 'currentAddress', label: 'Địa chỉ hiện tại', wide: true },
  { key: 'permanentAddress', label: 'Địa chỉ thường trú', wide: true },
  { key: 'emergencyContactName', label: 'Người liên hệ khẩn cấp' },
  { key: 'emergencyContactRelation', label: 'Quan hệ', placeholder: 'Vd: Bố, Mẹ, Vợ, Chồng' },
  { key: 'emergencyContactPhone', label: 'SĐT người liên hệ' },
];

export function ContactForm({ value, onSave, saving, error }: { value: IContact; onSave: (c: IContact) => void; saving: boolean; error: unknown }) {
  const [form, setForm] = useState<IContact>(value);
  useEffect(() => setForm(value), [value]);
  const errors = fieldErrors(error);
  const dirty = CONTACT_FIELDS.some((f) => (form[f.key] ?? '') !== (value[f.key] ?? ''));
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      {CONTACT_FIELDS.map((f) => (
        <div key={f.key} className={f.wide ? 'sm:col-span-2' : undefined}>
          <FormField id={`c-${f.key}`} label={f.label} value={form[f.key] ?? ''} placeholder={f.placeholder} error={errors[f.key]}
            onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
        </div>
      ))}
      <div className="sm:col-span-2"><Button type="submit" disabled={!dirty || saving}>Lưu thông tin liên hệ</Button></div>
    </form>
  );
}

// ---------------- Cần HR duyệt ----------------

/** Ngày (yyyy-MM-dd) → dd/MM/yyyy; còn lại giữ nguyên. */
const show = (field: string, v: string | null) => (v && (field === 'dateOfBirth' || field === 'idIssuedOn') ? formatDate(v) : v);

export function RequestSummary({ r, onCancel, cancelling }: { r: IProfileRequest; onCancel?: () => void; cancelling?: boolean }) {
  const tone = r.status === 'Pending' ? 'warning' : r.status === 'Approved' ? 'success' : 'danger';
  const label = { Pending: 'Chờ HR duyệt', Approved: 'Đã duyệt', Rejected: 'Bị từ chối', Cancelled: 'Đã huỷ' }[r.status];
  return (
    <div className="grid gap-2 rounded-md border p-3 text-sm" data-testid={`request-${r.status.toLowerCase()}`}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={tone}>{label}</StatusBadge>
        <span className="text-xs text-muted-foreground">Gửi {formatDateTime(r.createdAt)}{r.decidedAt && r.status !== 'Pending' ? ` · ${r.decidedByName ?? ''} xử lý ${formatDateTime(r.decidedAt)}` : ''}</span>
        {onCancel && <Button size="sm" variant="ghost" className="ms-auto h-7 text-destructive" disabled={cancelling} onClick={onCancel}><X className="size-3.5" /> Huỷ yêu cầu</Button>}
      </div>
      <ul className="ml-4 list-disc text-muted-foreground">
        {r.changes.map((c) => (
          <li key={c.field}><span className="text-foreground">{c.label}</span>: {r.status === 'Pending' && <>{show(c.field, c.old) ?? '(trống)'} → </>}<b className="text-foreground">{show(c.field, c.new) ?? '(xoá)'}</b></li>
        ))}
      </ul>
      {r.rejectReason && <div className="text-destructive">Lý do từ chối: {r.rejectReason}</div>}
    </div>
  );
}

function RequestDialog({ open, onClose, current }: { open: boolean; onClose: () => void; current: ISensitive }) {
  const submit = useSubmitProfileRequest();
  const [f, setF] = useState<ISensitive>(current);
  const [note, setNote] = useState('');
  useEffect(() => { if (open) { setF(current); setNote(''); submit.reset(); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  const errors = fieldErrors(submit.error);
  // Chỉ gửi trường đã đổi: '' = xoá (trừ ngày)
  const change: ISensitiveChange = {};
  (['idNumber', 'idIssuedPlace', 'bankName', 'bankAccount', 'bankAccountHolder'] as const).forEach((k) => { if ((f[k] ?? '') !== (current[k] ?? '')) change[k] = f[k] ?? ''; });
  if ((f.dateOfBirth ?? '') !== (current.dateOfBirth ?? '')) { if (f.dateOfBirth) change.dateOfBirth = f.dateOfBirth; else change.clearDateOfBirth = true; }
  if (f.idIssuedOn && f.idIssuedOn !== current.idIssuedOn) change.idIssuedOn = f.idIssuedOn;
  const count = Object.keys(change).length;
  const set = (k: keyof ISensitive) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value || null });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Đề nghị cập nhật thông tin</DialogTitle>
          <DialogDescription>Ngày sinh, CCCD và tài khoản ngân hàng dùng cho hợp đồng và chuyển lương nên cần HR duyệt. Sửa trường cần đổi rồi gửi.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit.mutate({ change, note: note.trim() || null }, {
          onSuccess: () => { toast.success('Đã gửi yêu cầu — chờ HR duyệt'); onClose(); },
          onError: (x) => !Object.keys(fieldErrors(x)).length && toast.error(errorMessage(x)),
        }); }}>
          <FormField id="r-dob" label="Ngày sinh" type="date" value={f.dateOfBirth ?? ''} onChange={set('dateOfBirth')} error={errors.dateOfBirth} />
          <div className="hidden sm:block" />
          <FormField id="r-id" label="Số CCCD (12 số)" inputMode="numeric" value={f.idNumber ?? ''} onChange={set('idNumber')} error={errors.idNumber} />
          <FormField id="r-iss" label="Ngày cấp" type="date" value={f.idIssuedOn ?? ''} onChange={set('idIssuedOn')} error={errors.idIssuedOn} />
          <div className="sm:col-span-2"><FormField id="r-place" label="Nơi cấp" value={f.idIssuedPlace ?? ''} onChange={set('idIssuedPlace')} placeholder="Cục Cảnh sát QLHC về TTXH" error={errors.idIssuedPlace} /></div>
          <FormField id="r-bank" label="Ngân hàng" value={f.bankName ?? ''} onChange={set('bankName')} placeholder="Vd: Vietcombank" error={errors.bankName} />
          <FormField id="r-acc" label="Số tài khoản" inputMode="numeric" value={f.bankAccount ?? ''} onChange={set('bankAccount')} error={errors.bankAccount} />
          <div className="sm:col-span-2"><FormField id="r-holder" label="Chủ tài khoản" value={f.bankAccountHolder ?? ''} onChange={set('bankAccountHolder')} placeholder="NGUYEN VAN AN" error={errors.bankAccountHolder} /></div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="r-note">Ghi chú cho HR (tuỳ chọn)</Label>
            <Textarea id="r-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Vd: Đổi CCCD mới, đổi ngân hàng nhận lương" />
          </div>
          {errors.change && <p className="text-sm text-destructive sm:col-span-2">{errors.change}</p>}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
            <Button type="submit" disabled={count === 0 || submit.isPending}><Send className="size-4" /> Gửi yêu cầu{count ? ` (${count} mục)` : ''}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SensitiveCard({ p }: { p: IMyProfile }) {
  const cancel = useCancelProfileRequest();
  const [open, setOpen] = useState(false);
  const [show, setShow] = useState(false);
  const s = p.sensitive;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">Thông tin cần HR duyệt</CardTitle>
          <CardDescription>Dùng cho hợp đồng lao động và chuyển lương. Không hiển thị với đồng nghiệp hay trợ lý AI.</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShow(!show)}>{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />} {show ? 'Ẩn số' : 'Hiện số'}</Button>
          <Button size="sm" disabled={!!p.pending} onClick={() => setOpen(true)}>Đề nghị cập nhật</Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Info label="Ngày sinh">{fmtDate(s.dateOfBirth)}</Info>
          <Info label="Số CCCD">{show ? s.idNumber ?? '—' : mask(s.idNumber)}</Info>
          <Info label="Ngày cấp">{fmtDate(s.idIssuedOn)}</Info>
          <Info label="Nơi cấp">{s.idIssuedPlace}</Info>
          <Info label="Ngân hàng">{s.bankName}</Info>
          <Info label="Số tài khoản">{show ? s.bankAccount ?? '—' : mask(s.bankAccount)}</Info>
          <Info label="Chủ tài khoản">{s.bankAccountHolder}</Info>
        </div>
        {p.pending && (
          <div className="grid gap-1">
            <div className="flex items-center gap-1 text-sm font-medium"><Clock className="size-4 text-warning" /> Yêu cầu đang chờ</div>
            <RequestSummary r={p.pending} cancelling={cancel.isPending}
              onCancel={() => confirm('Huỷ yêu cầu cập nhật này?') && cancel.mutate(p.pending!.id, { onSuccess: () => toast.success('Đã huỷ yêu cầu'), onError: (x) => toast.error(errorMessage(x)) })} />
          </div>
        )}
        {!p.pending && p.lastDecided && <RequestSummary r={p.lastDecided} />}
      </CardContent>
      <RequestDialog open={open} onClose={() => setOpen(false)} current={s} />
    </Card>
  );
}

// Editor nhân vật kéo theo Three.js + model → chỉ tải khi mở (dùng chung chunk của văn phòng 3D)
const AvatarEditorDialog = lazy(() => import('@/features/office').then((m) => ({ default: m.AvatarEditorDialog })));

/** Nhân vật trong văn phòng 3D (mọi tài khoản, kể cả chưa có hồ sơ nhân viên). */
function OfficeCharacterCard() {
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const custom = me?.avatar != null;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Nhân vật văn phòng 3D</CardTitle>
          <CardDescription>
            {custom ? 'Bạn đã tạo nhân vật riêng.' : 'Bạn đang dùng nhân vật mặc định.'} Chọn dáng người, tóc, màu da, mắt, trang phục — đồng nghiệp thấy khi vào văn phòng.
          </CardDescription>
        </div>
        <Button variant="outline" onClick={() => setOpen(true)} data-testid="profile-avatar-edit"><Shirt /> {custom ? 'Sửa nhân vật' : 'Tạo nhân vật'}</Button>
      </CardHeader>
      {open && (
        <Suspense fallback={null}>
          <AvatarEditorDialog open={open} onOpenChange={setOpen} />
        </Suspense>
      )}
    </Card>
  );
}

/** Hồ sơ cá nhân của người đang đăng nhập (chủ dự án chốt 2026-11-06). */
export function ProfilePage() {
  const { data: p, isLoading } = useMyProfile();
  const save = useSaveContact();
  if (isLoading) return <Spinner />;
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Hồ sơ cá nhân" />
      {!p ? (
        <Card><CardHeader><CardTitle className="text-base">Tài khoản chưa gắn hồ sơ nhân viên</CardTitle>
          <CardDescription>Tài khoản quản trị hệ thống không có hồ sơ cá nhân.</CardDescription></CardHeader></Card>
      ) : (
        <>
          <Overview p={p} />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Liên hệ</CardTitle>
              <CardDescription>Bạn tự cập nhật, có hiệu lực ngay. Số điện thoại hiện trong danh bạ công ty; địa chỉ và người liên hệ khẩn cấp chỉ HR xem.</CardDescription>
            </CardHeader>
            <CardContent>
              <ContactForm value={p.contact} saving={save.isPending} error={save.error}
                onSave={(c) => save.mutate(c, { onSuccess: () => toast.success('Đã lưu thông tin liên hệ'), onError: (x) => !Object.keys(fieldErrors(x)).length && toast.error(errorMessage(x)) })} />
            </CardContent>
          </Card>
          <SensitiveCard p={p} />
        </>
      )}
      <TwoFactorCard />
      <OfficeCharacterCard />
    </div>
  );
}

