import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ActivityEvent, HIDDEN_OUTPUT, displayPath, isSensitiveCommand, oneLine, sanitize } from '../events';
import type { Adapter, ExecContext, ExecResult } from '../types';

/**
 * OpenAI Codex CLI không giao diện (kiểm với 0.170: `codex exec --help`, `codex exec resume --help`):
 * `exec --json` in sự kiện JSONL · prompt là tham số cuối (sau `--`) · nối phiên bằng `exec resume <thread_id>`.
 * Mọi tuỳ chọn đi qua `-c key=value` (giá trị TOML) vì `exec resume` không có `--sandbox` / `--cd`:
 * - MCP của job: đọc file `mcpServers` runner ghi, đổi thành `mcp_servers.<tên>.url` + `bearer_token_env_var` (token vẫn chỉ nằm trong env).
 *   MCP thêm (vd Stitch) khai trong `<HOME>/.codex/config.toml` của agent — `--mcp-config` của Claude Code không dùng được ở đây.
 * - `default_tools_approval_mode = "approve"`: phiên không có người bấm duyệt tool MCP.
 * - Phiên có công cụ: `--dangerously-bypass-approvals-and-sandbox` (như bypassPermissions của claude — cần git, mạng, build).
 *   Phiên chỉ MCP (`noBuiltinTools`): sandbox `read-only` — Codex KHÔNG tắt hẳn được shell, lệnh vẫn chạy nhưng không ghi file / ra mạng
 *   → `caps.toolRestriction = false`, `doctor` cảnh báo.
 * Codex không báo chi phí USD; model thật không có trong `--json` → `finish` đọc từ file phiên (`turn_context`); không có trần ngân sách / số vòng.
 */
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const toml = (v: string) => JSON.stringify(v);

/** File `mcpServers` của job → các cặp `-c mcp_servers.…`. Header `Authorization: Bearer ${BIẾN}` → `bearer_token_env_var`. */
export function codexMcpArgs(mcpConfigFile: string): string[] {
  let servers: Record<string, any> = {};
  try {
    servers = JSON.parse(readFileSync(mcpConfigFile, 'utf8'))?.mcpServers ?? {};
  } catch {
    /* không đọc được → không có MCP của job; phiên sẽ lỗi rõ khi gọi tool */
  }
  const args: string[] = [];
  for (const [name, s] of Object.entries(servers)) {
    if (!/^[A-Za-z0-9_-]+$/.test(name) || typeof s?.url !== 'string') continue;
    const at = `mcp_servers.${name}`;
    args.push('-c', `${at}.url=${toml(s.url)}`);
    const bearer = /^Bearer \$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(str(s.headers?.Authorization));
    if (bearer) args.push('-c', `${at}.bearer_token_env_var=${toml(bearer[1]!)}`);
    args.push('-c', `${at}.default_tools_approval_mode="approve"`);
  }
  return args;
}

/** File `rollout-…-<id>.jsonl` của phiên trong `<HOME>/.codex/sessions/<năm>/<tháng>/<ngày>/` (tên có ngày giờ nên phải dò). */
export function codexSessionFile(home: string, sessionId: string): string | undefined {
  const walk = (dir: string, depth: number): string | undefined => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const e of entries) {
      const path = join(dir, e.name);
      if (!e.isDirectory()) {
        if (e.name.endsWith(`-${sessionId}.jsonl`)) return path;
      } else if (depth < 3) {
        const found = walk(path, depth + 1);
        if (found) return found;
      }
    }
    return undefined;
  };
  return walk(join(home, '.codex', 'sessions'), 0);
}

export const codexHasSession = (home: string, _cwd: string, sessionId: string) => !!codexSessionFile(home, sessionId);

/** Model thật của lượt cuối: dòng `turn_context` cuối cùng trong file phiên (`--json` không báo model). Không đọc được → undefined. */
export function codexSessionModel(home: string, sessionId: string): string | undefined {
  const file = codexSessionFile(home, sessionId);
  if (!file) return undefined;
  let model: string | undefined;
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes('"type":"turn_context"')) continue;
      const m = /"model":"([^"\\]+)"/.exec(line);
      if (m) model = m[1];
    }
  } catch {
    /* file bị xoá giữa chừng */
  }
  return model;
}

const TOOL_ITEMS = new Set(['command_execution', 'mcp_tool_call', 'file_change', 'web_search']);

const parse = (line: string): any => {
  if (!line.startsWith('{')) return undefined;
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
};

const changedPaths = (item: any, cwd: string): string[] =>
  (Array.isArray(item?.changes) ? item.changes : []).map((c: any) => displayPath(str(c?.path), cwd)).filter(Boolean);

const mcpTitle = (item: any) =>
  item?.server === 'officehub' ? `OfficeHub ${str(item.tool)}` : `Dùng ${str(item?.server)}.${str(item?.tool)}`;

/**
 * Sự kiện `--json` của Codex → sự kiện xem trực tiếp. `item.started` mở sự kiện, `item.completed` cùng `item.id` cập nhật kết quả.
 * Lệnh → `command` (+ phần cuối output, ẩn khi đụng file / biến bí mật); `file_change` → `file_edit` (chỉ đường dẫn — Codex không gửi diff);
 * `mcp_tool_call` → `tool` (chỉ tên); `reasoning` → `thinking`; `agent_message` → `say`.
 */
export function codexEvents(cwd: string): (line: string) => ActivityEvent[] {
  let seq = 0;
  return (line) => {
    const m = parse(line);
    const item = m?.item;
    if (!item || (m.type !== 'item.started' && m.type !== 'item.completed')) return [];
    const done = m.type === 'item.completed';
    const id = str(item.id) || `item-${++seq}`;
    const out: ActivityEvent[] = [];
    switch (item.type) {
      case 'command_execution': {
        const command = str(item.command);
        const e: ActivityEvent = { id, kind: 'command', title: 'Chạy lệnh', text: command };
        if (done) {
          e.ok = item.exit_code === 0;
          if (isSensitiveCommand(command)) e.output = HIDDEN_OUTPUT;
          else if (str(item.aggregated_output)) e.output = str(item.aggregated_output);
        }
        out.push(e);
        break;
      }
      case 'file_change':
        if (done)
          changedPaths(item, cwd).forEach((path, i) =>
            out.push({ id: `${id}-${i}`, kind: 'file_edit', title: `Sửa ${path}`, path, ok: item.status !== 'failed' }),
          );
        break;
      case 'mcp_tool_call':
        out.push({ id, kind: 'tool', title: mcpTitle(item), ...(done ? { ok: item.status !== 'failed' } : {}) });
        break;
      case 'web_search':
        if (done) out.push({ id, kind: 'search', title: 'Tìm trên web', text: str(item.query) });
        break;
      case 'reasoning':
        if (done && str(item.text).trim())
          out.push({ id, kind: 'thinking', title: 'Suy nghĩ', text: str(item.text).trim() });
        break;
      case 'agent_message':
        if (done && str(item.text).trim()) out.push({ id, kind: 'say', title: 'Nói', text: str(item.text).trim() });
        break;
    }
    return out.map(sanitize);
  };
}

export const codexAdapter: Adapter = {
  kind: 'codex',
  caps: { resume: true, toolRestriction: false },
  // `--mcp-config` là cờ của Claude Code: Codex thoát ngay với "unexpected argument" → chặn từ lúc đọc cấu hình.
  configProblems: (exec) =>
    exec.extraArgs.some((x) => x === '--mcp-config' || x.startsWith('--mcp-config='))
      ? ['extra_args có --mcp-config (cờ của Claude Code) — với codex, khai MCP thêm trong <home>/.codex/config.toml']
      : [],
  homeWarnings(exec, home) {
    const warnings: string[] = [];
    if (!exec.home)
      warnings.push(`chưa đặt executor.home — CLI dùng HOME của runner (${home}); nên dùng HOME riêng, sạch cho agent`);
    if (!existsSync(join(home, '.codex', 'auth.json')))
      warnings.push(
        `HOME ${home} chưa có .codex/auth.json — chạy \`codex login\` với HOME đó, hoặc đặt CODEX_API_KEY trong env_file`,
      );
    const ignored = [
      exec.maxBudgetUsd !== undefined || exec.light?.maxBudgetUsd !== undefined ? 'max_budget_usd' : '',
      exec.maxTurns !== undefined || exec.light?.maxTurns !== undefined ? 'max_turns' : '',
    ].filter(Boolean);
    if (ignored.length)
      warnings.push(
        `${ignored.join(', ')} không có tác dụng với codex (CLI không có trần này) — chỉ timeout_min chặn phiên`,
      );
    return warnings;
  },
  command(ctx: ExecContext) {
    const e = ctx.exec;
    const args = ['exec'];
    if (ctx.resumeSessionId) args.push('resume');
    args.push('--json', '--skip-git-repo-check', ...codexMcpArgs(ctx.mcpConfigFile));
    if (e.model) args.push('-m', e.model);
    if (ctx.noBuiltinTools) args.push('-c', 'sandbox_mode="read-only"', '-c', 'approval_policy="never"');
    else args.push('--dangerously-bypass-approvals-and-sandbox');
    args.push(...e.extraArgs, '--');
    if (ctx.resumeSessionId) args.push(ctx.resumeSessionId);
    args.push(ctx.prompt);
    return { bin: e.bin, args };
  },
  activity(line, cwd) {
    const m = parse(line);
    const item = m?.item;
    if (!item) return [];
    if (m.type === 'item.started' && item.type === 'command_execution')
      return [`Chạy: ${oneLine(str(item.command), 200)}`];
    if (m.type === 'item.started' && item.type === 'mcp_tool_call') return [mcpTitle(item)];
    if (m.type !== 'item.completed') return [];
    if (item.type === 'file_change') return changedPaths(item, cwd).map((p) => `Sửa ${p}`);
    if (item.type === 'agent_message' && str(item.text).trim()) return [`Nói: ${oneLine(str(item.text), 200)}`];
    return [];
  },
  events: codexEvents,
  parseLine(line, r: ExecResult) {
    const m = parse(line);
    if (!m) return;
    if (m.type === 'thread.started' && typeof m.thread_id === 'string') r.sessionId = m.thread_id;
    else if (m.type === 'item.completed' && m.item?.type === 'agent_message' && str(m.item.text))
      r.summary = m.item.text; // lời cuối cùng của agent = tóm tắt
    else if (m.type === 'item.completed' && TOOL_ITEMS.has(m.item?.type)) r.turns = (r.turns ?? 0) + 1;
    else if (m.type === 'turn.completed') {
      const u = m.usage ?? {};
      // input_tokens của OpenAI đã gồm phần đọc cache (cached_input_tokens) — khớp quy ước "tổng token vào" của runner.
      if (typeof u.input_tokens === 'number') r.inputTokens = (r.inputTokens ?? 0) + u.input_tokens;
      if (typeof u.cached_input_tokens === 'number')
        r.cacheReadTokens = (r.cacheReadTokens ?? 0) + u.cached_input_tokens;
      if (typeof u.output_tokens === 'number') r.outputTokens = (r.outputTokens ?? 0) + u.output_tokens;
      r.turns = (r.turns ?? 0) + 1; // lượt trả lời cuối; mỗi lần gọi công cụ đã cộng ở trên (gần với num_turns của claude)
      r.isError = false;
    } else if (m.type === 'turn.failed') {
      // Dòng `{"type":"error"}` lẻ là báo thử lại ("Reconnecting… 2/5"), chỉ `turn.failed` mới là hỏng thật.
      r.isError = true;
      r.errorKind = 'turn_failed';
      r.summary = str(m.error?.message) || r.summary;
    }
  },
  hasSession: codexHasSession,
  finish(_tail, r, home) {
    if (!r.model && r.sessionId && home) r.model = codexSessionModel(home, r.sessionId);
  },
};
