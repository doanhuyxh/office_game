import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { errText } from '../log';

/** Tên lệnh con của runner (`officehub-runner mcp-bridge --url … --bearer-env …`). */
export const BRIDGE_COMMAND = 'mcp-bridge';

/**
 * Lệnh để CLI agent khởi động cầu nối: chính runner đang chạy — bản build một file (`process.execPath` là runner) hoặc `bun src/cli.ts`
 * khi chạy từ mã nguồn. Tham số chỉ có URL + TÊN biến môi trường, không có token.
 */
export function bridgeCommand(url: string, bearerEnv?: string): { command: string; args: string[] } {
  const cli = join(import.meta.dir, '..', 'cli.ts');
  return {
    command: process.execPath,
    args: [
      ...(existsSync(cli) ? [cli] : []),
      BRIDGE_COMMAND,
      '--url',
      url,
      ...(bearerEnv ? ['--bearer-env', bearerEnv] : []),
    ],
  };
}

/** Hạn một lần chuyển tiếp tới máy chủ MCP. */
const BRIDGE_TIMEOUT_MS = 120_000;

/**
 * Cầu nối MCP stdio → HTTP (lệnh `mcp-bridge`, TEST-201): CLI nào KHÔNG thay được biến môi trường trong header của máy chủ MCP kiểu HTTP
 * (Antigravity gửi nguyên chuỗi `${OFFICEHUB_TOKEN}`) thì khai máy chủ kiểu stdio trỏ vào lệnh này. Tiến trình con kế thừa env của phiên
 * nên token chỉ nằm trong biến môi trường `bearerEnv` — không vào file cấu hình, không vào tham số.
 *
 * Mỗi dòng stdin là một thông điệp JSON-RPC → POST tới `url` → mỗi thông điệp trả về (JSON hoặc các dòng `data:` của SSE) ghi một dòng stdout.
 * Thông báo (không có `id`) không có gì để trả. Lỗi mạng / HTTP của một yêu cầu → trả lỗi JSON-RPC cho đúng `id`, cầu nối vẫn chạy tiếp.
 */
export async function runMcpBridge(
  url: string,
  bearerEnv: string | undefined,
  input: AsyncIterable<string>,
  write: (line: string) => void,
): Promise<void> {
  const token = bearerEnv ? process.env[bearerEnv] : undefined;
  let sessionId: string | undefined;
  for await (const raw of input) {
    const line = raw.trim();
    if (!line) continue;
    let id: unknown;
    try {
      id = (JSON.parse(line) as { id?: unknown }).id;
    } catch {
      continue; // không phải JSON-RPC — bỏ
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
        },
        body: line,
        signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
      });
      sessionId = res.headers.get('mcp-session-id') ?? sessionId;
      const text = await res.text();
      if (!res.ok) throw new Error(`máy chủ MCP trả ${res.status}`);
      for (const message of bridgeMessages(text)) write(message);
    } catch (e) {
      if (id !== undefined && id !== null)
        write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: `mcp-bridge: ${errText(e)}` } }));
    }
  }
}

/** Thân phản hồi HTTP của MCP → các thông điệp JSON-RPC, mỗi cái một dòng (SSE: các dòng `data:`; JSON thường: cả thân). */
export function bridgeMessages(body: string): string[] {
  const data = body
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim());
  return (data.length ? data : [body.trim()]).filter((m) => m.startsWith('{') || m.startsWith('[')).map(oneLine);
}

const oneLine = (json: string) => {
  try {
    return JSON.stringify(JSON.parse(json));
  } catch {
    return json.replace(/\r?\n/g, ' ');
  }
};

/** Đọc stdin từng dòng. */
export async function* stdinLines(): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let rest = '';
  for await (const chunk of Bun.stdin.stream()) {
    rest += decoder.decode(chunk, { stream: true });
    let nl = rest.indexOf('\n');
    while (nl >= 0) {
      yield rest.slice(0, nl);
      rest = rest.slice(nl + 1);
      nl = rest.indexOf('\n');
    }
  }
  if (rest.trim()) yield rest;
}
