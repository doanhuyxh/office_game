import { useEffect, useState } from 'react';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { Textarea } from '@/components/common/textarea';

export interface PromptSpec {
  title: string;
  description?: string;
  /** none = chỉ xác nhận; text = ô nhập nhiều dòng (bắt buộc nếu required); date = chọn ngày (trống = không giới hạn); line = ô một dòng */
  input?: 'none' | 'text' | 'date' | 'line';
  label?: string;
  initial?: string;
  required?: boolean;
  confirm: string;
  destructive?: boolean;
  onConfirm: (value: string) => Promise<unknown> | void;
}

/** Hộp xác nhận / nhập một giá trị (lý do huỷ, hạn mới, tên thư mục…). Lỗi từ onConfirm hiện ngay trong hộp. */
export function PromptDialog({ spec, onClose }: { spec: PromptSpec | null; onClose: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setValue(spec?.initial ?? ''); setError(null); setBusy(false); }, [spec]);
  if (!spec) return null;
  const input = spec.input ?? 'none';
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await spec.onConfirm(value.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? (e as Error & { messages?: string }).messages ?? e.message : 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{spec.title}</DialogTitle>
          {spec.description && <DialogDescription className="whitespace-pre-line">{spec.description}</DialogDescription>}
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          {input !== 'none' && (
            <div className="grid gap-2">
              {spec.label && <Label htmlFor="prompt-input">{spec.label}</Label>}
              {input === 'text' ? <Textarea id="prompt-input" rows={3} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
                : <Input id="prompt-input" type={input === 'date' ? 'date' : 'text'} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />}
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
            <Button type="submit" variant={spec.destructive ? 'destructive' : 'default'} disabled={busy || (!!spec.required && !value.trim())}>
              {busy ? 'Đang xử lý…' : spec.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
