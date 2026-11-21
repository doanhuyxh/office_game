import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { bridgeCommand } from '../../../hub/mcp-bridge';
import { jsonObject, type McpServer, readJsonObject } from '../shared';

/** Thư mục dữ liệu của Antigravity CLI trong HOME của agent (kiểm với agy 1.5.14). */
const cliDir = (home: string) => join(home, '.gemini', 'antigravity-cli');

/** File MCP toàn cục của Antigravity: `<HOME>/.gemini/config/mcp_config.json` (`agy mcp add` ghi vào đây). */
export const antigravityMcpFile = (home: string) => join(home, '.gemini', 'config', 'mcp_config.json');

/** Phiên (`conversation_id`) còn ở máy không: mỗi hội thoại một file `<HOME>/.gemini/antigravity-cli/conversations/<id>.db`. */
export const antigravityHasSession = (home: string, _cwd: string, sessionId: string) =>
  /^[A-Za-z0-9-]+$/.test(sessionId) && existsSync(join(cliDir(home), 'conversations', `${sessionId}.db`));

/** HOME này đã từng chạy `agy` chưa (CLI tạo `installation_id` ở lần chạy đầu) — chưa thì chắc chắn chưa đăng nhập. */
export const antigravityEverRan = (home: string) => existsSync(join(cliDir(home), 'installation_id'));

/**
 * Ghi máy chủ MCP của job vào file MCP toàn cục trong HOME của agent — `agy` không có cờ khai MCP, và không ghi vào thư mục làm việc
 * (`.agents/mcp_config.json`) vì sẽ lẫn vào repo. Antigravity KHÔNG thay biến môi trường trong `headers` của máy chủ HTTP (đã thử `${X}`,
 * `$X`, `${env:X}`…: gửi nguyên chuỗi) → khai kiểu stdio trỏ vào cầu nối của runner; tiến trình con kế thừa env của phiên nên token chỉ
 * nằm trong biến môi trường. Máy chủ khác đã có trong file (người dùng tự khai) được giữ nguyên; file hỏng → ghi lại từ đầu.
 * @returns tên các máy chủ của job (để dựng luật cho phép).
 */
export function writeAntigravityMcp(home: string, servers: McpServer[]): string[] {
  const file = antigravityMcpFile(home);
  const current = readJsonObject(file);
  const mcpServers = jsonObject(current.mcpServers);
  for (const s of servers) mcpServers[s.name] = { ...bridgeCommand(s.url, s.bearerEnv), disabled: false };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...current, mcpServers }, null, 2)}\n`, { mode: 0o600 });
  return servers.map((s) => s.name);
}
