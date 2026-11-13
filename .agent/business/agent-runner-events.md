# Agent-runner: tin đánh thức không phải việc (chat, họp)

> Về [agent-runner.md](agent-runner.md) · [README](README.md) · định dạng tin: [notifications-telegram.md](notifications-telegram.md) · cuộc họp agent: [meetings-agents.md](meetings-agents.md)

`parseWake` (`validator.ts`) phân loại theo trường `event` của dòng JSON → `Wake` có `kind`:

| `event` | `kind` | Trường bắt buộc | Khoá job (`jobs.task_id`) |
|---|---|---|---|
| không có / `assigned` / `returned` / `ready` / `mentioned` | `task` | `employee_code`, `project_id`, `task_id`, `task_code` | id việc |
| `chat_mention` | `chat` | `employee_code`, `conversation_id`, `message_id` (GUID) | `<mã NV>:<id hội thoại>` |
| `meeting_turn` | `meeting` | `employee_code`, `session_id`, `conversation_id` (GUID) | `<mã NV>:<id phiên họp>` |

`employee_code` phải trùng mã NV của agent. Tin sai → bỏ, chỉ log. Khoá chat / họp **riêng từng agent** (`lightKey`): nhiều bot cùng một hội thoại / cuộc họp mỗi bot một job + một phiên CLI.

## Nguyên tắc chung (chủ dự án chốt 2026-11-13)

- **Mỗi agent một phiên tại một thời điểm**, mọi loại job chung một hàng đợi (`claimNext`: job họp lấy trước, còn lại FIFO). Không có làn song song.
- **Đang họp thì không chạy việc**: trước mỗi job việc / chat, runner hỏi `get_my_meeting`; agent đang dự cuộc họp → job về hàng đợi, `not_before` = 30 giây sau (`MEETING_HOLD_SEC`), hỏi lại tới khi hết họp. Không hỏi được (tài khoản không phải bot, OfficeHub bản cũ) → coi như không họp.
- **Chỉ tool MCP**: job chat / họp luôn chạy với `noBuiltinTools` (adapter `claude`: `--tools ""`), kể cả agent mode `worktree` / `in_place` — tin nhắn là nội dung người khác viết, không được dẫn tới chạy lệnh / đọc ghi file trên máy.
- **Thư mục chạy** trống, riêng: `{data_dir}/work/{mã NV}/chat-{conversation_id}` / `meeting-{session_id}`.
- **Model / ngân sách**: dùng `executor` của agent như job việc (chưa tách cấu hình riêng). Riêng một lượt họp bị giới hạn 2,5 phút.
- Không bình luận vào việc, không báo trạng thái 3D (`presence`); chi phí / model lưu ở `jobs`, `report` có dòng "Theo loại" (việc / chat / họp).
- Cột thêm bằng `ALTER TABLE` lúc mở DB: `jobs.kind` (null = task), `rerun`, `not_before`.

## chat_mention (TEST-81)

Người thật @nhắc bot trong kênh Toàn văn phòng / kênh phòng / nhóm (bot nhắc bot không gửi — [chat-extras.md](chat-extras.md)).

1. **Kiểm tra lại** (`checkChat`, MCP `list_chats`, lúc nhận tin và ngay trước khi chạy): hội thoại còn `mentionedUnread > 0`; hết → bỏ (tin lặp không chạy lại). Kênh Toàn văn phòng: `list_chats` trả `conversation: "office"` → id không khớp hội thoại nào thì xét kênh office.
2. **Hàng đợi**: đang có job chờ → gộp; đang chạy → `rerun = 1`, xong thì `acceptChat` lại (đã đọc hết thì tự bỏ).
3. **Prompt** (`prompt/chat.ts`): `get_my_role` → `read_chat` → trả lời tối đa một tin bằng `send_chat_message` nếu được hỏi / nhờ → `mark_chat_read`. Không chép nội dung tin.
4. **Nối phiên** theo hội thoại trong 24 giờ (`CHAT_SESSION_HOURS`); cũ hơn → phiên mới.

## meeting_turn (TEST-84)

Mỗi tin = **một lượt nói** = một job ngắn.

1. **Kiểm tra lại** (`checkMeeting`, MCP `get_my_meeting`, lúc nhận tin và ngay trước khi chạy): đúng phiên, `isMyTurn`. Họp đã dừng / lượt đã qua → bỏ, chỉ log.
2. **Agent đang chạy job việc** lúc tới lượt → runner gọi `pass_turn` ngay, không xếp hàng (việc đang làm không bị ngắt; cuộc họp không đứng chờ 3 phút). Chủ trì bỏ lượt khi không ai chờ → cuộc họp kết thúc ([meetings-agents.md](meetings-agents.md)) — đừng mở họp với bot đang làm việc dài. Đang chạy job chat → xếp hàng, chạy ngay sau đó.
3. **Chạy**: tối đa `MEETING_TURN_MAX_MIN` = 2,5 phút (hạn nói của server 3 phút), nối phiên theo cuộc họp (không hết hạn) → agent nhớ diễn biến.
4. **Prompt** (`prompt/meeting.ts`): `get_my_meeting` → `read_chat` kênh phòng → số liệu từ tool của mình → `speak_in_meeting` một tin hoặc `pass_turn`; chủ trì mời lần lượt, gần hết trần thì tổng kết + `create_task`.
5. **Sau phiên** (`afterMeetingTurn`): agent vẫn giữ lượt → có `meeting_turn` mới tới giữa phiên (`rerun`) thì xếp thêm một job, không thì runner `pass_turn` thay (CLI lỗi / hết giờ / không nói).
6. Người thật bấm Dừng: job đang chờ bị bỏ ở bước kiểm tra lại; job đang chạy tự hết trong ≤ 2,5 phút (phát biểu sau khi dừng bị Api chặn).

## Test / chưa làm

`units.test.ts` (parseWake / check* / prompt / store), `flow.test.ts` (chat: xếp hàng, gộp, nối phiên, quá 24 giờ, đã đọc → bỏ, rerun, kênh office), `meeting.test.ts` (MCP giả giữ lượt + CLI giả phát biểu: hai agent nói lần lượt, nối phiên, bỏ lượt thay, lượt đã qua, việc hoãn khi đang họp, đang làm việc → bỏ lượt, lượt mới giữa phiên).

Chưa thử với OfficeHub thật (người thật @nhắc bot; mở họp 2–3 agent). Chưa có: trần chi phí riêng mỗi cuộc họp, model rẻ hơn cho chat / họp, tin tổng chi phí vào kênh phòng.
