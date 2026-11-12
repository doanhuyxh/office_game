import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { FlaskConical, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { confirmDialog } from '@/components/common/confirm-dialog';
import { StatusBadge } from '@/components/common/StatusBadge';
import { formatDateTime } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useSettingsMutations } from '../../hooks/useSystem';
import type { ISaveSettingsRequest, ISettingsGroup } from '../../types/system.types';

/**
 * Khung chung của một nhóm cấu hình (tab Cấu hình): nguồn đang dùng (DB / .env), Lưu, Kiểm tra, Dùng lại .env.
 * Form bên trong do card con vẽ (`children(errors)`); `build()` trả body PUT; `onSaved` để card con xoá ô bí mật đã nhập.
 */
export function SettingsCardShell({ group, icon: Icon, description, dirty, build, onSaved, children }: {
  group: ISettingsGroup;
  icon: LucideIcon;
  description: ReactNode;
  dirty: boolean;
  build: () => ISaveSettingsRequest;
  onSaved: () => void;
  children: (errors: Record<string, string>) => ReactNode;
}) {
  const { save, reset, test } = useSettingsMutations(group.group);
  const errors = fieldErrors(save.error);
  const busy = save.isPending || reset.isPending;
  return (
    <Card data-testid={`settings-${group.group}`} id={`settings-${group.group}`}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Icon className="size-4 text-muted-foreground" />{group.name}
          <StatusBadge tone={group.source === 'db' ? 'success' : 'muted'}>{group.source === 'db' ? 'Lưu trên trang' : 'Đang đọc .env'}</StatusBadge>
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
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={busy || !dirty}>Lưu</Button>
            <Button type="button" variant="outline" disabled={busy || test.isPending} onClick={() => test.mutate()} data-testid={`settings-${group.group}-test`}>
              <FlaskConical /> Kiểm tra
            </Button>
            {group.source === 'db' && (
              <Button type="button" variant="ghost" disabled={busy} onClick={async () => {
                if (!(await confirmDialog({ title: `Dùng lại .env cho ${group.name}?`, description: 'Cấu hình lưu trên trang bị xoá, hệ thống đọc lại biến trong .env ngay.', destructive: true, confirmText: 'Dùng .env' }))) return;
                test.reset();
                reset.mutate(undefined, { onSuccess: () => { onSaved(); toast.success('Đã chuyển về đọc .env'); }, onError: (err) => toast.error(errorMessage(err)) });
              }}>
                <RotateCcw /> Dùng lại .env
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {group.source === 'db'
                ? `Sửa lần cuối ${group.updatedAt ? formatDateTime(group.updatedAt) : ''}${group.updatedBy ? ` bởi ${group.updatedBy}` : ''}.`
                : 'Chưa lưu trên trang — Lưu để chuyển sang dùng cấu hình này.'}
            </span>
          </div>
          {(test.data || test.error) && (
            <p className={`text-sm ${test.data?.ok ? 'text-success' : 'text-destructive'}`} data-testid={`settings-${group.group}-result`}>
              {test.data ? test.data.message : errorMessage(test.error)}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
