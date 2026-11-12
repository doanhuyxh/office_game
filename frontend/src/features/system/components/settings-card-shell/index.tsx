import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { FlaskConical, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { confirmDialog } from '@/components/common/confirm-dialog';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { StatusBadge } from '@/components/common/StatusBadge';
import { useMe } from '@/features/auth';
import { formatDateTime } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useSettingsMutations } from '../../hooks/useSystem';
import type { ISaveSettingsRequest, ISettingsGroup } from '../../types/system.types';

/**
 * Khung chung của một nhóm cấu hình (tab Cấu hình): nguồn đang dùng (DB / .env), Lưu, Kiểm tra, Dùng lại .env.
 * Form bên trong do card con vẽ (`children(errors)`); `build()` trả body PUT; `onSaved` để card con xoá ô bí mật đã nhập.
 */
export function SettingsCardShell({ group, icon: Icon, description, dirty, build, onSaved, children, testLabel = 'Kiểm tra' }: {
  group: ISettingsGroup;
  icon: LucideIcon;
  description: ReactNode;
  dirty: boolean;
  build: () => ISaveSettingsRequest;
  onSaved: () => void;
  children: (errors: Record<string, string>) => ReactNode;
  /** Nhãn nút kiểm tra (Telegram: "Gửi thử"). */
  testLabel?: string;
}) {
  const { save, reset, test } = useSettingsMutations(group.group);
  const { data: me } = useMe();
  const isSmtp = group.group === 'smtp';
  /** Nhóm không có biến .env (Telegram): "chưa lưu" = chưa cấu hình, xoá = tắt hẳn. */
  const noEnv = group.group === 'telegram';
  // SMTP: email nhận thư thử, mặc định email tài khoản đang đăng nhập (sửa được).
  const [testTo, setTestTo] = useState('');
  useEffect(() => { if (me?.email) setTestTo((x) => x || me.email!); }, [me?.email]);
  const testErrors = fieldErrors(test.error);
  const errors = fieldErrors(save.error);
  const busy = save.isPending || reset.isPending;
  return (
    <Card data-testid={`settings-${group.group}`} id={`settings-${group.group}`}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Icon className="size-4 text-muted-foreground" />{group.name}
          <StatusBadge tone={group.source === 'db' ? 'success' : 'muted'}>{group.source === 'db' ? 'Lưu trên trang' : noEnv ? 'Chưa cấu hình' : 'Đang đọc .env'}</StatusBadge>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={(e) => {
          e.preventDefault();
          test.reset();
          save.mutate(build(), {
            onSuccess: () => { onSaved(); toast.success(`Đã lưu cấu hình ${group.name} — có hiệu lực ngay`); },
            onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
          });
        }}>
          {children(errors)}
          {isSmtp && (
            <div className="grid max-w-md gap-2">
              <Label htmlFor="settings-smtp-test-to">Gửi thư thử tới</Label>
              <Input id="settings-smtp-test-to" type="email" placeholder="email@congty.vn" value={testTo} aria-invalid={!!testErrors.to}
                onChange={(e) => setTestTo(e.target.value)} data-testid="settings-smtp-test-to" />
              <p className={`text-xs ${testErrors.to ? 'text-destructive' : 'text-muted-foreground'}`}>
                {testErrors.to ?? 'Bấm Kiểm tra để gửi thư thử bằng cấu hình đang có hiệu lực. Để trống = email tài khoản của bạn.'}
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={busy || !dirty}>Lưu</Button>
            <Button type="button" variant="outline" disabled={busy || test.isPending} onClick={() => test.mutate(isSmtp ? { to: testTo.trim() || undefined } : {})} data-testid={`settings-${group.group}-test`}>
              <FlaskConical /> {testLabel}
            </Button>
            {group.source === 'db' && (
              <Button type="button" variant="ghost" disabled={busy} onClick={async () => {
                if (!(await confirmDialog(noEnv
                  ? { title: `Xoá cấu hình ${group.name}?`, description: 'Kênh bị tắt và xoá cả giá trị bí mật đã lưu.', destructive: true, confirmText: 'Xoá' }
                  : { title: `Dùng lại .env cho ${group.name}?`, description: 'Cấu hình lưu trên trang bị xoá, hệ thống đọc lại biến trong .env ngay.', destructive: true, confirmText: 'Dùng .env' }))) return;
                test.reset();
                reset.mutate(undefined, { onSuccess: () => { onSaved(); toast.success(noEnv ? 'Đã xoá cấu hình' : 'Đã chuyển về đọc .env'); }, onError: (err) => toast.error(errorMessage(err)) });
              }}>
                <RotateCcw /> {noEnv ? 'Xoá cấu hình' : 'Dùng lại .env'}
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {group.source === 'db'
                ? `Sửa lần cuối ${group.updatedAt ? formatDateTime(group.updatedAt) : ''}${group.updatedBy ? ` bởi ${group.updatedBy}` : ''}.`
                : noEnv ? 'Chưa cấu hình.' : 'Chưa lưu trên trang — Lưu để chuyển sang dùng cấu hình này.'}
            </span>
          </div>
          {(test.data || (test.error && !testErrors.to)) && (
            <p className={`text-sm ${test.data?.ok ? 'text-success' : 'text-destructive'}`} data-testid={`settings-${group.group}-result`}>
              {test.data ? test.data.message : errorMessage(test.error)}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
