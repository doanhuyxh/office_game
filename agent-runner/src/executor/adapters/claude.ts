import type { Adapter, ExecContext } from '../types';

/**
 * Claude Code CLI không giao diện (kiểm với 2.1.x: `claude --help`):
 * -p + stream-json (--verbose bắt buộc với stream-json) · MCP chỉ từ file của job (--strict-mcp-config) · chỉ nạp setting của user
 * (--setting-sources user: bỏ hook / quyền trong .claude/settings.json của repo — agent sửa được file đó) · bypassPermissions (chạy không hỏi;
 * CLI từ chối khi chạy bằng root → runner phải chạy bằng user thường) · --max-budget-usd · --resume khi việc bị trả về.
 * CLAUDE.md / AGENTS.md của repo vẫn được đọc (hướng dẫn dự án).
 */
export const claudeAdapter: Adapter = {
  kind: 'claude',
  caps: { resume: true, cost: true, budget: true },
  command(ctx: ExecContext) {
    const e = ctx.exec;
    const args = ['-p', ctx.prompt, '--output-format', 'stream-json', '--verbose',
      '--mcp-config', ctx.mcpConfigFile, '--strict-mcp-config', '--setting-sources', 'user', '--permission-mode', 'bypassPermissions'];
    if (e.model) args.push('--model', e.model);
    if (e.maxBudgetUsd !== undefined) args.push('--max-budget-usd', String(e.maxBudgetUsd));
    if (ctx.resumeSessionId) args.push('--resume', ctx.resumeSessionId);
    args.push(...e.extraArgs);
    return { bin: e.bin, args };
  },
  parseLine(line, r) {
    let m: any;
    try { m = JSON.parse(line); } catch { return; }
    if (m?.session_id && !r.sessionId) r.sessionId = m.session_id;
    if (m?.type !== 'result') return;
    r.sessionId = m.session_id ?? r.sessionId;
    if (typeof m.total_cost_usd === 'number') r.costUsd = m.total_cost_usd;
    if (typeof m.num_turns === 'number') r.turns = m.num_turns;
    const u = m.usage ?? {};
    const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    if (input) r.inputTokens = input;
    if (typeof u.output_tokens === 'number') r.outputTokens = u.output_tokens;
    if (typeof m.result === 'string') r.summary = m.result;
    r.isError = m.is_error === true || (typeof m.subtype === 'string' && m.subtype !== 'success');
    if (r.isError) r.errorKind = m.subtype;
  },
};
