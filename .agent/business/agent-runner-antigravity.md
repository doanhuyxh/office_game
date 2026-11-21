# agent-runner — adapter `antigravity` (Google Antigravity CLI `agy`, TEST-201)

Tách từ [agent-runner.md](agent-runner.md). Code: `agent-runner/src/executor/adapters/antigravity/` (`index.ts` lệnh + đọc output + chạy thử model, `events.ts` sự kiện xem trực tiếp, `session.ts` file MCP + phiên trong HOME) và `src/hub/mcp-bridge.ts` (cầu nối MCP). Kiểm với **agy 1.5.14** bằng tài khoản đã đăng nhập (`agy --help`, chạy headless thật, output mẫu ở `tests/fixtures/antigravity-*.jsonl`) — bản khác đổi cờ / định dạng thì sửa adapter.

## Cấu hình

```yaml
executor:
  kind: antigravity
  bin: /usr/local/bin/agy
  model: gemini-3.8-flash-high   # tên trong `agy models` → --model
  home: /srv/agents/NV123/home   # HOME riêng: <home>/.gemini/ (đăng nhập, MCP, phiên)
  timeout_min: 60
  extra_args: []                 # cờ thêm cho agy, vd ["--effort", "high"]
```

- Đăng nhập: chạy `HOME=<home> agy` một lần (CLI mở trang đăng nhập). `doctor` cảnh báo khi HOME chưa từng chạy `agy` (chưa có `.gemini/antigravity-cli/installation_id`) — đây chỉ là dấu hiệu, runner không đọc được trạng thái đăng nhập; chưa đăng nhập thì bước chạy thử model báo lỗi.
- `max_budget_usd`, `max_turns` (cả trong `light`) **không có tác dụng**, `doctor` cảnh báo; chỉ `timeout_min` chặn phiên. `light.model` dùng được.
- Không đặt `home` → runner ghi máy chủ MCP của job vào `~/.gemini/config/mcp_config.json` của user chạy runner (máy chủ khác trong file được giữ) — `doctor` cảnh báo.

## Lệnh runner chạy

```
agy --output-format stream-json
  --settings '{"permissions":{"allow":["mcp(officehub/*)"][,"deny":["command(*)"]]}}'
  [--model <model>] [--conversation <id>]
  --dangerously-skip-permissions     # phiên có công cụ (worktree / in_place / none + builtin_tools)
  | --sandbox                        # phiên chỉ MCP (none, chat, họp) — kèm deny command(*) ở --settings
  [extra_args…] -p "<prompt>"
```

- Prompt là giá trị của `-p` đặt cuối (prompt bắt đầu bằng `-` không bị hiểu thành cờ).
- **Quyền ở chế độ headless**: không hỏi được người → thao tác cần duyệt bị từ chối nhưng CLI **vẫn thoát 0, `status: SUCCESS`**, chỉ ghi stderr + `result.denied_actions`. Adapter coi `denied_actions` khác rỗng là phiên lỗi (`errorKind: denied_actions`), không báo thành công giả. Tool MCP cũng cần duyệt → luôn truyền luật `mcp(<máy chủ>/*)` qua `--settings` (chỉ cho phiên này, không lưu).
- **Phiên chỉ MCP** không tắt hẳn được công cụ có sẵn: `deny command(*)` chặn chạy lệnh (đã thử), nhưng công cụ ghi file trong thư mục làm việc vẫn chạy → `caps.toolRestriction = false`, `doctor` cảnh báo như `codex`. Thư mục làm việc của các phiên này là thư mục trống dưới `data_dir`.

## MCP: cầu nối `mcp-bridge`

- `agy` không có cờ khai MCP; đọc `<HOME>/.gemini/config/mcp_config.json` (và `.agents/mcp_config.json` trong thư mục làm việc — runner không ghi vào đó vì lẫn vào repo).
- **Header của máy chủ HTTP không thay biến môi trường** (đã thử `${X}`, `$X`, `${env:X}`, `{{X}}`…: CLI gửi nguyên chuỗi) → không khai kiểu HTTP được nếu không ghi token vào file.
- Cách làm: `writeAntigravityMcp` ghi máy chủ kiểu **stdio** trỏ vào chính runner: `<runner> mcp-bridge --url <mcp_url> --bearer-env OFFICEHUB_TOKEN`. Tiến trình con kế thừa env của phiên (đã thử) nên token chỉ nằm trong biến môi trường; file và tham số chỉ có URL + tên biến. Cầu nối đọc JSON-RPC từng dòng ở stdin, POST tới OfficeHub, ghi phản hồi (JSON / SSE) ra stdout.
- `<runner>` = bản build một file đang chạy (`process.execPath`), hoặc `bun src/cli.ts` khi chạy từ mã nguồn. Đổi đường dẫn cài runner → file MCP được ghi lại ở phiên kế.
- MCP thêm (Stitch…): `HOME=<home> agy mcp add …`; `--mcp-config` trong `extra_args` → lỗi cấu hình.

## Đọc output

- `init`: `conversation_id` → `sessionId`, `init.model` → model thật.
- `step_update`: bước công cụ (`run_command`, `write_file`, `read_file`, `call_mcp_tool`…) → log tiến độ + sự kiện xem trực tiếp (lệnh kèm output, file chỉ đường dẫn, MCP chỉ tên); `agent_response` gom `text_delta` → lời agent. Mỗi bước `DONE` có `usage` → cộng token.
- **Token**: `input_tokens` của CLI KHÔNG gồm phần đọc cache → runner cộng `cache_read_tokens` vào tổng token vào (quy ước chung). `result.usage` và `result.num_turns` là số **luỹ kế cả hội thoại** (sai khi nối phiên) → chỉ dùng khi không có số theo bước; số lượt = số bước công cụ + 1.
- Không có chi phí USD → bình luận kết quả chỉ ghi token (như `codex`).
- `result.status ≠ SUCCESS` → lỗi, `errorKind` = status, dòng đầu của `error` làm tóm tắt.

## Nối phiên, chạy thử model

- Nối phiên: `--conversation <id>`; `hasSession` tìm `<home>/.gemini/antigravity-cli/conversations/<id>.db`.
- Chạy thử model (`doctor` / khởi động): `agy --output-format stream-json [--model …] -p ok`. Model không tồn tại → CLI thoát 1, `result.error` "invalid model selection…" → agent tắt.

## Chưa kiểm

- `--dangerously-skip-permissions` với phiên có công cụ (giả định cờ này duyệt cả tool MCP; luật `mcp(…)` vẫn được truyền kèm) và một việc thật ở mode `worktree` (commit, PR, bình luận token).
- Chạy qua runner với OfficeHub thật (đã thử với MCP giả: gọi được tool qua cầu nối, token đúng, lệnh bị chặn ở phiên chỉ MCP).
- Dấu hiệu đăng nhập trên Linux (trên macOS không thấy file đăng nhập trong `~/.gemini`).
