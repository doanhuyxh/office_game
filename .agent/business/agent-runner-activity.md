# agent-runner: sự kiện "agent đang làm gì" (xem trực tiếp trong 3D)

> Về [agent-runner.md](agent-runner.md) · phía OfficeHub (hợp đồng, đệm, ai được xem): [office-bots-activity.md](office-bots-activity.md) · bong bóng nhãn thô: [office-bots-work.md](office-bots-work.md).
> Code: `agent-runner/src/executor/events.ts` (kiểu, che bí mật, cắt, phiên), `executor/adapters/claude-events.ts` (stream-json → sự kiện), `executor/run.ts` (`onEvent`). Test `tests/events.test.ts` + `tests/fixtures/claude-events.jsonl`.

Chủ dự án duyệt 2026-11-14: bấm vào bot trong văn phòng 3D → thấy trực tiếp lệnh, file đang sửa, suy nghĩ, lời agent. **Ai đứng trong phạm vi nghe được của bot cũng xem được, không lưu lịch sử, có hiện suy nghĩ.** Vì vậy mọi thứ runner gửi đi phải coi như công khai trong công ty.

## Trạng thái

| Việc | Nội dung | Trạng thái |
|---|---|---|
| TEST-93 | Tách sự kiện có cấu trúc (file này) | ✅ |
| TEST-99 | Gửi `POST <mcp_url>/activity` theo lô, nối vào luồng job | chưa làm — `onEvent` chưa có nơi nhận, runner chưa gửi gì |

## Sự kiện (`ActivityEvent`)

Khớp `BotActivityEvent` (`backend/.../BuildingBlocks/Office/BotActivityFeed.cs`): `id`, `kind`, `title`, `text`, `path`, `diff`, `output`, `ok`, `task`, `model`, `turns`, `costUsd`. Gửi lại cùng `id` = cập nhật (trường không gửi giữ giá trị cũ).

| Nguồn trong stream-json | `kind` | Gửi gì |
|---|---|---|
| `Bash` | `command` | `text` = lệnh, `title` = mô tả của agent hoặc "Chạy lệnh". `tool_result` cùng id → `output` (4 000 ký tự **cuối**) + `ok` |
| `Edit` / `MultiEdit` / `NotebookEdit` | `file_edit` | `path` + `diff` dòng `-` / `+` (dựng từ `old_string` / `new_string`) |
| `Write` | `file_write` | `path` + `diff` toàn dòng `+` |
| `Read` | `file_read` | **chỉ `path`** |
| `Grep` / `Glob` | `search` | `text` = mẫu tìm, `path` = thư mục tìm |
| khối `thinking` | `thinking` | `text` |
| khối `text` | `say` | `text` |
| `mcp__officehub__*`, tool khác | `tool` | chỉ tên (`OfficeHub comment_task`, `Dùng WebFetch`) |
| runner (`sessionStart` / `sessionEnd`) | `session_start` / `session_end` | `task` "MÃ · tên", model cấu hình lúc bắt đầu; lượt, chi phí, **model thật** lúc kết thúc |

- `id` = `tool_use.id` của CLI; suy nghĩ / lời nói: `think-N` / `say-N` (đếm trong một lần chạy); phiên: `session`, `session-end`.
- Kết quả của `Read` / `Grep` / `Edit` / tool MCP **không gửi nội dung** (là nội dung file / dữ liệu nghiệp vụ) — chỉ cập nhật `ok`.
- **Không cập nhật `session_start` bằng cùng id**: server xoá đệm mỗi khi nhận `session_start` → model thật để ở `session_end`.
- Adapter `custom` không có `events` → người xem chỉ thấy bắt đầu / kết thúc phiên.

## An toàn (bắt buộc)

- `mask()` chạy trên **mọi** trường chữ (`sanitize` là bước cuối của mọi sự kiện): chuỗi đã `registerSecret` (token AI, token bot) + mẫu: `ohk_…`, token bot Telegram, khối khoá riêng PEM, `Bearer …` / `Basic …`, `user:pass@host`, `password|secret|token|api_key|…  = / : giá trị`. Mẫu cuối che cả code vô hại (`const token = …`) — chấp nhận, thà che nhầm.
- File nhạy cảm (`isSensitivePath`: `.env*`, `*.env`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `agents.yaml`, `id_rsa*` / `id_ed25519*`, `.npmrc`, `.netrc`, `credentials*`, `secrets.*`): sửa / ghi chỉ gửi `path` + "(nội dung ẩn: file nhạy cảm)".
- Lệnh đụng file đó hoặc in biến môi trường (`isSensitiveCommand`: `cat .env`, `printenv`, `env | …`): lệnh vẫn hiện, **kết quả bị ẩn**.
- Đường dẫn: trong `cwd` → tương đối; trong HOME → `~/…`.
- Cắt theo `LIMITS` (khớp `BotActivityFeedRoute`; server cắt lại): tiêu đề 200, chữ 4 000 (giữ đầu), kết quả 4 000 (giữ đuôi), diff 200 dòng / 16 000 ký tự (dòng cuối `…`).
- `run.ts` bọc `try / catch`: lỗi khi tách hay khi `onEvent` ném → bỏ qua, job vẫn chạy.

Giới hạn đã biết: bí mật không theo mẫu nào và chưa đăng ký (vd agent `echo` một giá trị lạ) vẫn lọt; thêm mẫu vào `mask()` khi gặp.
