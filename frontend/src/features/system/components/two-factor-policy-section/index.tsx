import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Label } from '@/components/common/label';
import { RadioGroup, RadioGroupItem } from '@/components/common/radio-group';
import { DbSettingsSection } from '../db-settings-section';
import { SettingsCardShell } from '../settings-card-shell';
import type { ISettingsGroup } from '../../types/system.types';

const SCOPES = [
  { value: 'admin_hr', label: 'Chỉ quản trị viên + HR', hint: 'Mặc định. Nhân viên khác tự chọn có bật hay không ở trang Hồ sơ.' },
  { value: 'managers', label: 'Quản trị viên + HR + quản lý', hint: 'Thêm mọi tài khoản có vai trò Quản lý.' },
  { value: 'all', label: 'Mọi tài khoản', hint: 'Mọi người phải bật trước khi dùng tiếp — kể cả kết nối AI (token cũ ngừng chạy tới khi bật).' },
] as const;

function TwoFactorPolicyCard({ group }: { group: ISettingsGroup }) {
  const initial = (group.values.scope as string | undefined) ?? 'admin_hr';
  const [scope, setScope] = useState(initial);
  useEffect(() => setScope(initial), [initial]);
  return (
    <SettingsCardShell group={group} icon={ShieldCheck} dirty={scope !== initial}
      description="Ai bắt buộc bật xác thực 2 lớp (ứng dụng TOTP). Người chưa bật vẫn đăng nhập được nhưng phải bật xong mới dùng tiếp; người đã bật không tự tắt được. Tài khoản bot chỉ bắt buộc khi có vai trò quản trị viên / HR."
      build={() => ({ values: { scope } })} onSaved={() => undefined}>
      {(errors) => (
        <div className="grid gap-2">
          <RadioGroup value={scope} onValueChange={setScope} className="grid gap-3" data-testid="two-factor-scope" aria-label="Phạm vi bắt buộc 2FA">
            {SCOPES.map((s) => (
              <div key={s.value} className="flex items-start gap-2">
                <RadioGroupItem id={`two-factor-scope-${s.value}`} value={s.value} className="mt-0.5" />
                <div className="grid gap-0.5">
                  <Label htmlFor={`two-factor-scope-${s.value}`}>{s.label}</Label>
                  <p className="text-xs text-muted-foreground">{s.hint}</p>
                </div>
              </div>
            ))}
          </RadioGroup>
          {errors.scope && <p className="text-xs text-destructive">{errors.scope}</p>}
        </div>
      )}
    </SettingsCardShell>
  );
}

/** Mục Bảo mật → Xác thực 2 lớp của tab Cấu hình (TEST-258): phạm vi bắt buộc 2FA. */
export function TwoFactorPolicySection() {
  return <DbSettingsSection group="two_factor">{(g) => <TwoFactorPolicyCard group={g} />}</DbSettingsSection>;
}
