import { KeyRound } from 'lucide-react';
import { DbSettingsSection } from '../db-settings-section';
import { SettingsGroupCard, type ISettingsField } from '../settings-group-card';

const PASSWORD_FIELDS: ISettingsField[] = [
  { key: 'minLength', label: 'Độ dài tối thiểu (ký tự)', kind: 'number', min: 8, max: 64, hint: '8–64, mặc định 8.' },
  { key: 'maxFailures', label: 'Số lần nhập sai trước khi chặn', kind: 'number', min: 3, max: 20,
    hint: 'Mật khẩu: tính theo tài khoản + IP (người khác không khoá được tài khoản của bạn). Mã 2FA / mật khẩu hiện tại: tính theo tài khoản. Mặc định 5.' },
  { key: 'blockMinutes', label: 'Thời gian chặn (phút)', kind: 'number', min: 1, max: 1440, hint: '1–1440, mặc định 15.' },
  { key: 'requireDigit', label: 'Bắt buộc có chữ số (0–9)', kind: 'bool' },
  { key: 'requireLowercase', label: 'Bắt buộc có chữ thường (a–z)', kind: 'bool' },
  { key: 'requireUppercase', label: 'Bắt buộc có chữ hoa (A–Z)', kind: 'bool' },
  { key: 'requireNonAlphanumeric', label: 'Bắt buộc có ký tự đặc biệt (vd ! @ # $)', kind: 'bool' },
];

/** Mục Bảo mật → Mật khẩu & đăng nhập sai của tab Cấu hình (TEST-260). */
export function PasswordPolicySection() {
  return (
    <DbSettingsSection group="password">
      {(g) => <SettingsGroupCard group={g} icon={KeyRound} fields={PASSWORD_FIELDS}
        description="Quy tắc áp dụng khi đổi / đặt mật khẩu (link mời, quên mật khẩu) và cho mật khẩu tạm HR cấp. Mật khẩu đang dùng không bị bắt đổi. Ngoài ra mỗi tài khoản vẫn bị chặn khi sai tổng 30 lần / giờ từ mọi IP." />}
    </DbSettingsSection>
  );
}
