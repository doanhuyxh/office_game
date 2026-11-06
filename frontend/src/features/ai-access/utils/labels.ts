import type { StatusTone } from '@/components/common/StatusBadge';
import type { AccessTokenStatus } from '../types/accessToken.types';

export const TOKEN_STATUS: Record<AccessTokenStatus, { label: string; tone: StatusTone }> = {
  Active: { label: 'Đang dùng', tone: 'success' },
  Expired: { label: 'Hết hạn', tone: 'muted' },
  Revoked: { label: 'Đã thu hồi', tone: 'danger' },
};

/** Khớp AccessTokenEndpoints.AllowedLifetimes ở back-end. */
export const LIFETIMES = [
  { value: '30', label: '30 ngày' },
  { value: '90', label: '90 ngày' },
  { value: '180', label: '180 ngày' },
  { value: '365', label: '1 năm' },
];

/** Địa chỉ máy chủ MCP: cùng domain với web (container web chuyển /mcp → OfficeHub.Mcp). */
export const mcpUrl = () => `${window.location.origin}/mcp`;

export type ConnectMode = 'oauth' | 'token';

export interface ClientGuide {
  id: string;
  label: string;
  /** Không có = client không hỗ trợ cách đó. */
  oauth?: { steps: string; where: string; snippet?: (url: string) => string };
  token?: { steps: string; where: string; snippet: (url: string, token: string) => string };
}

const TOKEN_PLACEHOLDER = '<TOKEN>';
export const tokenOrPlaceholder = (t: string | null) => t ?? TOKEN_PLACEHOLDER;

/**
 * Hướng dẫn từng ứng dụng. "Đăng nhập" (OAuth) = ứng dụng mở trang OfficeHub để bạn bấm Cho phép, không cần chép token;
 * "Token" = dán token tạo ở trang này (cho ứng dụng / môi trường không mở được trình duyệt).
 */
export const CLIENT_GUIDES: ClientGuide[] = [
  {
    id: 'claude',
    label: 'Claude (web, Desktop, điện thoại)',
    oauth: {
      where: 'claude.ai → Settings → Connectors',
      steps: 'Vào Settings → Connectors → Add custom connector, đặt tên "OfficeHub", dán địa chỉ dưới rồi bấm Add → Connect. Trang OfficeHub mở ra: đăng nhập và bấm "Cho phép". Kết nối dùng chung cho claude.ai, Claude Desktop và app điện thoại (cùng tài khoản Claude). Gói Team / Enterprise: quản trị viên Claude thêm connector trước.',
      snippet: (url) => url,
    },
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    oauth: {
      where: 'Terminal',
      steps: 'Chạy lệnh dưới, mở Claude Code, gõ /mcp → chọn officehub → Authenticate. Trình duyệt mở trang OfficeHub để bạn bấm "Cho phép".',
      snippet: (url) => `claude mcp add --transport http --scope user officehub ${url}`,
    },
    token: {
      where: 'Terminal',
      steps: 'Chạy lệnh dưới trong terminal, rồi gõ /mcp trong Claude Code để kiểm tra "officehub" đã kết nối.',
      snippet: (url, token) => `claude mcp add --transport http --scope user officehub ${url} \\\n  --header "Authorization: Bearer ${token}"`,
    },
  },
  {
    id: 'cursor',
    label: 'Cursor',
    oauth: {
      where: '~/.cursor/mcp.json',
      steps: 'Mở Cursor Settings → MCP → Add new global MCP server (hoặc sửa ~/.cursor/mcp.json), dán nội dung dưới, lưu rồi bấm "Connect" / "Login" cạnh officehub để mở trang đăng nhập OfficeHub.',
      snippet: (url) => JSON.stringify({ mcpServers: { officehub: { url } } }, null, 2),
    },
    token: {
      where: '~/.cursor/mcp.json',
      steps: 'Mở Cursor Settings → MCP → Add new global MCP server (hoặc sửa file ~/.cursor/mcp.json), dán nội dung dưới rồi lưu.',
      snippet: (url, token) => JSON.stringify({ mcpServers: { officehub: { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
    },
  },
  {
    id: 'codex',
    label: 'Codex',
    oauth: {
      where: '~/.codex/config.toml',
      steps: 'Thêm đoạn dưới vào ~/.codex/config.toml rồi chạy lệnh đăng nhập; trình duyệt mở trang OfficeHub để bạn bấm "Cho phép".',
      snippet: (url) => `# ~/.codex/config.toml\n[mcp_servers.officehub]\nurl = "${url}"\n\n# Terminal\ncodex mcp login officehub`,
    },
    token: {
      where: '~/.codex/config.toml',
      steps: 'Thêm đoạn dưới vào ~/.codex/config.toml. Token đọc từ biến môi trường OFFICEHUB_TOKEN (đặt trong ~/.zshrc hoặc ~/.bashrc), không ghi thẳng vào file cấu hình.',
      snippet: (url, token) => `# ~/.zshrc\nexport OFFICEHUB_TOKEN="${token}"\n\n# ~/.codex/config.toml\n[mcp_servers.officehub]\nurl = "${url}"\nbearer_token_env_var = "OFFICEHUB_TOKEN"`,
    },
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot',
    oauth: {
      where: 'mcp.json (VS Code)',
      steps: 'VS Code: Ctrl/⌘+Shift+P → "MCP: Open User Configuration", dán nội dung dưới rồi lưu. Bấm "Start" cạnh officehub → VS Code hỏi đăng nhập → trang OfficeHub mở ra, bấm "Cho phép". Dùng trong Copilot Chat ở chế độ Agent (biểu tượng công cụ để bật / tắt tool). Visual Studio và JetBrains dùng cùng cấu hình mcp.json.',
      snippet: (url) => JSON.stringify({ servers: { officehub: { type: 'http', url } } }, null, 2),
    },
    token: {
      where: 'mcp.json (VS Code)',
      steps: 'VS Code: Ctrl/⌘+Shift+P → "MCP: Open User Configuration", dán nội dung dưới. Lần đầu khởi động, VS Code hỏi token (nhập token tạo ở trang này, được lưu an toàn, không ghi vào file). Copilot CLI: thêm cùng server vào ~/.copilot/mcp-config.json với header Authorization.',
      snippet: (url) => JSON.stringify({
        inputs: [{ type: 'promptString', id: 'officehub-token', description: 'Token OfficeHub (trang Kết nối AI)', password: true }],
        servers: { officehub: { type: 'http', url, headers: { Authorization: 'Bearer ${input:officehub-token}' } } },
      }, null, 2),
    },
  },
];

/** Gợi ý câu hỏi để nhân viên thử ngay sau khi kết nối. */
export const EXAMPLE_PROMPTS = [
  'Tháng này tôi đi muộn mấy lần, tổng bao nhiêu phút?',
  'Tôi còn bao nhiêu ngày phép? Xin nghỉ chiều thứ Sáu tuần này.',
  'Chấm công vào giúp tôi.',
  'Có đơn nào đang chờ tôi duyệt không?',
  'Hôm qua tôi quên chấm công ra lúc 18:05, gửi giải trình giúp tôi.',
];

/** Nhãn tool MCP cho nhật ký (khớp tên tool trong OfficeHub.Mcp/Tools). */
export const TOOL_LABEL: Record<string, string> = {
  get_my_profile: 'Xem thông tin của tôi',
  list_notifications: 'Xem thông báo',
  mark_notifications_read: 'Đánh dấu đã đọc',
  search_colleagues: 'Tra danh bạ',
  list_departments: 'Xem phòng ban',
  get_today_attendance: 'Xem chấm công hôm nay',
  check_in_out: 'Chấm công',
  get_my_timesheet: 'Xem bảng công',
  list_holidays: 'Xem ngày lễ',
  list_shifts: 'Xem ca làm',
  list_my_corrections: 'Xem giải trình',
  submit_attendance_correction: 'Gửi giải trình',
  list_my_overtime: 'Xem tăng ca',
  preview_overtime: 'Tính trước tăng ca',
  register_overtime: 'Đăng ký tăng ca',
  get_team_attendance: 'Xem chấm công của nhóm',
  get_team_attendance_report: 'Xem tổng hợp công của nhóm',
  get_employee_timesheet: 'Xem bảng công nhân viên',
  list_leave_types: 'Xem loại nghỉ',
  get_leave_balance: 'Xem quỹ phép',
  list_my_leave_requests: 'Xem đơn nghỉ',
  preview_leave: 'Tính trước ngày nghỉ',
  submit_leave_request: 'Gửi đơn nghỉ',
  list_team_leave: 'Xem lịch nghỉ của nhóm',
  list_approval_inbox: 'Xem đơn chờ duyệt',
  list_my_approval_requests: 'Xem đơn đã gửi',
  get_approval_request: 'Xem chi tiết đơn',
  approve_request: 'Duyệt đơn',
  reject_request: 'Từ chối đơn',
  cancel_my_request: 'Huỷ đơn',
};

/** Tool ghi dữ liệu — tô đậm trong nhật ký. */
export const WRITE_TOOLS = new Set([
  'check_in_out', 'submit_attendance_correction', 'register_overtime', 'submit_leave_request',
  'approve_request', 'reject_request', 'cancel_my_request', 'mark_notifications_read',
]);

export const requestTone = (status: number): StatusTone =>
  status < 300 ? 'success' : status === 401 || status === 403 ? 'danger' : status === 429 ? 'warning' : 'muted';
