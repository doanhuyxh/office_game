import type { Adapter, ExecContext, ExecResult, ProbeResult } from '../../types';
import { execHome, ignoredLimitsWarning, jsonLine, readMcpServers, sharedHomeWarning, str } from '../shared';
import { antigravityActivity, antigravityEvents } from './events';
import { antigravityEverRan, antigravityHasSession, writeAntigravityMcp } from './session';

/**
 * Google Antigravity CLI không giao diện (`agy`, kiểm với 1.5.14 — `agy --help`, chạy thật với tài khoản đã đăng nhập):
 * `agy -p <prompt> --output-format stream-json [--model] [--conversation <id>]` in NDJSON: `init` (model thật, `conversation_id`) →
 * `step_update` (từng bước: lời agent, công cụ, token) → `result` (trạng thái, câu trả lời, `denied_actions`).
 * - MCP: không có cờ khai → ghi `<HOME>/.gemini/config/mcp_config.json` trước khi chạy ({@link writeAntigravityMcp}); header HTTP không
 *   thay được biến môi trường nên máy chủ khai kiểu stdio qua cầu nối `mcp-bridge` của runner — token chỉ nằm trong env.
 * - Quyền: chế độ headless không hỏi được người → thao tác cần duyệt bị TỪ CHỐI nhưng CLI vẫn thoát 0, `status: SUCCESS`
 *   (chỉ ghi stderr + `result.denied_actions`). Phiên có công cụ: `--dangerously-skip-permissions`. Phiên chỉ MCP (`noBuiltinTools`):
 *   không cờ đó, `--sandbox` + `--settings` cho phép `mcp(<máy chủ>/*)` và cấm `command(*)` — lệnh bị chặn (đã thử), nhưng công cụ
 *   ghi file trong thư mục làm việc vẫn chạy → `caps.toolRestriction = false`, `doctor` cảnh báo.
 * - Token: mỗi bước `agent_response` có `usage`; `input_tokens` KHÔNG gồm phần đọc cache (runner quy ước tổng token vào gồm cache → cộng lại).
 *   `result.usage` / `num_turns` là số LUỸ KẾ của cả hội thoại (sai khi nối phiên) → chỉ dùng khi không có số theo bước.
 * - Không có chi phí USD, không có trần ngân sách / số vòng — chỉ `timeout_min`.
 */

/** Luật quyền cho phiên: cho phép tool của các máy chủ MCP của job; phiên chỉ MCP thì cấm chạy lệnh. */
export function antigravitySettings(servers: string[], noBuiltinTools: boolean): string {
  return JSON.stringify({
    permissions: {
      allow: servers.map((name) => `mcp(${name}/*)`),
      ...(noBuiltinTools ? { deny: ['command(*)'] } : {}),
    },
  });
}

/** Một bước tính là "lượt" khi công cụ đã chạy xong (kể cả lỗi) — gần với `num_turns` của claude. */
const toolFinished = (u: any) => u?.step_type === 'tool' && (u.state === 'DONE' || u.state === 'ERROR');

const INVALID_MODEL = /invalid model selection|not recognized as a known model/i;

export function parseProbe(stdout: string): ProbeResult {
  let model: string | undefined;
  let result: any;
  for (const line of stdout.split('\n')) {
    const m = jsonLine(line);
    if (m?.event === 'init' && str(m.init?.model)) model = m.init.model;
    if (m?.event === 'result') result = m.result;
  }
  if (!result) return { model, error: 'CLI không trả sự kiện result' };
  if (result.status !== 'SUCCESS') {
    const error = str(result.error).split('\n')[0] || `trạng thái ${str(result.status) || 'không rõ'}`;
    return { model, error, invalidModel: INVALID_MODEL.test(str(result.error)) };
  }
  return { model };
}

export const antigravityAdapter: Adapter = {
  kind: 'antigravity',
  caps: { resume: true, toolRestriction: false },
  // `--mcp-config` là cờ của Claude Code; `agy` không có cờ khai MCP.
  configProblems: (exec) =>
    exec.extraArgs.some((x) => x === '--mcp-config' || x.startsWith('--mcp-config='))
      ? [
          'extra_args có --mcp-config (cờ của Claude Code) — với antigravity, khai MCP thêm bằng `agy mcp add` trong HOME của agent',
        ]
      : [],
  homeWarnings(exec, home) {
    const warnings: string[] = [];
    if (!exec.home)
      warnings.push(
        `${sharedHomeWarning(home)} — runner ghi máy chủ MCP của job vào ${home}/.gemini/config/mcp_config.json (các máy chủ khác trong file được giữ)`,
      );
    if (!antigravityEverRan(home))
      warnings.push(
        `HOME ${home} chưa từng chạy agy — đăng nhập một lần: \`HOME=${home} ${exec.bin}\` (CLI mở trang đăng nhập)`,
      );
    const limits = ignoredLimitsWarning(exec, 'antigravity');
    if (limits) warnings.push(limits);
    return warnings;
  },
  command(ctx: ExecContext) {
    const e = ctx.exec;
    const servers = writeAntigravityMcp(execHome(e), readMcpServers(ctx.mcpConfigFile));
    const args = ['--output-format', 'stream-json', '--settings', antigravitySettings(servers, !!ctx.noBuiltinTools)];
    if (e.model) args.push('--model', e.model);
    if (ctx.resumeSessionId) args.push('--conversation', ctx.resumeSessionId);
    if (ctx.noBuiltinTools) args.push('--sandbox');
    else args.push('--dangerously-skip-permissions');
    // `-p <prompt>` đặt cuối: giá trị của cờ nên prompt bắt đầu bằng "-" cũng không bị hiểu thành cờ.
    args.push(...e.extraArgs, '-p', ctx.prompt);
    return { bin: e.bin, args };
  },
  activity: antigravityActivity,
  events: antigravityEvents,
  parseLine(line, r: ExecResult) {
    const m = jsonLine(line);
    if (!m) return;
    if (m.event === 'init') {
      if (str(m.conversation_id)) r.sessionId = m.conversation_id;
      if (str(m.init?.model)) r.model = m.init.model;
    } else if (m.event === 'step_update') {
      const u = m.step_update;
      if (toolFinished(u)) r.turns = (r.turns ?? 0) + 1;
      const usage = u?.usage;
      if (usage && u.state === 'DONE') addUsage(r, usage);
    } else if (m.event === 'result') {
      const res = m.result ?? {};
      if (str(res.conversation_id)) r.sessionId = res.conversation_id;
      if (str(res.response).trim()) r.summary = res.response.trim();
      // Không có số theo bước (bản CLI khác) → dùng số của `result` (luỹ kế cả hội thoại — lệch khi nối phiên).
      if (r.inputTokens === undefined && res.usage) addUsage(r, res.usage);
      r.turns = (r.turns ?? 0) + 1; // lượt trả lời cuối; mỗi lần gọi công cụ đã cộng ở trên
      const denied = Array.isArray(res.denied_actions) ? res.denied_actions : [];
      if (res.status !== 'SUCCESS') {
        r.isError = true;
        r.errorKind = str(res.status) || 'ERROR';
        r.summary = str(res.error).split('\n')[0] || r.summary;
      } else if (denied.length) {
        // Headless không hỏi được người → thao tác bị từ chối mà CLI vẫn thoát 0 / SUCCESS: không báo thành công giả.
        const names = [...new Set(denied.map((d: any) => str(d?.action) || str(d?.display_name)).filter(Boolean))];
        r.isError = true;
        r.errorKind = 'denied_actions';
        r.summary =
          `CLI từ chối thao tác cần duyệt (${names.join(', ') || 'không rõ'}) vì không có người bấm duyệt. ${r.summary ?? ''}`.trim();
      } else r.isError = false;
    }
  },
  probe(exec) {
    return {
      bin: exec.bin,
      args: ['--output-format', 'stream-json', ...(exec.model ? ['--model', exec.model] : []), '-p', 'ok'],
    };
  },
  parseProbe,
  hasSession: antigravityHasSession,
};

/** Cộng token của một bước: tổng token vào của runner gồm cả phần đọc cache. */
function addUsage(r: ExecResult, usage: any) {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const cacheRead = num(usage.cache_read_tokens);
  r.inputTokens = (r.inputTokens ?? 0) + num(usage.input_tokens) + cacheRead;
  r.outputTokens = (r.outputTokens ?? 0) + num(usage.output_tokens) + num(usage.thinking_tokens);
  if (typeof usage.cache_read_tokens === 'number') r.cacheReadTokens = (r.cacheReadTokens ?? 0) + cacheRead;
}
