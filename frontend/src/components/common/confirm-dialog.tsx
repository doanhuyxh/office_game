import { useEffect, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/common/alert-dialog';
import { Button } from '@/components/common/button';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { Textarea } from '@/components/common/textarea';
import { errorMessage } from '@/utils/errors';

/**
 * Hộp xác nhận / nhập liệu dùng chung, thay `window.confirm` / `window.prompt` của trình duyệt (cấm dùng hai hàm đó).
 *   if (!(await confirmDialog({ title: 'Xoá X?', destructive: true }))) return;
 *   const reason = await promptDialog({ title: 'Lý do huỷ?' }); // null = bấm Huỷ
 * Có `onConfirm` (TEST-131): bấm đồng ý → chạy `onConfirm` (prompt nhận chuỗi đã trim), hộp GIỮ MỞ + nút đồng ý xoay
 * "Đang xử lý…", nút Huỷ / Esc bị chặn; xong → đóng và trả `true` / chuỗi; lỗi → toast `errorMessage(lỗi)`, hộp vẫn mở
 * để thử lại hoặc Huỷ (nên dùng `mutateAsync` và KHÔNG toast lỗi thêm ở chỗ gọi).
 *   await confirmDialog({ title: 'Xoá X?', destructive: true, onConfirm: () => remove.mutateAsync(id) });
 * `<ConfirmHost />` gắn một lần ở App.
 */
export interface ConfirmOptions {
  title: string;
  description?: string;
  /** Nhãn nút đồng ý (mặc định "Đồng ý"). */
  confirmText?: string;
  cancelText?: string;
  /** Nút đồng ý màu đỏ (xoá / huỷ). */
  destructive?: boolean;
  /** Việc chạy khi bấm đồng ý; trả Promise → hộp giữ mở + loading tới khi xong (lỗi → toast, hộp vẫn mở). */
  onConfirm?: (value: string) => unknown;
}

export interface PromptOptions extends ConfirmOptions {
  label?: string;
  placeholder?: string;
  initial?: string;
  /** Ô nhiều dòng. */
  multiline?: boolean;
  /** Bắt buộc nhập mới bấm được đồng ý. */
  required?: boolean;
}

type Request =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void };

let current: Request | null = null;
const listeners = new Set<() => void>();
const set = (r: Request | null) => { current = r; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

/** Đóng hộp đang mở (nếu có) như bấm Huỷ rồi mở hộp mới. */
function open(r: Request) {
  if (current) settle(current, false);
  set(r);
}
function settle(r: Request, ok: boolean, value?: string) {
  if (r.kind === 'confirm') r.resolve(ok);
  else r.resolve(ok ? value ?? '' : null);
}

export function confirmDialog(opts: ConfirmOptions | string): Promise<boolean> {
  return new Promise((resolve) => open({ kind: 'confirm', opts: typeof opts === 'string' ? { title: opts } : opts, resolve }));
}

/** Trả về chuỗi đã trim, hoặc `null` nếu người dùng bấm Huỷ / đóng hộp. */
export function promptDialog(opts: PromptOptions | string): Promise<string | null> {
  return new Promise((resolve) => open({ kind: 'prompt', opts: typeof opts === 'string' ? { title: opts } : opts, resolve }));
}

export function ConfirmHost() {
  const req = useSyncExternalStore(subscribe, () => current);
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => { setValue(req?.kind === 'prompt' ? req.opts.initial ?? '' : ''); setPending(false); }, [req]);

  const close = (ok: boolean) => {
    if (!req) return;
    settle(req, ok, value.trim());
    set(null);
  };
  const confirm = async () => {
    if (!req || pending) return;
    const run = req.opts.onConfirm;
    if (!run) return close(true);
    setPending(true);
    try {
      await run(value.trim());
      if (current === req) close(true);
    } catch (err) {
      if (current === req) toast.error(errorMessage(err));
    } finally {
      if (current === req) setPending(false);
    }
  };
  const opts = req?.opts;
  const prompt = req?.kind === 'prompt' ? req.opts : null;
  const disabled = !!prompt?.required && !value.trim();
  const submit = () => { if (!disabled) void confirm(); };

  return (
    <AlertDialog open={!!req} onOpenChange={(o) => !o && !pending && close(false)}>
      <AlertDialogContent className="sm:max-w-md" data-testid="confirm-dialog">
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <AlertDialogHeader>
            <AlertDialogTitle>{opts?.title}</AlertDialogTitle>
            {opts?.description
              ? <AlertDialogDescription className="whitespace-pre-line">{opts.description}</AlertDialogDescription>
              : <AlertDialogDescription className="sr-only">{opts?.title}</AlertDialogDescription>}
          </AlertDialogHeader>
          {prompt && (
            <div className="grid gap-2">
              {prompt.label && <Label htmlFor="confirm-dialog-input">{prompt.label}</Label>}
              {prompt.multiline
                ? <Textarea id="confirm-dialog-input" rows={3} disabled={pending} value={value} placeholder={prompt.placeholder} onChange={(e) => setValue(e.target.value)} autoFocus />
                : <Input id="confirm-dialog-input" disabled={pending} value={value} placeholder={prompt.placeholder} onChange={(e) => setValue(e.target.value)} autoFocus />}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={pending}>{opts?.cancelText ?? 'Huỷ'}</AlertDialogCancel>
            {/* Button thường thay AlertDialogAction (asChild không hiện vòng xoay; Action tự đóng hộp). */}
            <Button type="submit" variant={opts?.destructive ? 'destructive' : 'default'} disabled={disabled}
              loading={pending} loadingText="Đang xử lý…" data-testid="confirm-dialog-ok">
              {opts?.confirmText ?? 'Đồng ý'}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
