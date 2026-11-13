import { type ActivityEvent, HIDDEN, HIDDEN_OUTPUT, diffOf, displayPath, isSensitiveCommand, isSensitivePath, oneLine, sanitize } from '../events';

/**
 * stream-json của Claude Code → sự kiện có cấu trúc (TEST-93). Có trạng thái theo từng lần chạy CLI: nhớ `tool_use` đã thấy để ghép
 * `tool_result` (message `user`) vào đúng sự kiện bằng cùng `id`.
 *
 * - `Bash` → `command` (lệnh); kết quả về → cùng id + `output` (phần cuối) + `ok`. Lệnh đụng file / biến bí mật → ẩn kết quả.
 * - `Edit` / `MultiEdit` / `NotebookEdit` → `file_edit` (diff `-` / `+`); `Write` → `file_write` (toàn dòng `+`). File nhạy cảm → không diff.
 * - `Read` → `file_read` (CHỈ đường dẫn); `Grep` / `Glob` → `search` (mẫu tìm). Kết quả của các tool này không gửi (là nội dung file).
 * - khối `thinking` → `thinking`; khối `text` → `say`.
 * - `mcp__officehub__*` và tool khác → `tool` (chỉ tên — tham số / kết quả có thể là dữ liệu nhân sự, tài chính).
 * Sự kiện phiên (`session_start` / `session_end`) do runner dựng (`sessionStart` / `sessionEnd`), không ở đây.
 */
export function claudeEvents(cwd: string): (line: string) => ActivityEvent[] {
  /** tool_use id → có gửi kết quả lệnh không (chỉ Bash không nhạy cảm). */
  const pending = new Map<string, { kind: ActivityEvent['kind']; output: boolean; hidden: boolean }>();
  let seq = 0;

  const fromTool = (b: any): ActivityEvent | undefined => {
    const id = typeof b.id === 'string' && b.id ? b.id : `tool-${++seq}`;
    const i = b.input ?? {};
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    const path = displayPath(str(i.file_path) || str(i.notebook_path), cwd);
    const secret = !!path && isSensitivePath(path);
    const remember = (e: ActivityEvent, output = false, hidden = false) => { pending.set(id, { kind: e.kind, output, hidden }); return e; };
    switch (b.name) {
      case 'Bash': {
        const command = str(i.command);
        const hidden = isSensitiveCommand(command);
        return remember({ id, kind: 'command', title: str(i.description) || 'Chạy lệnh', text: command }, !hidden, hidden);
      }
      case 'Edit':
        return remember({ id, kind: 'file_edit', title: `Sửa ${path}`, path, ...(secret ? { text: HIDDEN } : { diff: diffOf(str(i.old_string), str(i.new_string)) }) });
      case 'MultiEdit': {
        const edits: any[] = Array.isArray(i.edits) ? i.edits : [];
        const diff = edits.map((e) => diffOf(str(e?.old_string), str(e?.new_string))).filter(Boolean).join('\n');
        return remember({ id, kind: 'file_edit', title: `Sửa ${path}`, path, ...(secret ? { text: HIDDEN } : { diff }) });
      }
      case 'NotebookEdit':
        return remember({ id, kind: 'file_edit', title: `Sửa ${path}`, path, ...(secret ? { text: HIDDEN } : { diff: diffOf('', str(i.new_source)) }) });
      case 'Write':
        return remember({ id, kind: 'file_write', title: `Ghi ${path}`, path, ...(secret ? { text: HIDDEN } : { diff: diffOf('', str(i.content)) }) });
      case 'Read':
        return remember({ id, kind: 'file_read', title: `Đọc ${path}`, path });
      case 'Grep': case 'Glob': {
        const where = displayPath(str(i.path), cwd);
        return remember({ id, kind: 'search', title: b.name === 'Glob' ? 'Tìm file' : 'Tìm trong code', text: str(i.pattern), ...(where ? { path: where } : {}) });
      }
      case 'TodoWrite':
        return remember({ id, kind: 'tool', title: 'Cập nhật danh sách việc cần làm' });
      case 'Task': case 'Agent':
        return remember({ id, kind: 'tool', title: 'Giao việc phụ', text: oneLine(str(i.description), 200) });
      default: {
        const name = String(b.name ?? '');
        const mcp = /^mcp__officehub__(.+)$/.exec(name);
        return remember({ id, kind: 'tool', title: mcp ? `OfficeHub ${mcp[1]}` : `Dùng ${name}` });
      }
    }
  };

  const fromResult = (b: any): ActivityEvent | undefined => {
    const p = typeof b.tool_use_id === 'string' ? pending.get(b.tool_use_id) : undefined;
    if (!p) return undefined;
    pending.delete(b.tool_use_id);
    const e: ActivityEvent = { id: b.tool_use_id, kind: p.kind, ok: b.is_error !== true };
    if (p.hidden) e.output = HIDDEN_OUTPUT;
    else if (p.output) {
      const text = resultText(b.content);
      if (text) e.output = text;
    }
    return e;
  };

  return (line) => {
    if (!line.startsWith('{')) return [];
    let m: any;
    try { m = JSON.parse(line); } catch { return []; }
    const content = m?.message?.content;
    if (!Array.isArray(content)) return [];
    const out: ActivityEvent[] = [];
    for (const b of content) {
      let e: ActivityEvent | undefined;
      if (m.type === 'assistant') {
        if (b?.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.trim()) e = { id: `think-${++seq}`, kind: 'thinking', title: 'Suy nghĩ', text: b.thinking.trim() };
        else if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) e = { id: `say-${++seq}`, kind: 'say', title: 'Nói', text: b.text.trim() };
        else if (b?.type === 'tool_use') e = fromTool(b);
      } else if (m.type === 'user' && b?.type === 'tool_result') e = fromResult(b);
      if (e) out.push(sanitize(e));
    }
    return out;
  };
}

/** Nội dung `tool_result`: chuỗi, hoặc mảng khối `{ type: "text", text }` (ảnh / khối khác bỏ qua). */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((c: any) => (c?.type === 'text' && typeof c.text === 'string' ? c.text : '')).filter(Boolean).join('\n');
}
