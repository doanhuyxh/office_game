# Bộ điều phối agent (`agent-runner/`, TEST-44)

> Về [README](README.md) · tin đánh thức: [notifications-telegram.md](notifications-telegram.md) · đội agent: [agent-team.md](agent-team.md)

Dự án bun + TypeScript độc lập ở gốc repo, **không thư viện runtime** (Telegram / MCP qua `fetch`, YAML `Bun.YAML`, SQLite `bun:sqlite`). Không import mã `backend/` / `frontend/` — chỉ nói chuyện với OfficeHub qua `/mcp` (token AI của agent) và Telegram.

## Luồng

1. **Listener** (`runner.ts` → `telegram.ts`): mỗi agent long-poll `getUpdates` bằng **token bot của agent** (không mở cổng); offset lưu SQLite.
2. **Validator** (`validator.ts`):
   - `parseWake` (không gọi mạng): đúng `group_chat_id`, người gửi là `notifier_bot` (is_bot), dòng 1 nhắc đúng bot của agent, dòng 2 JSON đúng 4 trường (`employee_code`, `project_id`, `task_id`, `task_code`), mã NV khớp. Sai → bỏ qua, chỉ log.
   - `checkTask` (MCP `get_task`, **lúc nhận tin và ngay trước khi chạy**): đúng dự án, vẫn giao cho chính agent (`assigneeEmployeeId` = id trong `get_my_profile`), chưa xong, `dependsOn` đã xong hết.
3. **Store** (`store.ts`, `{data_dir}/runner.db`): hàng đợi FIFO, **khoá theo `task_id`** (index unique khi queued / running), tổng ≤ `max_parallel`, mỗi agent 1 phiên. Khởi động lại → job đang chạy dở về hàng đợi.
4. **Workspace** (`workspace.ts`): worktree `{worktrees_dir}/{mã NV}/{mã việc}` — ngoài repo, hoặc **trong repo nếu thư mục đã gitignore** (vd `/.officehub-runner/`, `doctor` bắt buộc; `EnvLoader` dừng ở gốc worktree nên không đọc `.env` production của repo chính), nhánh `agent/{nv}/{việc}` từ `origin/{base}`; việc được đánh thức lại dùng lại worktree. Cài hook `pre-push` (thư mục hooks chung của repo): chặn push lên main / master và nhánh có thay đổi trong `agent-runner/`.
5. **Executor** (`executor/`): chạy CLI theo đường dẫn cấu hình, adapter:
   - `claude` (kiểm với Claude Code 2.1.x): `-p … --output-format stream-json --verbose --mcp-config <job>/mcp.json --strict-mcp-config --setting-sources user --permission-mode bypassPermissions [--model] [--max-budget-usd] [--resume <session>]`. `--setting-sources user` = không nạp `.claude/settings.json` của repo (agent sửa được file đó); `CLAUDE.md` / `AGENTS.md` vẫn đọc.
   - `custom`: `args` / `resume_args` với `{cwd} {model} {mcp_config} {prompt_file} {session_id}`; output `text` (2000 ký tự cuối) hoặc `json` (dòng JSON có `session_id`, `cost_usd`, `summary`…).
   - Tiến trình tách nhóm; hết `timeout_min` / dừng runner → SIGTERM cả process group, 10 giây sau SIGKILL. stdout / stderr → `{data_dir}/jobs/{id}/output.log` (đã che bí mật).
   - Env của CLI **không kế thừa** env runner: chỉ PATH / LANG / … + `HOME` = `executor.home` + `env_file` (biến thử nghiệm: DB tạm, S3 thử, Mailpit) + `OFFICEHUB_TOKEN`. File MCP chỉ có `${OFFICEHUB_TOKEN}`, không chứa token; `mcp.json` + `prompt.md` xoá khi job xong.
6. **Prompt** (`prompt.ts`): chỉ mã NV / mã việc / id + các bước `get_my_role` → `get_project` (workGuide) → `get_task` → làm → `comment_task` → chuyển trạng thái trước bước duyệt; agent **chỉ commit, không push / không tạo PR**; quy tắc cứng (không `.env`, không sửa `agent-runner/`, không duyệt, không production). Không chép nội dung việc.
7. **Publisher**: nhánh có commit mới → `git push` + `gh pr create` (PR đã có → dùng lại); chạm `agent-runner/` → không push. Runner `comment_task` một dòng: PR, thời gian, lượt, chi phí, token, ghi chú lỗi.

## Cấu hình

`agents.example.yaml` (file thật `chmod 600`, có token; `agent-runner/agents.yaml` + `/.officehub-runner/` trong `.gitignore`). Kiểm tra khi đọc: repo không nằm trong `worktrees_dir`, token `ohk_…`, username bot kết thúc `bot`, `bin` tuyệt đối…

## Lệnh (`agent-runner/`)

| Lệnh | Việc |
|---|---|
| `bun src/cli.ts doctor [--agent NV120] [--no-telegram]` | CLI `--version`, token đúng nhân viên, repo có origin, cài hook, bot Telegram (`getMe`), `gh auth status` |
| `bun src/cli.ts start` | Dịch vụ (systemd: `deploy/officehub-runner.service`) |
| `bun src/cli.ts run --agent NV120 --task TEST-45` | Chạy ngay một việc (bỏ qua Telegram, vẫn hỏi lại OfficeHub) |
| `bun src/cli.ts report [--days 1]` | Chi phí theo agent |
| `bun run build` | Một file chạy `dist/officehub-runner` — build từ commit đã merge `main`, cài `/opt/officehub-runner/` |
| `bun run typecheck`, `bun test` | Bắt buộc khi đổi `agent-runner/` (CI job `agent-runner`) |

Test: đơn vị (cấu hình, validator, adapter + mẫu stream-json, store, prompt, hook) + **tích hợp** `tests/flow.test.ts` (Telegram giả + MCP giả + CLI giả + repo bare: tin hợp lệ / giả mạo, worktree ngoài repo, push nhánh, bình luận chi phí, nối phiên, việc không còn giao, chạm `agent-runner/` → không push + hook chặn). Đã thử adapter `claude` với CLI thật (Haiku, có `--resume`).

## Chưa làm (bước sau của TEST-44)

Trường `event` trong tin (returned / mentioned / cancelled → dừng phiên), HMAC tin, tổng kết chi phí hằng ngày vào nhóm, adapter `codex` / `gemini`, user Linux riêng từng agent, chỉ chạy khi người giao nằm trong danh sách cho phép (prompt injection).
