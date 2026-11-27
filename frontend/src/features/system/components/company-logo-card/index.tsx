import { ImageUp, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { confirmDialog } from '@/components/common/confirm-dialog';
import { BrandLogo } from '@/features/branding';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useCompanyLogo } from '../../hooks/useSystem';
import type { ISettingsGroup } from '../../types/system.types';

const MAX_BYTES = 1024 * 1024;

/** Logo công ty (TEST-261): xem trước, tải lên (PNG / JPG / WebP ≤ 1 MB), xoá. Server kiểm loại + chữ ký file. */
export function CompanyLogoCard({ group }: { group: ISettingsGroup }) {
  const { upload, remove } = useCompanyLogo();
  const input = useRef<HTMLInputElement>(null);
  const hasLogo = !!group.values.logoKey;
  const pick = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) { toast.error('Logo tối đa 1 MB'); return; }
    upload.mutate(file, {
      onSuccess: () => toast.success('Đã cập nhật logo'),
      onError: (err) => toast.error(fieldErrors(err).file ?? errorMessage(err)),
    });
  };
  return (
    <Card data-testid="company-logo-card">
      <CardHeader>
        <CardTitle className="text-base">Logo</CardTitle>
        <CardDescription>Hiện ở thanh bên, trang đăng nhập và các trang chia sẻ công khai. Nên dùng ảnh vuông, nền trong suốt; PNG, JPG hoặc WebP, tối đa 1 MB.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <BrandLogo className="size-16 rounded-xl" />
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" data-testid="company-logo-input"
          onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        <Button type="button" variant="outline" loading={upload.isPending} loadingText="Đang tải…" disabled={remove.isPending} onClick={() => input.current?.click()}>
          <ImageUp /> {hasLogo ? 'Đổi logo' : 'Tải logo lên'}
        </Button>
        {hasLogo && (
          <Button type="button" variant="ghost" loading={remove.isPending} disabled={upload.isPending} onClick={async () => {
            if (await confirmDialog({
              title: 'Xoá logo công ty?', description: 'Các trang sẽ hiện biểu tượng mặc định.', destructive: true, confirmText: 'Xoá logo',
              onConfirm: () => remove.mutateAsync(undefined),
            })) toast.success('Đã xoá logo');
          }}>
            <Trash2 /> Xoá logo
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
