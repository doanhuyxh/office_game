# agent-runner — adapter `cursor` (Cursor CLI `agent`, TEST-202)

Tách từ [agent-runner.md](agent-runner.md). Code: `agent-runner/src/executor/adapters/cursor/` (`index.ts` lệnh + đọc output + chạy thử model, `events.ts` sự kiện xem trực tiếp, `session.ts` file MCP / quyền / phiên). Kiểm với Cursor CLI **2026.11.19** (binary `agent`, tên cũ `cursor-agent`) bằng tài khoản đã đăng nhập, gói Free (`agent --help`, chạy headless thật, output mẫu ở `tests/fixtures/cursor-*.jsonl`) — bản khác đổi cờ / định dạng thì sửa adapter.

## Cấu hình

```yaml
executor:
  kind: cursor
  bin: /usr/local/bin/agent
  model: auto                    # id trong `agent --list-models` → --model
  home: /srv/agents/NV124/home   # HOME riêng: <home>/.cursor/ (đăng nhập, mcp.json, phiên)
  timeout_min: 60
  extra_args: []
```

- Đăng nhập: `HOME=<home> agent login` một lần, hoặc `CURSOR_API_KEY=…` trong `env_file`. `--api-key` trong `extra_args` → **lỗi cấu hình** (khoá lộ trong tham số tiến trình). `doctor` cảnh báo khi HOME chưa từng chạy CLI (chưa có `.cursor/cli-config.json`) — chỉ là dấu hiệu, trạng thái đăng nhập thật thì bước chạy thử model báo.
- `max_budget_usd`, `max_turns` (cả trong `light`) **không có tác dụng**, `doctor` cảnh báo; chỉ `timeout_min` chặn phiên (đã có báo lỗi `agent -p` treo không ra output).
- Gói Free chỉ dùng được `auto` / Grok: model khác → CLI thoát 1 "Model unavailable on Free" → `doctor` tắt agent.
- Team admin bật "Disable CLI headless mode" → `agent -p` thoát lỗi ngay; bước chạy thử model của `doctor` in dòng đầu stderr làm lý do.

## Lệnh runner chạy

```
agent -p --output-format stream-json --trust --workspace <cwd> --approve-mcps
  [--model <model>] [--resume <session_id>]
  [--force]                 # phiên có công cụ (worktree / in_place / none + builtin_tools)
  [extra_args…] -- "<prompt>"
```

- **Không có `--force`** thì lệnh shell VÀ tool MCP đều bị từ chối (`--approve-mcps` chỉ duyệt máy chủ, không duyệt từng lần gọi), CLI vẫn thoát 0, `is_error: false`.
- **Phiên chỉ MCP** (none, chat, họp): không `--force`; runner ghi `<cwd>/.cursor/cli.json` (thư mục trống của runner dưới `data_dir`, không phải repo): `allow: ["Mcp(officehub:*)"]`, `deny: ["Shell(*)", "Write(**)", "Read(**)"]`. Đã thử thật: tool MCP chạy, lệnh / ghi file / đọc file bị chặn. Công cụ tìm tên file, web chưa kiểm hết → `caps.toolRestriction = false`, `doctor` cảnh báo.
- Thư mục đó sau này chạy phiên có công cụ (agent bật `builtin_tools`) → runner gỡ file quyền do chính nó ghi (luật cấm thắng `--force`); file quyền người dùng tự viết thì giữ.
- Tool MCP bị từ chối mà CLI báo thành công → adapter đánh dấu phiên lỗi (`errorKind: mcp_rejected`), không báo thành công giả.

## MCP

- CLI đọc `<HOME>/.cursor/mcp.json` (và `.cursor/mcp.json` trong thư mục làm việc — runner không ghi vào đó vì lẫn vào repo); không có cờ truyền file.
- `writeCursorMcp` ghi gộp máy chủ của job: `{ url, headers: { Authorization: "Bearer ${env:OFFICEHUB_TOKEN}" } }`. **Đã thử: Cursor thay `${env:BIẾN}` (và `${BIẾN}`) theo env lúc chạy** → token chỉ nằm trong biến môi trường, không cần cầu nối `mcp-bridge` như Antigravity. Máy chủ khác trong file được giữ.
- Không đặt `executor.home` → file được ghi là `~/.cursor/mcp.json` của user chạy runner (`doctor` cảnh báo).

## Đọc output

- `system/init`: `session_id` → `sessionId`; `model` là **tên hiển thị** ("Auto", "Composer 2.5"), không phải id cấu hình → `doctor` có thể báo "model thật KHÁC cấu hình" với model không phải `auto` (chỉ là cảnh báo).
- `assistant` → lời agent (tóm tắt = lời cuối; `result.result` ghép mọi lời trong phiên). `thinking` gom `delta` → sự kiện suy nghĩ. `tool_call` `started` / `completed` (`shellToolCall`, `editToolCall`, `readToolCall`, `globToolCall`, `mcpToolCall`…) → log tiến độ + sự kiện xem trực tiếp: lệnh kèm output, file chỉ đường dẫn (không gửi nội dung / diff), MCP chỉ tên; `getMcpToolsToolCall` không hiện.
- `result`: `is_error`, `usage` có `inputTokens` / `outputTokens` / `cacheReadTokens` / `cacheWriteTokens` — `inputTokens` KHÔNG gồm cache nên runner cộng phần cache vào tổng token vào. Số lượt = số `tool_call completed` + 1. Không có chi phí USD → bình luận kết quả chỉ ghi token.
- Lỗi (model không dùng được, chưa đăng nhập…): thoát khác 0, **không có dòng `result`**, lý do ở stderr → runner báo phiên lỗi theo mã thoát.

## Nối phiên, chạy thử model

- Nối phiên: `--resume <session_id>` (đã thử: agent nhớ lượt trước, `usage` chỉ của lượt mới); `hasSession` tìm thư mục `<home>/.cursor/chats/<mã thư mục làm việc>/<session_id>/`.
- Chạy thử model: `agent -p --output-format stream-json --trust --mode ask [--model …] -- ok`. `parseProbe(stdout, stderr)`: stderr có "Cannot use this model" / "Model unavailable" → agent tắt; lỗi khác (chưa đăng nhập) → cảnh báo kèm dòng đầu stderr.

## Chưa kiểm

- `--force` với phiên có công cụ (công cụ tự động trên máy thử chặn cờ này) và một việc thật ở mode `worktree` (commit, PR, bình luận kết quả).
- Chạy qua runner với OfficeHub thật (đã thử với MCP giả qua chính lệnh adapter dựng: gọi được tool, token đúng, lệnh bị chặn ở phiên chỉ MCP).
- `CURSOR_API_KEY` trong `env_file`; dấu hiệu đăng nhập trên Linux (macOS không có file đăng nhập trong `~/.cursor`).
