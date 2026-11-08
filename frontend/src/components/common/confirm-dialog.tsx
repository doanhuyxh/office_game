import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/common/alert-dialog';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { Textarea } from '@/components/common/textarea';

/**
 * Hộp xác nhận / nhập liệu dùng chung, thay `window.confirm` / `window.prompt` của trình duyệt (cấm dùng hai hàm đó).
 *   if (!(await confirmDialog({ title: 'Xoá X?', destructive: true }))) return;
 *   const reason = await promptDialog({ title: 'Lý do huỷ?' }); // null = bấm Huỷ
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
  useEffect(() => { setValue(req?.kind === 'prompt' ? req.opts.initial ?? '' : ''); }, [req]);

  const close = (ok: boolean) => {
    if (!req) return;
    settle(req, ok, value.trim());
    set(null);
  };
  const opts = req?.opts;
  const prompt = req?.kind === 'prompt' ? req.opts : null;
  const disabled = !!prompt?.required && !value.trim();

  return (
    <AlertDialog open={!!req} onOpenChange={(o) => !o && close(false)}>
      <AlertDialogContent className="sm:max-w-md" data-testid="confirm-dialog">
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (!disabled) close(true); }}>
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
                ? <Textarea id="confirm-dialog-input" rows={3} value={value} placeholder={prompt.placeholder} onChange={(e) => setValue(e.target.value)} autoFocus />
                : <Input id="confirm-dialog-input" value={value} placeholder={prompt.placeholder} onChange={(e) => setValue(e.target.value)} autoFocus />}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel type="button">{opts?.cancelText ?? 'Huỷ'}</AlertDialogCancel>
            <AlertDialogAction type="submit" variant={opts?.destructive ? 'destructive' : 'default'} disabled={disabled}
              onClick={(e) => { e.preventDefault(); if (!disabled) close(true); }} data-testid="confirm-dialog-ok">
              {opts?.confirmText ?? 'Đồng ý'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
