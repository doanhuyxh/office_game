import type { Adapter, ExecContext } from '../types';

/** Thay {cwd} {model} {mcp_config} {prompt_file} {session_id} trong tham số. */
export function fillArgs(template: string[], ctx: ExecContext): string[] {
  const vars: Record<string, string> = {
    cwd: ctx.cwd, model: ctx.exec.model ?? '', mcp_config: ctx.mcpConfigFile, prompt_file: ctx.promptFile, session_id: ctx.resumeSessionId ?? '',
  };
  return template.map((a) => a.replace(/\{(cwd|model|mcp_config|prompt_file|session_id)\}/g, (_, k: string) => vars[k]!));
}

/**
 * CLI tự khai báo (`executor.args`, `resume_args`). output.format = json → đọc dòng JSON cuối có `session_id`, `cost_usd`, `summary`,
 * `input_tokens`, `output_tokens`, `is_error`, `model` (không có → model cấu hình, ghi "(cấu hình)"); text → 2000 ký tự cuối làm tóm tắt.
 */
export const customAdapter: Adapter = {
  kind: 'custom',
  caps: { resume: true, cost: true, budget: false },
  command(ctx) {
    const e = ctx.exec;
    const args = fillArgs(e.args ?? [], ctx);
    if (ctx.resumeSessionId && e.resumeArgs) args.push(...fillArgs(e.resumeArgs, ctx));
    args.push(...e.extraArgs);
    return { bin: e.bin, args };
  },
  parseLine(line, r) {
    const t = line.trim();
    if (!t.startsWith('{')) return;
    let m: any;
    try { m = JSON.parse(t); } catch { return; }
    if (typeof m.session_id === 'string') r.sessionId = m.session_id;
    if (typeof m.cost_usd === 'number') r.costUsd = m.cost_usd;
    if (typeof m.input_tokens === 'number') r.inputTokens = m.input_tokens;
    if (typeof m.output_tokens === 'number') r.outputTokens = m.output_tokens;
    if (typeof m.summary === 'string') r.summary = m.summary;
    if (typeof m.model === 'string' && m.model.trim()) r.model = m.model.trim();
    if (typeof m.is_error === 'boolean') r.isError = m.is_error;
  },
  finish(tail, r) {
    if (!r.summary && tail.trim()) r.summary = tail.trim().slice(-2000);
  },
};
