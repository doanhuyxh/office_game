import { Timer } from 'lucide-react';
import { DbSettingsSection } from '../db-settings-section';
import { SettingsGroupCard, type ISettingsField } from '../settings-group-card';

const SESSION_FIELDS: ISettingsField[] = [
  { key: 'idleHours', label: 'Tự đăng xuất khi không hoạt động sau (giờ)', kind: 'number', min: 1, max: 720,
    hint: 'Không có request nào tới máy chủ trong khoảng này → phải đăng nhập lại. Mặc định 168 giờ (7 ngày). Tab đang hiện trên màn hình tự gọi máy chủ mỗi phút nên được tính là có hoạt động; tab ẩn / máy ngủ thì không.' },
  { key: 'maxDays', label: 'Bắt đăng nhập lại sau tối đa (ngày)', kind: 'number', min: 0, max: 365,
    hint: 'Tính từ lúc đăng nhập, kể cả khi vẫn đang dùng. 0 = không giới hạn (mặc định).' },
];

/** Mục Bảo mật → Phiên đăng nhập của tab Cấu hình (TEST-259). */
export function SessionSettingsSection() {
  return (
    <DbSettingsSection group="session">
      {(g) => <SettingsGroupCard group={g} icon={Timer} fields={SESSION_FIELDS}
        description="Thời hạn phiên đăng nhập trên web. Lưu là áp dụng ngay cho mọi phiên đang mở (phiên quá hạn bị đăng xuất ở lần gọi kế tiếp). Không ảnh hưởng token AI." />}
    </DbSettingsSection>
  );
}
