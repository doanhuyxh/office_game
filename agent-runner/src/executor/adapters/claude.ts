import type { Adapter, ExecContext } from '../types';

/**
 * Claude Code CLI không giao diện (kiểm với 2.1.x: `claude --help`):
 * -p + stream-json (--verbose bắt buộc với stream-json) · MCP chỉ từ file của job (--strict-mcp-config) · chỉ nạp setting của user
 * (--setting-sources user: bỏ hook / quyền trong .claude/settings.json của repo — agent sửa được file đó) · bypassPermissions (chạy không hỏi;
 * CLI từ chối khi chạy bằng root → runner phải chạy bằng user thường) · --max-budget-usd · --resume khi việc bị trả về.
 * CLAUDE.md / AGENTS.md của repo vẫn được đọc (hướng dẫn dự án).
 */
const clip = (t: string, n = 200) => { const one = t.replace(/\s+/g, ' ').trim(); return one.length > n ? one.slice(0, n) + '…' : one; };

/** Một khối trong message `assistant` của stream-json → câu tiếng Việt ngắn mô tả việc agent đang làm. */
export function describeBlock(b: any, cwd: string): string | undefined {
  if (b?.type === 'text') return typeof b.text === 'string' && b.text.trim() ? `Nói: ${clip(b.text)}` : undefined;
  if (b?.type !== 'tool_use') return undefined;
  const i = b.input ?? {};
  const file = typeof i.file_path === 'string' ? (i.file_path.startsWith(cwd + '/') ? i.file_path.slice(cwd.length + 1) : i.file_path) : '';
  switch (b.name) {
    case 'Read': return `Đọc ${file}`;
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return `Sửa ${file || i.notebook_path}`;
    case 'Write': return `Ghi ${file}`;
    case 'Bash': return `Chạy: ${clip(String(i.command ?? ''))}`;
    case 'Grep': case 'Glob': return `Tìm: ${clip(String(i.pattern ?? ''), 100)}`;
    case 'TodoWrite': return 'Cập nhật danh sách việc cần làm';
    case 'Task': case 'Agent': return `Giao việc phụ: ${clip(String(i.description ?? ''), 100)}`;
    default: {
      const mcp = /^mcp__officehub__(.+)$/.exec(String(b.name));
      if (mcp) return `OfficeHub ${mcp[1]}${i.status ? ` → ${i.status}` : ''}`;
      return `Dùng ${b.name}`;
    }
  }
}

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
  activity(line, cwd) {
    if (!line.startsWith('{')) return [];
    let m: any;
    try { m = JSON.parse(line); } catch { return []; }
    if (m?.type !== 'assistant' || !Array.isArray(m.message?.content)) return [];
    return m.message.content.map((b: any) => describeBlock(b, cwd)).filter((x: string | undefined): x is string => !!x);
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
