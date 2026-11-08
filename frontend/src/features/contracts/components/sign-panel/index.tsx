import { confirmDialog } from '@/components/common/confirm-dialog';
import { useEffect, useRef, useState } from 'react';
import { Eraser, FileSignature, Mail, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Label } from '@/components/common/label';
import { StatusBadge, type StatusTone } from '@/components/common/StatusBadge';
import { formatDateTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { contractApi } from '../../api/contract.api';
import { useCancelSignRequest, useSendOtp, useSignContract, useSignRequests } from '../../hooks/useContracts';
import type { ISignRequest, SignStatus } from '../../types/contract.types';

const SIGN_STATUS: Record<SignStatus, { label: string; tone: StatusTone }> = {
  Pending: { label: 'Chờ ký', tone: 'warning' },
  Signed: { label: 'Đã ký điện tử', tone: 'success' },
  Cancelled: { label: 'Đã huỷ', tone: 'muted' },
  Expired: { label: 'Hết hạn', tone: 'muted' },
};

async function openDocument(rid: string, signed: boolean) {
  try {
    const { url } = await contractApi.signDocumentUrl(rid, signed);
    window.open(url, '_blank', 'noopener');
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

/** Ô vẽ chữ ký (chuột / cảm ứng / bút). Trả data URL PNG nền trong suốt, null khi chưa vẽ. */
function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const empty = useRef(true);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1e3a8a'; // mực xanh — PNG in lên PDF nền trắng, không theo theme
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const down = (e: React.PointerEvent) => {
    canvas.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = canvas.current!.getContext('2d')!;
    const [x, y] = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = canvas.current!.getContext('2d')!;
    const [x, y] = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    empty.current = false;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (!empty.current) onChange(canvas.current!.toDataURL('image/png'));
  };
  const clear = () => {
    const c = canvas.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    empty.current = true;
    onChange(null);
  };

  return (
    <div className="grid gap-1">
      <div className="relative rounded-md border border-dashed bg-white">
        <canvas ref={canvas} className="h-40 w-full touch-none" data-testid="signature-pad"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} />
        <Button type="button" size="sm" variant="ghost" className="absolute top-1 right-1 h-7 text-xs text-slate-600" onClick={clear}><Eraser className="size-3.5" /> Xoá</Button>
      </div>
      <p className="text-xs text-muted-foreground">Ký bằng chuột, ngón tay hoặc bút trong khung trên.</p>
    </div>
  );
}

/** Nhân viên ký: xem bản gốc → nhận OTP qua email → nhập OTP + vẽ chữ ký + đồng ý → ký. */
export function SignDialog({ request, onClose }: { request: ISignRequest | null; onClose: () => void }) {
  const sendOtp = useSendOtp();
  const sign = useSignContract();
  const [otp, setOtp] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [viewed, setViewed] = useState(false);
  const sent = sendOtp.data;

  useEffect(() => {
    if (!request) { setOtp(''); setSignature(null); setAgree(false); setViewed(false); sendOtp.reset(); sign.reset(); }
  }, [request]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!request || !signature) return;
    sign.mutate({ rid: request.id, otp: otp.trim(), signature, agree }, {
      onSuccess: () => { toast.success('Đã ký hợp đồng. HR đã được thông báo.'); onClose(); },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ký hợp đồng {request?.contractNumber}</DialogTitle>
          <DialogDescription>Chữ ký điện tử nội bộ, xác thực bằng mã OTP gửi tới email của bạn. Hạn ký: {request && formatDateTime(request.expiresAt)}.</DialogDescription>
        </DialogHeader>
        {request && (
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-2">
              <Label>1. Đọc kỹ hợp đồng</Label>
              <Button type="button" variant="outline" className="justify-start" onClick={() => { setViewed(true); openDocument(request.id, false); }}>
                <FileSignature className="size-4" /> Mở bản hợp đồng (PDF)
              </Button>
              <p className="break-all font-mono text-[11px] text-muted-foreground">SHA-256: {request.originalSha256}</p>
            </div>
            <div className="grid gap-2">
              <Label>2. Nhận mã xác nhận</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" disabled={sendOtp.isPending} onClick={() => sendOtp.mutate(request.id, { onError: (e) => toast.error(errorMessage(e)) })}>
                  <Mail className="size-4" /> {sent ? 'Gửi lại mã' : 'Gửi mã qua email'}
                </Button>
                {sent && <span className="text-sm text-muted-foreground">Đã gửi tới <b>{sent.sentTo}</b>, hết hạn lúc {formatDateTime(sent.expiresAt)}</span>}
              </div>
              <FormField id="sign-otp" label="Mã OTP (6 số)" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} placeholder="••••••" />
            </div>
            <div className="grid gap-2">
              <Label>3. Chữ ký</Label>
              <SignaturePad onChange={setSignature} />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox className="mt-0.5" checked={agree} onCheckedChange={(c) => setAgree(c === true)} />
              <span>Tôi đã đọc, đồng ý toàn bộ nội dung hợp đồng và đồng ý ký bằng phương thức điện tử. Chữ ký này có giá trị như chữ ký tay.</span>
            </label>
            {!viewed && <p className="text-xs text-warning">Hãy mở và đọc hợp đồng trước khi ký.</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Để sau</Button>
              <Button type="submit" disabled={sign.isPending || otp.length !== 6 || !signature || !agree} data-testid="sign-submit">
                <ShieldCheck className="size-4" /> {sign.isPending ? 'Đang ký…' : 'Ký hợp đồng'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Banner cho nhân viên: hợp đồng đang chờ mình ký. */
export function PendingSignBanner() {
  const { data = [] } = useSignRequests();
  const [open, setOpen] = useState<ISignRequest | null>(null);
  const pending = data.filter((r) => r.canSign);
  if (pending.length === 0) return null;
  return (
    <div className="grid gap-2" data-testid="pending-sign">
      {pending.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm">
          <FileSignature className="size-5 shrink-0 text-primary" />
          <span className="flex-1">HR mời bạn ký điện tử hợp đồng <b>{r.contractNumber}</b> — hạn {formatDateTime(r.expiresAt)}.</span>
          <Button size="sm" onClick={() => setOpen(r)}>Ký ngay</Button>
        </div>
      ))}
      <SignDialog request={open} onClose={() => setOpen(null)} />
    </div>
  );
}

/** Lịch sử yêu cầu ký của một hợp đồng (HR có thể huỷ yêu cầu đang chờ). */
export function SignRequestList({ contractId, isHr }: { contractId: string; isHr: boolean }) {
  const { data = [] } = useSignRequests();
  const cancel = useCancelSignRequest();
  const rows = data.filter((r) => r.contractId === contractId);
  if (rows.length === 0) return null;
  return (
    <div className="grid gap-2">
      <Label>Ký điện tử</Label>
      {rows.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <StatusBadge tone={SIGN_STATUS[r.status].tone}>{SIGN_STATUS[r.status].label}</StatusBadge>
          <span className="flex-1 text-xs text-muted-foreground">
            {r.signedAt ? `Ký lúc ${formatDateTime(r.signedAt)}` : `Gửi ${formatDateTime(r.createdAt)}${r.createdByName ? ` bởi ${r.createdByName}` : ''} · hạn ${formatDateTime(r.expiresAt)}`}
          </span>
          {r.status === 'Signed' && <Button size="sm" variant="link" className="h-auto p-0" onClick={() => openDocument(r.id, true)}>Bản đã ký</Button>}
          {isHr && r.status === 'Pending' && (
            <Button size="sm" variant="ghost" className="h-7 text-destructive" disabled={cancel.isPending}
              onClick={async () => await confirmDialog({ title: 'Huỷ yêu cầu ký này?', confirmText: 'Huỷ yêu cầu', cancelText: 'Không', destructive: true }) && cancel.mutate(r.id, { onSuccess: () => toast.success('Đã huỷ yêu cầu ký'), onError: (e) => toast.error(errorMessage(e)) })}>
              <X className="size-3.5" /> Huỷ
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

