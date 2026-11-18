# agent-runner — adapter `codex` (OpenAI Codex CLI)

Tách từ [agent-runner.md](agent-runner.md). Code: `agent-runner/src/executor/adapters/codex.ts`. Kiểm với Codex CLI **0.170** (`codex exec --help`, `codex exec resume --help`) — bản khác đổi cờ thì sửa adapter.

## Cấu hình

```yaml
executor:
  kind: codex
  bin: /usr/local/bin/codex      # đường dẫn tuyệt đối, user chạy runner phải chạy được
  model: gpt-5.1-codex           # → -m
  home: /srv/agents/NV122/home   # HOME riêng: <home>/.codex/ (đăng nhập, config.toml, phiên)
  timeout_min: 60
  extra_args: []                 # cờ thêm cho `codex exec` (đặt trước prompt)
```

- Đăng nhập: `HOME=<home> codex login`, hoặc `CODEX_API_KEY=…` trong `env_file` (runner không cho CLI kế thừa env của runner). `doctor` cảnh báo khi `<home>/.codex/auth.json` chưa có.
- Không cần `args` / `output` (đó là của `custom`).
- `max_budget_usd`, `max_turns` (cả trong `light`) **không có tác dụng** — Codex không có trần này; `doctor` cảnh báo. Chỉ `timeout_min` chặn phiên. `light.model` vẫn dùng được.

## Lệnh runner chạy

```
codex exec [resume] --json --skip-git-repo-check
  -c mcp_servers.officehub.url="<mcp_url>?profile=…"
  -c mcp_servers.officehub.bearer_token_env_var="OFFICEHUB_TOKEN"
  -c mcp_servers.officehub.default_tools_approval_mode="approve"
  [-m <model>]
  --dangerously-bypass-approvals-and-sandbox            # phiên có công cụ (worktree / in_place / none + builtin_tools)
  | -c sandbox_mode="read-only" -c approval_policy="never"   # phiên chỉ MCP (none, chat, họp)
  [extra_args…] -- [<thread_id>] "<prompt>"
```

- Mọi tuỳ chọn đi qua `-c` vì `exec resume` không có `--sandbox` / `--cd`; thư mục làm việc = cwd của tiến trình.
- **MCP**: `codexMcpArgs` đọc `mcp.json` của job (định dạng `mcpServers` runner ghi cho mọi CLI) rồi đổi sang `-c mcp_servers.<tên>.…`; header `Authorization: Bearer ${BIẾN}` → `bearer_token_env_var` (token chỉ nằm trong env). `default_tools_approval_mode = "approve"` vì phiên không có người bấm duyệt tool.
- **MCP thêm** (Stitch…): khai `[mcp_servers.<tên>]` trong `<home>/.codex/config.toml`. `--mcp-config` trong `extra_args` là cờ của Claude Code, Codex báo lỗi tham số.
- Nối phiên: `thread_id` của sự kiện `thread.started` lưu làm `session_id`; `hasSession` tìm `rollout-…-<id>.jsonl` trong `<home>/.codex/sessions/<năm>/<tháng>/<ngày>/`.

## Khác adapter `claude`

| | `claude` | `codex` |
|---|---|---|
| Tắt công cụ có sẵn (phiên chỉ MCP) | `--tools ""` — tắt hẳn | **Không tắt được shell**: chỉ sandbox `read-only` (lệnh vẫn chạy, đọc được file user đó đọc được, không ghi / không ra mạng). `caps.toolRestriction = false` → `doctor` cảnh báo |
| System prompt ngắn cho phiên MCP (TEST-140) | `--system-prompt` | bỏ qua |
| Chi phí USD | có | không (chỉ token: `input_tokens` đã gồm `cached_input_tokens`, `output_tokens` của `turn.completed`) |
| Model thật | `modelUsage` | `--json` không báo → `finish` đọc dòng `turn_context` cuối trong file phiên (`codexSessionModel`); không đọc được → model cấu hình kèm "(cấu hình)". Không có chạy thử model lúc `start` / `doctor` |
| Trần ngân sách / số vòng | có | không |
| Transcript lên cloud (TEST-144) | có | không (tên file phiên có ngày giờ, không suy ra được từ id) |
| Sự kiện xem trực tiếp | đủ, có diff | lệnh + kết quả, file sửa (chỉ đường dẫn), suy nghĩ, lời agent, tool MCP |

Vì không tắt hẳn được shell, **đừng dùng `codex` cho bot nghiệp vụ nhận nội dung từ người lạ** trên máy có dữ liệu nhạy cảm mà user chạy runner đọc được; dùng user hệ điều hành riêng, quyền hẹp.

## Đọc output (`--json`)

- `thread.started` → `sessionId`; `item.completed` loại `agent_message` → `summary` (lời cuối cùng).
- `turn.completed` → cộng token, không lỗi. `turns` = số lần gọi công cụ xong (`command_execution`, `mcp_tool_call`, `file_change`, `web_search`) + 1 cho lượt trả lời cuối (gần với `num_turns` của claude).
- Bình luận kết quả: không có chi phí USD nên ghi dòng `- Token: … token vào (… đọc từ cache) / … ra` (`resultComment`). `turn.failed` → `isError`, `errorKind = turn_failed`, `summary` = thông báo lỗi.
- Dòng `{"type":"error"}` lẻ chỉ là báo thử lại ("Reconnecting… 2/5") — không tính lỗi.

## Đã kiểm

Cờ lệnh, khai MCP, `thread.started` / `turn.failed`, tên file phiên: chạy thật với 0.170. Phiên thật đầu tiên (NV010, 2026-11-18, đăng nhập ChatGPT) xác nhận hình dạng `mcp_tool_call`, `agent_message`, `usage` (`input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`, `reasoning_output_tokens`). `command_execution` / `file_change` / `reasoning` viết theo định dạng công bố, chưa thấy trong log thật.

Lưu ý vận hành: đăng nhập ChatGPT không dùng được model ngoài dòng Codex / GPT-5 (vd `gpt-4o-mini` → `turn.failed`); nối phiên sang model khác thì Codex chỉ cảnh báo (`item` loại `error`), không hỏng phiên.
