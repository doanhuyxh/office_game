import { mainModel, readModelUsage } from '../model';
import type { Adapter, ExecContext, ProbeResult } from '../types';

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

/** Lệnh chạy thử model (TEST-64): không tool, không MCP, system prompt ngắn → vài trăm token. */
export function probeArgs(model: string | undefined): string[] {
  const args = ['-p', 'ok', '--output-format', 'stream-json', '--verbose', '--max-turns', '1', '--strict-mcp-config', '--setting-sources', 'user',
    '--tools', '', '--system-prompt', 'Reply with: ok'];
  if (model) args.push('--model', model);
  return args;
}

/**
 * Đọc stdout của lệnh chạy thử: model thật = model chính trong `modelUsage` của `result` (init chỉ lặp lại tên được yêu cầu).
 * Model sai: CLI 2.1.x trả `result` is_error + `api_error_status: 404` ("There's an issue with the selected model …").
 */
export function parseProbe(stdout: string): ProbeResult {
  let init: string | undefined, res: any;
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('{')) continue;
    let m: any;
    try { m = JSON.parse(line); } catch { continue; }
    if (m?.type === 'system' && m.subtype === 'init' && typeof m.model === 'string') init = m.model;
    if (m?.type === 'result') res = m;
  }
  if (!res) return { model: init, error: 'CLI không trả sự kiện result' };
  const model = mainModel(init, readModelUsage(res.modelUsage));
  if (res.is_error !== true && res.subtype === 'success') return { model };
  const text = typeof res.result === 'string' ? res.result.replace(/\s+/g, ' ').slice(0, 200) : String(res.subtype ?? 'lỗi');
  const invalidModel = res.api_error_status === 404 || /selected model|model.*(not exist|not found|access)/i.test(text);
  return { model: invalidModel ? undefined : model, error: text, invalidModel };
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
    if (ctx.noBuiltinTools) args.push('--tools', ''); // chỉ tool MCP (CLI 2.1.x: --tools "" = tắt mọi tool có sẵn)
    args.push(...e.extraArgs);
    return { bin: e.bin, args };
  },
  activity(line, cwd) {
    if (!line.startsWith('{')) return [];
    let m: any;
    try { m = JSON.parse(line); } catch { return []; }
    if (m?.type === 'system' && m.subtype === 'init' && typeof m.model === 'string') return [`Model ${m.model}`];
    if (m?.type !== 'assistant' || !Array.isArray(m.message?.content)) return [];
    return m.message.content.map((b: any) => describeBlock(b, cwd)).filter((x: string | undefined): x is string => !!x);
  },
  parseLine(line, r) {
    let m: any;
    try { m = JSON.parse(line); } catch { return; }
    if (m?.session_id && !r.sessionId) r.sessionId = m.session_id;
    if (m?.type === 'system' && m.subtype === 'init' && typeof m.model === 'string') r.model = m.model;
    if (m?.type !== 'result') return;
    const usage = readModelUsage(m.modelUsage);
    if (usage) { r.modelUsage = usage; r.model = mainModel(r.model, usage); }
    r.sessionId = m.session_id ?? r.sessionId;
    if (typeof m.total_cost_usd === 'number') r.costUsd = m.total_cost_usd;
    if (typeof m.num_turns === 'number') r.turns = m.num_turns;
    const u = m.usage ?? {};
    const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    if (input) r.inputTokens = input;
    if (typeof u.output_tokens === 'number') r.outputTokens = u.output_tokens;
    if (typeof m.result === 'string') r.summary = m.result;
    r.isError = m.is_error === true || (typeof m.subtype === 'string' && m.subtype !== 'success');
    // Lỗi API (vd model sai: subtype vẫn là success, terminal_reason api_error, api_error_status 404).
    if (r.isError) r.errorKind = typeof m.api_error_status === 'number' ? `${m.terminal_reason ?? 'api_error'} ${m.api_error_status}` : m.subtype;
  },
  probe(exec) { return { bin: exec.bin, args: probeArgs(exec.model) }; },
  parseProbe,
};
