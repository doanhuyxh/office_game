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

export interface ClientGuide {
  id: string;
  label: string;
  steps: string;
  /** Tên file cấu hình / nơi chạy lệnh. */
  where: string;
  snippet: (url: string, token: string) => string;
}

const TOKEN_PLACEHOLDER = '<TOKEN>';
export const tokenOrPlaceholder = (t: string | null) => t ?? TOKEN_PLACEHOLDER;

export const CLIENT_GUIDES: ClientGuide[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    where: 'Terminal',
    steps: 'Chạy lệnh dưới trong terminal, rồi gõ /mcp trong Claude Code để kiểm tra "officehub" đã kết nối.',
    snippet: (url, token) => `claude mcp add --transport http --scope user officehub ${url} \\\n  --header "Authorization: Bearer ${token}"`,
  },
  {
    id: 'cursor',
    label: 'Cursor',
    where: '~/.cursor/mcp.json',
    steps: 'Mở Cursor Settings → MCP → Add new global MCP server (hoặc sửa file ~/.cursor/mcp.json), dán nội dung dưới rồi lưu.',
    snippet: (url, token) => JSON.stringify({ mcpServers: { officehub: { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
  },
  {
    id: 'codex',
    label: 'Codex',
    where: '~/.codex/config.toml',
    steps: 'Thêm đoạn dưới vào ~/.codex/config.toml. Token đọc từ biến môi trường OFFICEHUB_TOKEN (đặt trong ~/.zshrc hoặc ~/.bashrc), không ghi thẳng vào file cấu hình.',
    snippet: (url, token) => `# ~/.zshrc\nexport OFFICEHUB_TOKEN="${token}"\n\n# ~/.codex/config.toml\n[mcp_servers.officehub]\nurl = "${url}"\nbearer_token_env_var = "OFFICEHUB_TOKEN"`,
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    where: 'claude_desktop_config.json',
    steps: 'Claude Desktop → Settings → Developer → Edit Config, thêm "officehub" vào mcpServers rồi khởi động lại Claude. Cần cài Node.js (lệnh npx). Kết nối trực tiếp từ claude.ai / app điện thoại sẽ có ở bản sau (đăng nhập OAuth).',
    snippet: (url, token) => JSON.stringify({
      mcpServers: {
        officehub: {
          command: 'npx',
          args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${OFFICEHUB_AUTH}'],
          env: { OFFICEHUB_AUTH: `Bearer ${token}` },
        },
      },
    }, null, 2),
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
