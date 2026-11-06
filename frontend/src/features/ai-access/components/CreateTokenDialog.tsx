import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { SelectField } from '@/components/common/SelectField';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useCreateAccessToken } from '../hooks/useAccessTokens';
import { LIFETIMES } from '../utils/labels';
import { CopyBlock } from './CopyBlock';

/** Tạo token → hiện token MỘT lần. `onCreated` để trang điền sẵn token vào hướng dẫn kết nối. */
export function CreateTokenDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (token: string) => void;
}) {
  const create = useCreateAccessToken();
  const [name, setName] = useState('');
  const [days, setDays] = useState('90');
  const [token, setToken] = useState<string | null>(null);
  const errors = fieldErrors(create.error);

  const close = (o: boolean) => {
    if (o) return;
    onOpenChange(false);
    // reset sau khi dialog đóng xong để không nháy nội dung
    setTimeout(() => { setName(''); setDays('90'); setToken(null); create.reset(); }, 200);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate({ name: name.trim(), expiresInDays: Number(days) }, {
      onSuccess: (r) => { setToken(r.token); onCreated(r.token); },
      onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
    });
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        {token ? (
          <>
            <DialogHeader>
              <DialogTitle>Token đã tạo</DialogTitle>
              <DialogDescription>Chép token ngay bây giờ. Sau khi đóng hộp thoại sẽ không xem lại được nữa.</DialogDescription>
            </DialogHeader>
            <CopyBlock value={token} />
            <div className="flex gap-2 rounded-md bg-warning/15 p-3 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>Token có quyền như tài khoản của bạn (trừ hợp đồng và lương). Không gửi cho người khác, không đưa lên Git. Lộ thì thu hồi ngay.</span>
            </div>
            <DialogFooter>
              <Button onClick={() => close(false)}>Tôi đã chép, xem hướng dẫn kết nối</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Tạo token kết nối AI</DialogTitle>
              <DialogDescription>Mỗi thiết bị / ứng dụng nên dùng một token riêng để thu hồi riêng được.</DialogDescription>
            </DialogHeader>
            <form onSubmit={submit} className="grid gap-4">
              <FormField id="tk-name" label="Tên gợi nhớ *" required maxLength={100} autoFocus value={name}
                onChange={(e) => setName(e.target.value)} placeholder="Vd: Claude Code trên MacBook" error={errors.name} />
              <SelectField id="tk-days" label="Thời hạn" value={days} onChange={(v) => setDays(v ?? '90')} options={LIFETIMES} error={errors.expiresInDays} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => close(false)}>Huỷ</Button>
                <Button type="submit" disabled={create.isPending || !name.trim()}>{create.isPending ? 'Đang tạo…' : 'Tạo token'}</Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
