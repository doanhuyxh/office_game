import { BellRing, HardDrive, Mail } from 'lucide-react';
import { Spinner } from '@/components/feedback/Spinner';
import { AgentLimitsCard } from '@/features/projects';
import { errorMessage } from '@/utils/errors';
import { useSystemSettings } from '../../hooks/useSystem';
import { OfficeIpsCard } from '../office-ips-card';
import { SettingsGroupCard, type ISettingsField } from '../settings-group-card';

const S3_FIELDS: ISettingsField[] = [
  { key: 'region', label: 'Region', kind: 'text', placeholder: 'ap-southeast-1' },
  { key: 'bucketFiles', label: 'Bucket file nghiệp vụ', kind: 'text' },
  { key: 'accessKey', label: 'Access key', kind: 'text' },
  { key: 'secretKey', label: 'Secret key', kind: 'secret' },
  { key: 'serviceUrl', label: 'Endpoint (S3-compatible)', kind: 'text', placeholder: 'Để trống khi dùng AWS', hint: 'Chỉ điền khi dùng MinIO / RustFS…' },
  { key: 'keyPrefix', label: 'Thư mục gốc trong bucket', kind: 'text', placeholder: 'officehub/', hint: 'File nằm ở {thư mục gốc}files/…' },
  { key: 'presignMinutes', label: 'Hạn link tạm (phút)', kind: 'number', min: 1, max: 1440 },
  { key: 'forcePathStyle', label: 'Force path style', kind: 'bool', hint: 'Bật khi máy chủ S3-compatible yêu cầu (MinIO thường cần).' },
];

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

const FCM_FIELDS: ISettingsField[] = [
  { key: 'serviceAccountJson', label: 'Service account JSON', kind: 'secret-json', placeholder: '{"type": "service_account", …}',
    hint: 'Firebase Console → Project settings → Service accounts → Generate new private key.' },
  { key: 'projectId', label: 'Project ID', kind: 'text', placeholder: 'Để trống = lấy từ service account' },
];

/** Tab Cấu hình của trang Hệ thống: giới hạn bot (TEST-36) + cấu hình S3 / SMTP / FCM / IP văn phòng lưu trong DB (TEST-41). */
export function ConfigTab() {
  const { data, isLoading, error } = useSystemSettings();
  const by = (g: string) => data?.find((x) => x.group === g);
  const s3 = by('s3'), smtp = by('smtp'), fcm = by('fcm'), ips = by('office_ips');
  return (
    <div className="grid gap-4">
      <AgentLimitsCard />
      {isLoading ? <Spinner /> : error || !data ? <p className="text-sm text-destructive">{errorMessage(error)}</p> : (
        <>
          <p className="text-sm text-muted-foreground">
            Lưu ở đây có hiệu lực ngay (không cần khởi động lại) và được ưu tiên hơn <code className="rounded bg-muted px-1 text-xs">.env</code>.
            Giá trị bí mật được mã hoá, không bao giờ hiển thị lại. Nút Kiểm tra dùng cấu hình đang có hiệu lực — lưu trước rồi kiểm tra.
          </p>
          {s3 && <SettingsGroupCard group={s3} icon={HardDrive} fields={S3_FIELDS}
            description="Nơi lưu file nghiệp vụ (hợp đồng, tài liệu, ảnh…). Sao lưu DB và bản build web vẫn dùng biến S3__* trong .env." />}
          {smtp && <SettingsGroupCard group={smtp} icon={Mail} fields={SMTP_FIELDS}
            description="Máy chủ gửi email (thông báo, mời, quên mật khẩu). Kiểm tra = gửi một thư thử tới email của bạn." />}
          {fcm && <SettingsGroupCard group={fcm} icon={BellRing} fields={FCM_FIELDS}
            description="Thông báo đẩy Firebase Cloud Messaging. Trống = tắt push (chuông / email vẫn chạy). Kiểm tra = gửi dry run, không tới thiết bị nào." />}
          {ips && <OfficeIpsCard group={ips} />}
        </>
      )}
    </div>
  );
}
