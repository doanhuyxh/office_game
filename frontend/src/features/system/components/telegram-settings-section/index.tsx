import { Send } from 'lucide-react';
import { DbSettingsSection } from '../db-settings-section';
import { SettingsGroupCard, type ISettingsField } from '../settings-group-card';

const TELEGRAM_FIELDS: ISettingsField[] = [
  { key: 'enabled', label: 'Bật kênh Telegram', kind: 'bool', hint: 'Tắt = giao việc cho bot không gửi tin (vẫn lưu được cấu hình để bật sau).' },
  { key: 'chatId', label: 'Chat id nhóm', kind: 'text', placeholder: '-1001234567890', hint: 'Nhóm / siêu nhóm dạng -100…, hoặc @tenkenh.' },
  { key: 'botToken', label: 'Bot token (bot thông báo của OfficeHub)', kind: 'secret', placeholder: '123456789:AA…', hint: 'Lấy từ @BotFather.' },
];

/** Mục Thông báo → Telegram (đánh thức agent) của tab Cấu hình (TEST-42). */
export function TelegramSettingsSection() {
  return (
    <DbSettingsSection group="telegram">
      {(g) => <SettingsGroupCard group={g} icon={Send} fields={TELEGRAM_FIELDS} testLabel="Gửi thử"
        description={<>
          Đánh thức agent: khi một việc được giao cho tài khoản bot (Nhân viên → "Đánh dấu là bot"), OfficeHub gửi đúng một tin vào nhóm — một dòng JSON
          <code className="rounded bg-muted px-1 text-xs">employee_code, project_id, task_id, task_code</code> (không có nội dung việc). Agent đọc nhóm và tự nhận việc có
          <code className="rounded bg-muted px-1 text-xs">employee_code</code> của mình.
        </>} />}
    </DbSettingsSection>
  );
}
