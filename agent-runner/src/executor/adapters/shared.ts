import { readFileSync } from 'node:fs';

/** Thứ nhiều adapter cùng cần. Thứ chỉ một CLI dùng thì để trong thư mục của CLI đó. */
export const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Một dòng stdout dạng JSONL → object; dòng không phải JSON (log, dòng trống) → undefined. */
export function jsonLine(line: string): any {
  if (!line.startsWith('{')) return undefined;
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/** Máy chủ MCP của job, đã chuẩn hoá. `bearerEnv` = tên biến môi trường giữ token (header `Authorization: Bearer ${BIẾN}`). */
export interface McpServer {
  name: string;
  url: string;
  bearerEnv?: string;
}

/**
 * Đọc file `mcpServers` runner ghi cho job (`mcpConfig` trong `prompt/`, định dạng của Claude Code). CLI không nhận file này (codex, …)
 * thì adapter đổi danh sách trả về sang cách khai riêng của CLI đó. Không đọc được → rỗng (phiên sẽ lỗi rõ khi gọi tool).
 */
export function readMcpServers(mcpConfigFile: string): McpServer[] {
  let servers: Record<string, any> = {};
  try {
    servers = JSON.parse(readFileSync(mcpConfigFile, 'utf8'))?.mcpServers ?? {};
  } catch {
    return [];
  }
  const out: McpServer[] = [];
  for (const [name, s] of Object.entries(servers)) {
    if (!/^[A-Za-z0-9_-]+$/.test(name) || typeof s?.url !== 'string') continue;
    const bearer = /^Bearer \$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(str(s.headers?.Authorization));
    out.push({ name, url: s.url, ...(bearer ? { bearerEnv: bearer[1]! } : {}) });
  }
  return out;
}

/** Cảnh báo `doctor` dùng chung: agent chưa có HOME riêng. */
export const sharedHomeWarning = (home: string) =>
  `chưa đặt executor.home — CLI dùng HOME của runner (${home}); nên dùng HOME riêng, sạch cho agent`;
