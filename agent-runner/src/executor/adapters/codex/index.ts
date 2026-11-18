import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Adapter, ExecContext, ExecResult } from '../../types';
import { jsonLine, readMcpServers, sharedHomeWarning, str } from '../shared';
import { codexActivity, codexEvents } from './events';
import { codexHasSession, codexSessionModel } from './session';

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
const toml = (v: string) => JSON.stringify(v);

/** MCP của job → các cặp `-c mcp_servers.…` (giá trị TOML). */
export function codexMcpArgs(mcpConfigFile: string): string[] {
  return readMcpServers(mcpConfigFile).flatMap((s) => {
    const at = `mcp_servers.${s.name}`;
    return [
      '-c',
      `${at}.url=${toml(s.url)}`,
      ...(s.bearerEnv ? ['-c', `${at}.bearer_token_env_var=${toml(s.bearerEnv)}`] : []),
      '-c',
      `${at}.default_tools_approval_mode="approve"`,
    ];
  });
}

const TOOL_ITEMS = new Set(['command_execution', 'mcp_tool_call', 'file_change', 'web_search']);

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
    if (!exec.home) warnings.push(sharedHomeWarning(home));
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
  activity: codexActivity,
  events: codexEvents,
  parseLine(line, r: ExecResult) {
    const m = jsonLine(line);
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
