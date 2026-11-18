import { type ActivityEvent, HIDDEN_OUTPUT, displayPath, isSensitiveCommand, oneLine, sanitize } from '../../events';
import { jsonLine, str } from '../shared';

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
    const m = jsonLine(line);
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

/** Dòng log tiến độ ngắn cho một dòng `--json` (rỗng nếu không có gì đáng ghi). */
export function codexActivity(line: string, cwd: string): string[] {
  const m = jsonLine(line);
  const item = m?.item;
  if (!item) return [];
  if (m.type === 'item.started' && item.type === 'command_execution')
    return [`Chạy: ${oneLine(str(item.command), 200)}`];
  if (m.type === 'item.started' && item.type === 'mcp_tool_call') return [mcpTitle(item)];
  if (m.type !== 'item.completed') return [];
  if (item.type === 'file_change') return changedPaths(item, cwd).map((p) => `Sửa ${p}`);
  if (item.type === 'agent_message' && str(item.text).trim()) return [`Nói: ${oneLine(str(item.text), 200)}`];
  return [];
}
