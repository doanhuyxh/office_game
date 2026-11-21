import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { jsonObject, type McpServer, readJsonObject } from '../shared';

/** File MCP toàn cục của Cursor CLI: `<HOME>/.cursor/mcp.json` (kiểm với bản 2026.11.19). */
export const cursorMcpFile = (home: string) => join(home, '.cursor', 'mcp.json');

/** File quyền theo thư mục làm việc: `<cwd>/.cursor/cli.json` (`permissions.allow` / `deny`). */
export const cursorPermissionsFile = (cwd: string) => join(cwd, '.cursor', 'cli.json');

/** HOME này đã từng chạy Cursor CLI chưa (CLI tạo `cli-config.json` ở lần chạy đầu) — chưa thì chắc chắn chưa đăng nhập. */
export const cursorEverRan = (home: string) => existsSync(join(home, '.cursor', 'cli-config.json'));

/** Phiên còn ở máy không: mỗi phiên một thư mục `<HOME>/.cursor/chats/<mã thư mục làm việc>/<session_id>/`. */
export function cursorHasSession(home: string, _cwd: string, sessionId: string): boolean {
  if (!/^[A-Za-z0-9-]+$/.test(sessionId)) return false;
  const chats = join(home, '.cursor', 'chats');
  try {
    return readdirSync(chats).some((workspace) => existsSync(join(chats, workspace, sessionId)));
  } catch {
    return false;
  }
}

/**
 * Ghi máy chủ MCP của job vào `<HOME>/.cursor/mcp.json` — CLI không có cờ truyền file MCP, và runner không ghi `.cursor/mcp.json` vào
 * worktree (lẫn vào repo). Cursor thay `${env:BIẾN}` trong `headers` theo env lúc chạy (đã thử) → token chỉ nằm trong biến môi trường.
 * Máy chủ khác đã có trong file (người dùng tự khai) được giữ nguyên; file hỏng → ghi lại từ đầu.
 * @returns tên các máy chủ của job (để dựng luật quyền).
 */
export function writeCursorMcp(home: string, servers: McpServer[]): string[] {
  const file = cursorMcpFile(home);
  const current = readJsonObject(file);
  const mcpServers = jsonObject(current.mcpServers);
  for (const s of servers)
    mcpServers[s.name] = {
      url: s.url,
      ...(s.bearerEnv ? { headers: { Authorization: `Bearer \${env:${s.bearerEnv}}` } } : {}),
    };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...current, mcpServers }, null, 2)}\n`, { mode: 0o600 });
  return servers.map((s) => s.name);
}

/** Quyền của phiên CHỈ MCP: cho tool của các máy chủ MCP của job, cấm chạy lệnh / ghi / đọc file. */
export const mcpOnlyPermissions = (servers: string[]) =>
  `${JSON.stringify({ permissions: { allow: servers.map((name) => `Mcp(${name}:*)`), deny: ['Shell(*)', 'Write(**)', 'Read(**)'] } }, null, 2)}\n`;

/**
 * Phiên chỉ MCP (`restricted`): ghi quyền vào `<cwd>/.cursor/cli.json` — thư mục làm việc của phiên này là thư mục trống của runner dưới
 * `data_dir`, không phải repo. Phiên có công cụ chạy với `--force`: nếu thư mục còn file quyền do runner ghi từ phiên chỉ MCP trước đó
 * (agent vừa bật `builtin_tools`) thì gỡ, vì luật cấm trong file thắng `--force`. File quyền người dùng tự viết (nội dung khác) → giữ nguyên.
 */
export function syncCursorPermissions(cwd: string, servers: string[], restricted: boolean) {
  const file = cursorPermissionsFile(cwd);
  const ours = mcpOnlyPermissions(servers);
  if (restricted) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, ours);
    return;
  }
  try {
    if (readFileSync(file, 'utf8') === ours) rmSync(file, { force: true });
  } catch {
    /* không có file */
  }
}
