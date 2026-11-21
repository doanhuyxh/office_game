import { type ActivityEvent, displayPath, HIDDEN_OUTPUT, isSensitiveCommand, oneLine, sanitize } from '../../events';
import { jsonLine, str } from '../shared';

/** Tên công cụ ghi / sửa / đọc file của Antigravity (danh sách `init.tools` và tên trong `step_update` không trùng hẳn nhau → nhận cả hai). */
const WRITE_TOOLS = new Set(['write_file', 'write_to_file']);
const EDIT_TOOLS = new Set([
  'replace_file_content',
  'multi_replace_file_content',
  'sed_file',
  'edit_file',
  'notebook_edit',
]);
const READ_TOOLS = new Set(['read_file', 'view_file']);
const SEARCH_TOOLS = new Set(['grep_search', 'find_by_name', 'search_web']);

/** Một bước công cụ trong `step_update` (`step_type: "tool"`). */
interface ToolStep {
  index: number;
  name: string;
  params: Record<string, unknown>;
  /** DONE / ERROR = đã có kết quả. */
  finished: boolean;
  failed: boolean;
  output: string;
}

/** `step_update` của một bước công cụ; dòng khác → undefined. */
function toolStep(line: string): ToolStep | undefined {
  const u = jsonLine(line)?.step_update;
  if (u?.step_type !== 'tool') return undefined;
  const info = u.tool_info ?? {};
  return {
    index: Number(u.step_index) || 0,
    name: str(u.tool_name) || str(info.name),
    params: info.parameters && typeof info.parameters === 'object' ? info.parameters : {},
    finished: u.state === 'DONE' || u.state === 'ERROR',
    failed: u.state === 'ERROR',
    output: str(info.output),
  };
}

const filePath = (t: ToolStep, cwd: string) =>
  displayPath(str(t.params.Path) || str(t.params.TargetFile) || str(t.params.AbsolutePath), cwd);

const mcpTitle = (t: ToolStep) => {
  const server = str(t.params.ServerName);
  const tool = str(t.params.ToolName);
  return server === 'officehub' ? `OfficeHub ${tool}` : `Dùng ${server}.${tool}`;
};

/** Kết quả `run_command`: bỏ phần đầu (giờ chạy, mã thoát) — chỉ giữ output của lệnh. */
const commandOutput = (output: string) => {
  const at = output.indexOf('Command output:');
  return (at >= 0 ? output.slice(at + 'Command output:'.length) : '').trim();
};

/** `run_command` thành công = bước DONE và lệnh thoát mã 0. */
const commandOk = (t: ToolStep) => !t.failed && /exited with code 0\b/.test(t.output);

/**
 * Sự kiện `--output-format stream-json` của Antigravity → sự kiện xem trực tiếp. Bước công cụ: `ACTIVE` mở sự kiện, `DONE` / `ERROR`
 * cùng `step_index` cập nhật kết quả. `run_command` → `command` (+ output, ẩn khi lệnh đụng file / biến bí mật); ghi / sửa / đọc file →
 * chỉ đường dẫn (CLI không gửi nội dung / diff); `call_mcp_tool` → `tool` (chỉ tên, không tham số); lời agent (`agent_response`, gom các
 * `text_delta`) → `say`.
 */
export function antigravityEvents(cwd: string): (line: string) => ActivityEvent[] {
  const speech = new Map<number, string>();
  return (line) => {
    const u = jsonLine(line)?.step_update;
    if (!u) return [];
    const id = `step-${Number(u.step_index) || 0}`;
    if (u.step_type === 'agent_response') {
      const index = Number(u.step_index) || 0;
      const text = (speech.get(index) ?? '') + str(u.text_delta);
      if (u.state !== 'DONE') {
        speech.set(index, text);
        return [];
      }
      speech.delete(index);
      return text.trim() ? [sanitize({ id, kind: 'say', title: 'Nói', text: text.trim() })] : [];
    }
    const t = toolStep(line);
    if (!t) return [];
    const done = t.finished ? { ok: !t.failed } : {};
    let e: ActivityEvent;
    if (t.name === 'run_command') {
      const command = str(t.params.CommandLine);
      e = { id, kind: 'command', title: 'Chạy lệnh', text: command };
      if (t.finished) {
        e.ok = commandOk(t);
        const output = commandOutput(t.output);
        if (isSensitiveCommand(command)) e.output = HIDDEN_OUTPUT;
        else if (output) e.output = output;
      }
    } else if (WRITE_TOOLS.has(t.name)) {
      const path = filePath(t, cwd);
      e = { id, kind: 'file_write', title: `Ghi ${path}`, path, ...done };
    } else if (EDIT_TOOLS.has(t.name)) {
      const path = filePath(t, cwd);
      e = { id, kind: 'file_edit', title: `Sửa ${path}`, path, ...done };
    } else if (READ_TOOLS.has(t.name)) {
      const path = filePath(t, cwd);
      e = { id, kind: 'file_read', title: `Đọc ${path}`, path, ...done };
    } else if (SEARCH_TOOLS.has(t.name))
      e = { id, kind: 'search', title: 'Tìm kiếm', text: str(t.params.Query) || str(t.params.Pattern), ...done };
    else if (t.name === 'call_mcp_tool') e = { id, kind: 'tool', title: mcpTitle(t), ...done };
    else e = { id, kind: 'tool', title: `Dùng ${t.name}`, ...done };
    return [sanitize(e)];
  };
}

/** Dòng log tiến độ ngắn cho một dòng stream-json (rỗng nếu không có gì đáng ghi) — ghi lúc bước công cụ BẮT ĐẦU. */
export function antigravityActivity(line: string, cwd: string): string[] {
  const t = toolStep(line);
  if (!t || t.finished) return [];
  if (t.name === 'run_command') return [`Chạy: ${oneLine(str(t.params.CommandLine), 200)}`];
  if (WRITE_TOOLS.has(t.name)) return [`Ghi ${filePath(t, cwd)}`];
  if (EDIT_TOOLS.has(t.name)) return [`Sửa ${filePath(t, cwd)}`];
  if (READ_TOOLS.has(t.name)) return [`Đọc ${filePath(t, cwd)}`];
  if (t.name === 'call_mcp_tool') return [mcpTitle(t)];
  return [`Dùng ${t.name}`];
}
