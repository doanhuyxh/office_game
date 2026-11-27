import { Building } from 'lucide-react';
import { CompanyLogoCard } from '../company-logo-card';
import { DbSettingsSection } from '../db-settings-section';
import { SettingsGroupCard, type ISettingsField } from '../settings-group-card';

const COMPANY_FIELDS: ISettingsField[] = [
  { key: 'name', label: 'Tên hiển thị', kind: 'text', placeholder: 'Công ty ABC', hint: 'Bắt buộc. Hiện ở thanh bên, trang đăng nhập, tiêu đề tab trình duyệt.' },
  { key: 'legalName', label: 'Tên pháp lý đầy đủ', kind: 'text', placeholder: 'Công ty TNHH ABC Việt Nam' },
  { key: 'taxCode', label: 'Mã số thuế', kind: 'text', placeholder: '0101234567', hint: '10 chữ số; chi nhánh: 10 số + "-" + 3 số.' },
  { key: 'phone', label: 'Điện thoại', kind: 'text', placeholder: '024 1234 5678' },
  { key: 'email', label: 'Email liên hệ', kind: 'text', placeholder: 'lienhe@congty.vn' },
  { key: 'website', label: 'Website', kind: 'text', placeholder: 'https://congty.vn' },
  { key: 'address', label: 'Địa chỉ', kind: 'text', placeholder: 'Số 1 Phố A, Phường B, Hà Nội' },
];

/** Mục Chung → Thông tin công ty của tab Cấu hình (TEST-261): logo + tên / thông tin pháp lý. */
export function CompanySettingsSection() {
  return (
    <DbSettingsSection group="company">
      {(g) => (
        <div className="grid gap-4">
          <CompanyLogoCard group={g} />
          <SettingsGroupCard group={g} icon={Building} fields={COMPANY_FIELDS}
            description="Thông tin hiển thị chung của công ty. Chưa lưu → tên mặc định của hệ thống. Email gửi đi vẫn dùng tên người gửi ở mục Email (SMTP)." />
        </div>
      )}
    </DbSettingsSection>
  );
}
