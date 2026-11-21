import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import type { ExecutorConfig } from '../../config';

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

/** HOME của CLI agent: `executor.home`, không đặt thì HOME của runner (cùng quy tắc với `core/env.ts`). */
export const execHome = (exec: ExecutorConfig) => exec.home ?? process.env.HOME ?? homedir();

/** Đọc một file JSON là object; chưa có file / rỗng / hỏng / không phải object → `{}` (adapter ghi lại từ đầu). */
export function readJsonObject(file: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Trường con là object của một object JSON (không phải → `{}`), đã chép — sửa không đụng bản gốc. */
export const jsonObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};

/**
 * Cảnh báo `doctor` dùng chung cho CLI không có trần ngân sách / số vòng (codex, antigravity, cursor): `max_budget_usd` / `max_turns`
 * (cả trong `light`) có đặt cũng không có tác dụng. Không đặt → undefined.
 */
export function ignoredLimitsWarning(exec: ExecutorConfig, cli: string): string | undefined {
  const ignored = [
    exec.maxBudgetUsd !== undefined || exec.light?.maxBudgetUsd !== undefined ? 'max_budget_usd' : '',
    exec.maxTurns !== undefined || exec.light?.maxTurns !== undefined ? 'max_turns' : '',
  ].filter(Boolean);
  return ignored.length
    ? `${ignored.join(', ')} không có tác dụng với ${cli} (CLI không có trần này) — chỉ timeout_min chặn phiên`
    : undefined;
}

/** Cảnh báo `doctor` dùng chung: agent chưa có HOME riêng. */
export const sharedHomeWarning = (home: string) =>
  `chưa đặt executor.home — CLI dùng HOME của runner (${home}); nên dùng HOME riêng, sạch cho agent`;
