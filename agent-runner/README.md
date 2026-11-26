# officehub-agent-runner

Bộ điều phối agent của OfficeHub (TEST-44): nhận tin đánh thức Telegram khi việc được giao cho tài khoản bot, hỏi lại OfficeHub qua MCP,
chạy CLI agent (Claude Code hoặc CLI tuỳ chỉnh) trong worktree riêng, push nhánh + mở PR, bình luận chi phí vào việc.
Repo khai theo dự án: `agents[].projects` gắn repo / nhánh gốc / mode theo mã dự án OfficeHub — bắt buộc với agent có repo, một agent làm được nhiều dự án (TEST-200, xem `agents.example.yaml`); `repo` ở cấp agent không còn dùng.
Agent nghiệp vụ (không viết code) dùng `workspace.mode: none`: không repo / git / PR, CLI chỉ có tool MCP của OfficeHub.
Văn phòng 3D (`src/hub/presence.ts`): job việc đang chạy → bot ngồi bàn; xong → Khu nghỉ; job hỏng (hết giờ, CLI lỗi, không push / tạo PR được,
workspace chưa sẵn sàng, runner lỗi) → `state: "error"` kèm loại lỗi ngắn, bot ở bàn với bong bóng ⚠ tới job kế (TEST-121).
Sau mỗi phiên (việc / chat / họp) runner gửi chi phí / token lên OfficeHub (`src/hub/usage.ts`, `POST <mcp_url>/usage`, trang "Mức dùng AI"); `usage push` gửi bù lịch sử.
Runner cũng nhận tin `chat_mention` (người thật @nhắc bot trong chat) và `meeting_turn` (tới lượt nói trong cuộc họp agent): mỗi tin một phiên ngắn chỉ có tool MCP.

```bash
bun install
bun run typecheck && bun test
cp agents.example.yaml /etc/officehub-runner/agents.yaml && chmod 600 /etc/officehub-runner/agents.yaml   # sửa token / đường dẫn
bun src/cli.ts doctor --config /etc/officehub-runner/agents.yaml
bun src/cli.ts run --agent NV120 --task TEST-45 --config …   # thử một việc
bun src/cli.ts usage push --since 2026-11-01 --dry-run --config …   # xem / gửi bù mức dùng AI các phiên cũ
bun src/cli.ts cleanup --dry-run --config …   # xem worktree / transcript / log của việc đã Xong sẽ được dọn (bỏ --dry-run để xoá)
```

Kiến trúc, cấu hình, triển khai systemd, giới hạn: [`.agent/business/agent-runner.md`](../.agent/business/agent-runner.md).
