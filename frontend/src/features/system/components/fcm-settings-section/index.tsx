import { BellRing } from 'lucide-react';
import { DbSettingsSection } from '../db-settings-section';
import { SettingsGroupCard, type ISettingsField } from '../settings-group-card';

const FCM_FIELDS: ISettingsField[] = [
  { key: 'serviceAccountJson', label: 'Service account JSON', kind: 'secret-json', placeholder: '{"type": "service_account", …}',
    hint: 'Firebase Console → Project settings → Service accounts → Generate new private key.' },
  { key: 'projectId', label: 'Project ID', kind: 'text', placeholder: 'Để trống = lấy từ service account' },
];

/** Mục Thông báo → Thông báo đẩy (FCM) của tab Cấu hình (TEST-41). */
export function FcmSettingsSection() {
  return (
    <DbSettingsSection group="fcm">
      {(g) => <SettingsGroupCard group={g} icon={BellRing} fields={FCM_FIELDS}
        description="Thông báo đẩy Firebase Cloud Messaging. Trống = tắt push (chuông / email vẫn chạy). Kiểm tra = gửi dry run, không tới thiết bị nào." />}
    </DbSettingsSection>
  );
}
