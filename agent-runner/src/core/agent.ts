import type { AgentConfig } from '../config';
import type { ActivitySender } from '../hub/activity';
import type { OfficeHubClient } from '../hub/client';
import type { PresenceReporter } from '../hub/presence';
import type { TranscriptReporter } from '../hub/transcript';
import type { UsageReporter } from '../hub/usage';
import type { TelegramClient } from '../telegram';

/** Một agent đang được runner quản lý: cấu hình + các client / bộ gửi dùng token của chính agent + kết quả kiểm tra gần nhất. */
export interface AgentState {
  cfg: AgentConfig;
  hub: OfficeHubClient;
  tg: TelegramClient;
  /** Trạng thái đang làm / rảnh trong văn phòng 3D (bàn ↔ Khu nghỉ). */
  presence: PresenceReporter;
  /** Luồng "agent đang làm gì" cho người xem trực tiếp trong 3D (TEST-99). */
  activity: ActivitySender;
  /** Gửi chi phí / token mỗi phiên lên OfficeHub (TEST-135). */
  usage: UsageReporter;
  /** Gửi transcript phiên lên cloud + khôi phục lười (TEST-144) — chỉ adapter có transcript (`claude`). */
  transcripts?: TranscriptReporter;
  employeeId?: string;
  /** Họ tên nhân viên của token — nhận ra bình luận / thao tác của chính agent trong `get_task` (job follow, TEST-180). */
  employeeName?: string;
  enabled: boolean;
  problem?: string;
  /** Model thật đọc được lúc chạy thử (`checkAgents`, TEST-64). */
  model?: string;
}
