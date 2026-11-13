# officehub-agent-runner

Bộ điều phối agent của OfficeHub (TEST-44): nhận tin đánh thức Telegram khi việc được giao cho tài khoản bot, hỏi lại OfficeHub qua MCP,
chạy CLI agent (Claude Code hoặc CLI tuỳ chỉnh) trong worktree riêng, push nhánh + mở PR, bình luận chi phí vào việc.
Agent nghiệp vụ (không viết code) dùng `workspace.mode: none`: không repo / git / PR, CLI chỉ có tool MCP của OfficeHub.

```bash
bun install
bun run typecheck && bun test
cp agents.example.yaml /etc/officehub-runner/agents.yaml && chmod 600 /etc/officehub-runner/agents.yaml   # sửa token / đường dẫn
bun src/cli.ts doctor --config /etc/officehub-runner/agents.yaml
bun src/cli.ts run --agent NV120 --task TEST-45 --config …   # thử một việc
```

Kiến trúc, cấu hình, triển khai systemd, giới hạn: [`.agent/business/agent-runner.md`](../.agent/business/agent-runner.md).
