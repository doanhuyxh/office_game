import { HardDrive } from 'lucide-react';
import { DbSettingsSection } from '../db-settings-section';
import { SettingsGroupCard, type ISettingsField } from '../settings-group-card';
import { StorageCard } from '../storage-card';

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

/** Mục Hạ tầng → Lưu trữ (S3) của tab Cấu hình (TEST-41): form cấu hình + dung lượng đang dùng bên dưới (TEST-235, trước là tab riêng; chỉ quét khi mục đang mở). */
export function S3SettingsSection() {
  return (
    <DbSettingsSection group="s3">
      {(g) => (
        <>
          <SettingsGroupCard group={g} icon={HardDrive} fields={S3_FIELDS}
            description="Nơi lưu file nghiệp vụ (hợp đồng, tài liệu, ảnh…). Sao lưu DB và bản build web vẫn dùng biến S3__* trong .env." />
          <StorageCard />
        </>
      )}
    </DbSettingsSection>
  );
}
