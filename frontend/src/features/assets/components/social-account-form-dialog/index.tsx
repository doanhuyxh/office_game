import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Label } from '@/components/common/label';
import { SelectField } from '@/components/common/SelectField';
import { Textarea } from '@/components/common/textarea';
import { departmentOptions, useDepartments } from '@/features/employees';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { assetApi } from '../../api/asset.api';
import { useAssetMutation } from '../../hooks/useAssets';
import type { ISocialAccount, ISocialAccountRequest } from '../../types/asset.types';
import { SocialTokenGuide } from '../social-token-guide';

const empty = (): ISocialAccountRequest => ({ name: '', externalId: null, loginHint: null, ownerDepartmentId: null, note: null, token: null });

/** Thêm / sửa Business Manager. Token chỉ nhập khi thêm (đổi token: trong chi tiết BM). */
export function SocialAccountFormDialog({ open, onOpenChange, account, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; account?: ISocialAccount | null; onCreated?: (id: string) => void;
}) {
  const { data: departments = [] } = useDepartments();
  const [form, setForm] = useState<ISocialAccountRequest>(empty);
  const save = useAssetMutation((b: ISocialAccountRequest) => assetApi.saveSocialAccount(account?.id, b));
  useEffect(() => {
    if (!open) return;
    save.reset();
    setForm(account ? {
      name: account.name, externalId: account.externalId, loginHint: account.loginHint, ownerDepartmentId: account.ownerDepartmentId, note: account.note,
    } : empty());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account?.id]);
  const set = <K extends keyof ISocialAccountRequest>(k: K, v: ISocialAccountRequest[K]) => setForm((f) => ({ ...f, [k]: v }));
  const errors = fieldErrors(save.error);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{account ? `Sửa ${account.name}` : 'Thêm Business Manager'}</DialogTitle>
          <DialogDescription>Business Manager Facebook của công ty. Không lưu mật khẩu đăng nhập — chỉ lưu token System User (mã hoá) để đăng bài.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4 sm:grid-cols-2" autoComplete="off" onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ ...form, name: form.name.trim(), token: account ? undefined : form.token?.trim() || null }, {
            onSuccess: (d) => {
              const a = d.account;
              if (!account && a.tokenStatus === 'Invalid') toast.warning(`Đã thêm BM, nhưng token lỗi: ${a.tokenError ?? ''}`);
              else toast.success(account ? 'Đã lưu' : a.hasToken ? `Đã thêm BM · ${a.pageCount} trang` : 'Đã thêm BM');
              onOpenChange(false);
              if (!account) onCreated?.(a.id);
            },
            onError: (x) => !Object.keys(fieldErrors(x)).length && toast.error(errorMessage(x)),
          });
        }}>
          <FormField id="sa-name" label="Tên gọi *" value={form.name} error={errors.name} placeholder="VD: BM Marketing chính" onChange={(e) => set('name', e.target.value)} />
          <FormField id="sa-ext" label="ID Business Manager" inputMode="numeric" value={form.externalId ?? ''} error={errors.externalId}
            hint="Trong business.facebook.com → Cài đặt doanh nghiệp → Thông tin doanh nghiệp" onChange={(e) => set('externalId', e.target.value.replace(/\D/g, '') || null)} />
          <FormField id="sa-login" label="Email / SĐT tài khoản quản trị" value={form.loginHint ?? ''} error={errors.loginHint}
            onChange={(e) => set('loginHint', e.target.value || null)} />
          <SelectField id="sa-dept" label="Phòng ban sở hữu" value={form.ownerDepartmentId} onChange={(v) => set('ownerDepartmentId', v)} allowEmpty
            options={departmentOptions(departments)} />
          {!account && (
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="sa-token">Token System User</Label>
              <Textarea id="sa-token" rows={3} className="font-mono text-xs" value={form.token ?? ''} aria-invalid={!!errors.token} spellCheck={false}
                placeholder="EAAG… (có thể nhập sau)" onChange={(e) => set('token', e.target.value || null)} />
              {errors.token && <p className="text-xs text-destructive">{errors.token}</p>}
              <SocialTokenGuide />
            </div>
          )}
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="sa-note">Ghi chú</Label>
            <Textarea id="sa-note" rows={2} value={form.note ?? ''} onChange={(e) => set('note', e.target.value || null)} />
          </div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Huỷ</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Đang kiểm tra…' : 'Lưu'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
