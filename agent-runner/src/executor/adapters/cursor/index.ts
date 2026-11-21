import type { Adapter, ExecContext, ExecResult, ProbeResult } from '../../types';
import { execHome, ignoredLimitsWarning, jsonLine, readMcpServers, sharedHomeWarning, str } from '../shared';
import { assistantText, cursorActivity, cursorEvents, cursorTool, mcpRejected } from './events';
import { cursorEverRan, cursorHasSession, syncCursorPermissions, writeCursorMcp } from './session';

/**
 * Cursor CLI không giao diện (binary `agent`, tên cũ `cursor-agent`; kiểm với bản 2026.11.19 — `agent --help`, chạy thật bằng tài khoản
 * đã đăng nhập): `agent -p --output-format stream-json --trust --workspace <cwd> --approve-mcps [--model] [--resume <id>] -- <prompt>`
 * in NDJSON: `system/init` (phiên, model) → `thinking` / `assistant` / `tool_call` → `result` (`is_error`, `usage`).
 * - MCP: không có cờ truyền file → ghi `<HOME>/.cursor/mcp.json` trước khi chạy ({@link writeCursorMcp}); header `Bearer ${env:BIẾN}`
 *   được CLI thay theo env lúc chạy → token chỉ nằm trong biến môi trường.
 * - Quyền: không có `--force` thì lệnh shell VÀ tool MCP đều bị từ chối, CLI vẫn thoát 0 / `is_error: false`.
 *   Phiên có công cụ: `--force`. Phiên chỉ MCP (`noBuiltinTools`): không `--force`, quyền theo thư mục làm việc `<cwd>/.cursor/cli.json`
 *   cho `Mcp(<máy chủ>:*)`, cấm `Shell(*)` / `Write(**)` / `Read(**)` (đã thử: MCP chạy, ba loại kia bị chặn). Còn công cụ tìm tên file /
 *   web chưa kiểm hết → `caps.toolRestriction = false`, `doctor` cảnh báo.
 * - `init.model` là TÊN HIỂN THỊ ("Auto", "Composer 2.5"), không phải id cấu hình.
 * - `result.usage`: `inputTokens` KHÔNG gồm cache → runner cộng phần đọc / ghi cache vào tổng token vào. Không có chi phí USD, không có
 *   trần ngân sách / số vòng. Lỗi (model không dùng được, chưa đăng nhập…): thoát khác 0, KHÔNG có dòng `result`, lý do ở stderr.
 */
const MODEL_REFUSED = /Cannot use this model|Model unavailable/i;

/** Dòng đầu có nghĩa của stderr, cắt ngắn (danh sách model dài hàng nghìn ký tự). */
const firstLine = (text: string | undefined) =>
  (text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean)
    ?.slice(0, 240);

export function parseProbe(stdout: string, stderr?: string): ProbeResult {
  let model: string | undefined;
  let result: any;
  for (const line of stdout.split('\n')) {
    const m = jsonLine(line);
    if (m?.type === 'system' && m.subtype === 'init' && str(m.model)) model = m.model;
    if (m?.type === 'result') result = m;
  }
  if (result && !result.is_error) return { model };
  const error = firstLine(stderr) ?? (result ? str(result.result).slice(0, 240) : '') ?? '';
  return {
    model,
    error: error || 'CLI không trả sự kiện result',
    invalidModel: MODEL_REFUSED.test(stderr ?? ''),
  };
}

export const cursorAdapter: Adapter = {
  kind: 'cursor',
  caps: { resume: true, toolRestriction: false },
  configProblems(exec) {
    const has = (flag: string) => exec.extraArgs.some((x) => x === flag || x.startsWith(`${flag}=`));
    return [
      has('--api-key')
        ? 'extra_args có --api-key (lộ khoá trong tham số tiến trình) — đặt CURSOR_API_KEY trong env_file'
        : '',
      has('--mcp-config')
        ? 'extra_args có --mcp-config (cờ của Claude Code) — với cursor, khai MCP thêm trong <home>/.cursor/mcp.json'
        : '',
    ].filter(Boolean);
  },
  homeWarnings(exec, home) {
    const warnings: string[] = [];
    if (!exec.home)
      warnings.push(
        `${sharedHomeWarning(home)} — runner ghi máy chủ MCP của job vào ${home}/.cursor/mcp.json (các máy chủ khác trong file được giữ)`,
      );
    if (!cursorEverRan(home))
      warnings.push(
        `HOME ${home} chưa từng chạy Cursor CLI — đăng nhập một lần: \`HOME=${home} ${exec.bin} login\`, hoặc đặt CURSOR_API_KEY trong env_file`,
      );
    const limits = ignoredLimitsWarning(exec, 'cursor');
    if (limits) warnings.push(limits);
    return warnings;
  },
  command(ctx: ExecContext) {
    const e = ctx.exec;
    const servers = writeCursorMcp(execHome(e), readMcpServers(ctx.mcpConfigFile));
    syncCursorPermissions(ctx.cwd, servers, !!ctx.noBuiltinTools);
    const args = ['-p', '--output-format', 'stream-json', '--trust', '--workspace', ctx.cwd, '--approve-mcps'];
    if (e.model) args.push('--model', e.model);
    if (ctx.resumeSessionId) args.push('--resume', ctx.resumeSessionId);
    if (!ctx.noBuiltinTools) args.push('--force');
    args.push(...e.extraArgs, '--', ctx.prompt);
    return { bin: e.bin, args };
  },
  activity: cursorActivity,
  events: cursorEvents,
  parseLine(line, r: ExecResult) {
    const m = jsonLine(line);
    if (!m) return;
    if (m.type === 'system' && m.subtype === 'init') {
      if (str(m.session_id)) r.sessionId = m.session_id;
      if (str(m.model)) r.model = m.model;
    } else if (m.type === 'assistant') {
      // `result.result` ghép MỌI lời agent trong phiên → tóm tắt lấy lời cuối cùng
      const text = assistantText(m);
      if (text) r.summary = text;
    } else if (m.type === 'tool_call') {
      const t = cursorTool(line);
      if (!t?.done) return;
      r.turns = (r.turns ?? 0) + 1;
      // Tool MCP bị từ chối (không ai bấm duyệt) mà CLI vẫn báo thành công → đánh dấu để dòng `result` không thành thành công giả.
      if (mcpRejected(t)) r.errorKind = 'mcp_rejected';
    } else if (m.type === 'result') {
      if (str(m.session_id)) r.sessionId = m.session_id;
      if (!r.summary && str(m.result).trim()) r.summary = m.result.trim();
      const u = m.usage;
      if (u && typeof u === 'object') {
        const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
        r.inputTokens = num(u.inputTokens) + num(u.cacheReadTokens) + num(u.cacheWriteTokens);
        r.outputTokens = num(u.outputTokens);
        if (typeof u.cacheReadTokens === 'number') r.cacheReadTokens = u.cacheReadTokens;
        if (typeof u.cacheWriteTokens === 'number') r.cacheWriteTokens = u.cacheWriteTokens;
      }
      r.turns = (r.turns ?? 0) + 1; // lượt trả lời cuối; mỗi lần gọi công cụ đã cộng ở trên
      if (m.is_error === true) {
        r.isError = true;
        r.errorKind = str(m.subtype) || 'error';
      } else if (r.errorKind === 'mcp_rejected') {
        r.isError = true;
        r.summary = `CLI từ chối tool MCP vì không có người bấm duyệt (thiếu luật quyền). ${r.summary ?? ''}`.trim();
      } else r.isError = false;
    }
  },
  probe(exec) {
    return {
      bin: exec.bin,
      args: [
        '-p',
        '--output-format',
        'stream-json',
        '--trust',
        '--mode',
        'ask',
        ...(exec.model ? ['--model', exec.model] : []),
        '--',
        'ok',
      ],
    };
  },
  parseProbe,
  hasSession: cursorHasSession,
};
