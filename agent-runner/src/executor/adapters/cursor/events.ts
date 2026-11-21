import { type ActivityEvent, displayPath, HIDDEN_OUTPUT, isSensitiveCommand, oneLine, sanitize } from '../../events';
import { jsonLine, str } from '../shared';

/** Một `tool_call` của Cursor: `{ <tên>ToolCall: { args, result } }` — `result` chỉ có ở `subtype: completed`. */
export interface CursorTool {
  /** Tên bỏ hậu tố `ToolCall`: shell, edit, read, glob, grep, mcp, getMcpTools… */
  name: string;
  args: Record<string, unknown>;
  /** Kết quả: `{ success }` | `{ error }` | `{ rejected }` | `{ permissionDenied }` | `{ writePermissionDenied }`; chưa xong → undefined. */
  result?: Record<string, any>;
  id: string;
  done: boolean;
}

/** Dòng `tool_call` → công cụ; dòng khác → undefined. */
export function cursorTool(line: string): CursorTool | undefined {
  const m = jsonLine(line);
  if (m?.type !== 'tool_call' || !m.tool_call || typeof m.tool_call !== 'object') return undefined;
  const key = Object.keys(m.tool_call).find((k) => k.endsWith('ToolCall'));
  if (!key) return undefined;
  const call = m.tool_call[key] ?? {};
  return {
    name: key.slice(0, -'ToolCall'.length),
    args: call.args && typeof call.args === 'object' ? call.args : {},
    result: call.result && typeof call.result === 'object' ? call.result : undefined,
    // call_id có ký tự xuống dòng → chỉ giữ chữ / số / gạch làm id sự kiện
    id: `tool-${str(m.call_id)
      .replace(/[^A-Za-z0-9_-]/g, '')
      .slice(0, 56)}`,
    done: m.subtype === 'completed',
  };
}

/** Tool MCP bị từ chối vì không có người bấm duyệt (thiếu luật `Mcp(…)` / `--force`). */
export const mcpRejected = (t: CursorTool) => t.name === 'mcp' && t.done && !!t.result && !t.result.success;

const SEARCH_TOOLS = new Set(['glob', 'grep', 'semSearch', 'webSearch', 'ls']);
/** Công cụ nội bộ không đáng hiện (đọc mô tả tool MCP trước khi gọi). */
const SILENT_TOOLS = new Set(['getMcpTools']);

const mcpTitle = (t: CursorTool) => {
  const server = str(t.args.providerIdentifier) || str(t.args.serverIdentifier);
  const tool = str(t.args.toolName) || str(t.args.name);
  return server === 'officehub' ? `OfficeHub ${tool}` : `Dùng ${server}.${tool}`;
};

/**
 * Sự kiện `--output-format stream-json` của Cursor CLI → sự kiện xem trực tiếp. `tool_call started` mở sự kiện, `completed` cùng `call_id`
 * cập nhật kết quả. `shell` → `command` (+ output, ẩn khi lệnh đụng file / biến bí mật); `edit` / `read` → chỉ đường dẫn (không gửi nội
 * dung file hay diff); `mcp` → `tool` (chỉ tên, không tham số); `thinking` gom các `delta` → `thinking`; `assistant` → `say`.
 */
export function cursorEvents(cwd: string): (line: string) => ActivityEvent[] {
  let seq = 0;
  let thinking = '';
  return (line) => {
    const m = jsonLine(line);
    if (!m) return [];
    if (m.type === 'thinking') {
      if (m.subtype === 'delta') {
        thinking += str(m.text);
        return [];
      }
      const text = thinking.trim();
      thinking = '';
      return text ? [sanitize({ id: `think-${++seq}`, kind: 'thinking', title: 'Suy nghĩ', text })] : [];
    }
    if (m.type === 'assistant') {
      const text = assistantText(m);
      return text ? [sanitize({ id: `say-${++seq}`, kind: 'say', title: 'Nói', text })] : [];
    }
    const t = cursorTool(line);
    if (!t || SILENT_TOOLS.has(t.name)) return [];
    const done = t.done ? { ok: !!t.result?.success } : {};
    const path = displayPath(str(t.args.path), cwd);
    let e: ActivityEvent;
    if (t.name === 'shell') {
      const command = str(t.args.command);
      e = { id: t.id, kind: 'command', title: 'Chạy lệnh', text: command };
      if (t.done) {
        const ok = t.result?.success;
        e.ok = !!ok && ok.exitCode === 0;
        const output = str(ok?.interleavedOutput) || str(ok?.stdout) || str(ok?.stderr);
        if (isSensitiveCommand(command)) e.output = HIDDEN_OUTPUT;
        else if (output.trim()) e.output = output.trim();
      }
    } else if (t.name === 'edit' || t.name === 'write' || t.name === 'delete')
      e = { id: t.id, kind: 'file_edit', title: `Sửa ${path}`, path, ...done };
    else if (t.name === 'read') e = { id: t.id, kind: 'file_read', title: `Đọc ${path}`, path, ...done };
    else if (SEARCH_TOOLS.has(t.name))
      e = {
        id: t.id,
        kind: 'search',
        title: 'Tìm kiếm',
        text: str(t.args.globPattern) || str(t.args.pattern) || str(t.args.query),
        ...done,
      };
    else if (t.name === 'mcp') e = { id: t.id, kind: 'tool', title: mcpTitle(t), ...done };
    else e = { id: t.id, kind: 'tool', title: `Dùng ${t.name}`, ...done };
    return [sanitize(e)];
  };
}

/** Lời agent trong một dòng `assistant` (ghép các khối chữ). */
export function assistantText(m: any): string {
  const content = m?.message?.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c: any) => (c?.type === 'text' ? str(c.text) : ''))
    .join('')
    .trim();
}

/** Dòng log tiến độ ngắn cho một dòng stream-json (rỗng nếu không có gì đáng ghi) — ghi lúc công cụ BẮT ĐẦU, và lời agent. */
export function cursorActivity(line: string, cwd: string): string[] {
  const m = jsonLine(line);
  if (m?.type === 'assistant') {
    const text = assistantText(m);
    return text ? [`Nói: ${oneLine(text, 200)}`] : [];
  }
  const t = cursorTool(line);
  if (!t || t.done || SILENT_TOOLS.has(t.name)) return [];
  const path = displayPath(str(t.args.path), cwd);
  if (t.name === 'shell') return [`Chạy: ${oneLine(str(t.args.command), 200)}`];
  if (t.name === 'edit' || t.name === 'write' || t.name === 'delete') return [`Sửa ${path}`];
  if (t.name === 'read') return [`Đọc ${path}`];
  if (t.name === 'mcp') return [mcpTitle(t)];
  if (SEARCH_TOOLS.has(t.name)) return [];
  return [`Dùng ${t.name}`];
}
