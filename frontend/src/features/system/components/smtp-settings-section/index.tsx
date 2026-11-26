import { Mail } from 'lucide-react';
import { DbSettingsSection } from '../db-settings-section';
import { SettingsGroupCard, type ISettingsField } from '../settings-group-card';
import { SmtpStatusCard } from '../smtp-status-card';

const SMTP_FIELDS: ISettingsField[] = [
  { key: 'host', label: 'Máy chủ SMTP', kind: 'text', placeholder: 'smtp.gmail.com' },
  { key: 'port', label: 'Cổng', kind: 'number', min: 1, max: 65535, hint: '587 = STARTTLS (bỏ chọn SSL), 465 = SSL.' },
  { key: 'username', label: 'Tài khoản', kind: 'text' },
  { key: 'password', label: 'Mật khẩu', kind: 'secret', clearable: true },
  { key: 'fromEmail', label: 'Email người gửi', kind: 'text' },
  { key: 'fromName', label: 'Tên người gửi', kind: 'text', placeholder: 'OfficeHub' },
  { key: 'useSsl', label: 'SSL ngay khi kết nối (cổng 465)', kind: 'bool' },
  { key: 'checkCertificateRevocation', label: 'Kiểm tra thu hồi chứng chỉ TLS', kind: 'bool', hint: 'Nên bật. Chỉ tắt khi máy chủ báo "incomplete certificate revocation check".' },
];

/** Mục Hạ tầng → Email (SMTP) của tab Cấu hình (TEST-41): khung "Đang dùng" + tình trạng (TEST-235, trước là tab riêng) trên form cấu hình. */
export function SmtpSettingsSection() {
  return (
    <DbSettingsSection group="smtp">
      {(g) => (
        <>
          <SmtpStatusCard />
          <SettingsGroupCard group={g} icon={Mail} fields={SMTP_FIELDS}
            description="Máy chủ gửi email (thông báo, mời, quên mật khẩu). Kiểm tra = gửi một thư thử tới email nhập ở ô “Gửi thư thử tới” (mặc định email của bạn)." />
        </>
      )}
    </DbSettingsSection>
  );
}
