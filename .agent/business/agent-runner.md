# Bộ điều phối agent (`agent-runner/`, TEST-44)

> Về [README](README.md) · cấu trúc mã + thêm cái mới vào đâu: [agent-runner-code.md](agent-runner-code.md) · model thật agent dùng: [agent-runner-model.md](agent-runner-model.md) · tin chat_mention / meeting_turn: [agent-runner-events.md](agent-runner-events.md) · tin đánh thức: [notifications-telegram.md](notifications-telegram.md) · đội agent: [agent-team.md](agent-team.md)

Dự án bun + TypeScript độc lập ở gốc repo, **không thư viện runtime** (Telegram / MCP qua `fetch`, YAML `Bun.YAML`, SQLite `bun:sqlite`). Không import mã `backend/` / `frontend/` — chỉ nói chuyện với OfficeHub qua `/mcp` (token AI của agent) và Telegram.

## Luồng

1. **Listener** (`runner.ts` → `telegram.ts`): mỗi agent long-poll `getUpdates` bằng **token bot của agent** (không mở cổng); offset lưu SQLite.
2. **Validator** (`validator.ts`):
   - `parseWake` (không gọi mạng): đúng `group_chat_id` + có dòng JSON (`employee_code`, `project_id`, `task_id`, `task_code`) với `employee_code` **trùng mã NV của agent**. KHÔNG kiểm người gửi / dòng nhắc bot (đã bỏ `notifier_bot`; key này trong `agents.yaml` nếu còn thì bị bỏ qua). Sai → bỏ qua, chỉ log. Tin `event: chat_mention` / `meeting_turn` đi luồng riêng (job chat / họp, chỉ tool MCP; đang họp thì việc chờ) — [agent-runner-events.md](agent-runner-events.md).
   - `checkTask` (MCP `get_task`, **lúc nhận tin và ngay trước khi chạy**): đúng dự án, vẫn giao cho chính agent (`assigneeEmployeeId` = id trong `get_my_profile`), chưa xong, mọi việc trong `dependsOn` đã `ready` (đã xong, hoặc đã tới cột dự án đánh dấu "việc sau được bắt đầu từ cột này" — vd Deploy; OfficeHub bản cũ không trả `ready` → theo `done`).
   - Không hỏi được OfficeHub (mạng / máy chủ đang deploy) → **thử lại nền** sau 30 giây / 2 phút / 10 phút (`ADMIT_RETRY_SEC`), hết lượt mới bỏ (việc còn được bắt bù lần khởi động sau). Lệnh `run` không thử lại; `stop()` huỷ lần thử lại đang chờ.
3. **Store** (`store.ts`, `{data_dir}/runner.db`): hàng đợi FIFO, **khoá theo khoá job** (cột `task_id`, trong mã là `job.key`; index unique khi queued / running), tổng ≤ `max_parallel`, mỗi agent 1 phiên. Tin mới tới khi khoá đang **chạy** (mọi loại job, kể cả việc: người thật trả việc / bình luận / @nhắc lúc bot đang làm) → `rerun = 1`; xong phiên handler gọi lại `accept` (hỏi lại OfficeHub) và chạy thêm một lượt — thường nối phiên, prompt chỉ đọc phần mới. Job về hàng đợi (`hold` / `requeue` / khởi động lại) → bỏ `rerun` (lúc chạy đã đọc trạng thái mới). Lược đồ nâng cấp theo `PRAGMA user_version` (danh sách `MIGRATIONS`, chỉ thêm bước ở cuối, không đổi tên / xoá cột để bản runner cũ vẫn mở được DB). Khởi động lại → job đang chạy dở về hàng đợi; runner được dừng (SIGTERM / deploy) giữa phiên → job đó cũng về hàng đợi (`store.requeue`), không ghi `failed`, không bình luận "phiên lỗi".
4. **Workspace** (`workspace/`: `git.ts` + một file mỗi mode): worktree `{worktrees_dir}/{mã NV}/{mã việc}` — ngoài repo, hoặc **trong repo nếu thư mục đã gitignore** (vd `/.officehub-runner/`, `doctor` bắt buộc; `EnvLoader` dừng ở gốc worktree nên không đọc `.env` production của repo chính), nhánh `agent/{nv}/{việc}` từ `origin/{base}` — `{base}` = `base_branch` **của agent** (không khai → `runner.base_branch`, mặc định main; vd agent web base `developer`, agent app base `main`), PR merge vào đúng nhánh đó, `doctor` tắt agent nếu origin không có nhánh; việc được đánh thức lại dùng lại worktree. Cài hook `pre-push` (thư mục hooks chung của repo; **kiểm tra lại trước MỖI job**, bị xoá thì tạo lại, hook khác của người dùng thì không ghi đè và chỉ log cảnh báo): chặn push lên main / master + nhánh gốc của **mọi** agent dùng chung repo đó (`repoBaseBranches`) và nhánh có thay đổi trong `agent-runner/` (mốc so của nhánh mới = nhánh gốc của agent đang push, env `OFFICEHUB_BASE_BRANCH`).
5. **Executor** (`executor/`): chạy CLI theo đường dẫn cấu hình, adapter:
   - `claude` (kiểm với Claude Code 2.1.x): `-p … --output-format stream-json --verbose --mcp-config <job>/mcp.json --strict-mcp-config --setting-sources user --permission-mode bypassPermissions [--model] [--max-budget-usd] [--resume <session>]`. `--setting-sources user` = không nạp `.claude/settings.json` của repo (agent sửa được file đó); `CLAUDE.md` / `AGENTS.md` vẫn đọc.
   - `codex` (OpenAI Codex CLI, kiểm với 0.170): `exec [resume] --json`, MCP qua `-c mcp_servers.…`, không có chi phí USD / trần ngân sách — [agent-runner-codex.md](agent-runner-codex.md).
   - `custom`: `args` / `resume_args` với `{cwd} {model} {mcp_config} {prompt_file} {session_id}`; output `text` (2000 ký tự cuối) hoặc `json` (dòng JSON có `session_id`, `cost_usd`, `summary`, `model`…).
   - **Model thật** (TEST-64): đọc `modelUsage` của `result`, lưu `jobs.model` / `model_usage`, ghi vào log + bình luận; khởi động / `doctor` chạy thử → model sai thì agent tắt — [agent-runner-model.md](agent-runner-model.md).
   - **Log tiến độ:** adapter có `activity(line, cwd)` (tuỳ chọn) → mỗi thao tác agent làm (đọc / sửa / ghi file, chạy lệnh, tìm kiếm, gọi tool OfficeHub, đoạn agent nói) thành một dòng log `agent đang làm` kèm `job`, `agent`, `task`, `action` (đã che bí mật). Adapter `claude` và `codex` có; `custom` chỉ có output.log.
   - **Sự kiện xem trực tiếp** (TEST-93): adapter có `events(cwd)` (tuỳ chọn) → mỗi dòng stream-json thành sự kiện có cấu trúc (lệnh + kết quả, diff, suy nghĩ, lời agent, tool) đã che bí mật, trả qua `ExecContext.onEvent`; `ActivitySender` (`src/hub/activity.ts`, TEST-99) gom lô gửi `POST <mcp_url>/activity` (1 giây / 50 sự kiện, phiên `session_start` → `session_end` cho job việc / chat / họp) — để người đứng gần bot trong 3D xem trực tiếp. Tắt: `runner.activity_stream: false` — [agent-runner-activity.md](agent-runner-activity.md).
   - **Định dạng log:** `runner.log_format` / env `RUNNER_LOG_FORMAT` = `auto` (terminal → một dòng dễ đọc có màu: `10:21:07 NV120 TEST-45 #3  ✎ Sửa src/a.ts`; systemd / pipe → JSON một dòng) | `json` | `pretty`. Mỗi job còn có `{data_dir}/jobs/{id}/activity.log` (mỗi thao tác một dòng kèm giờ, đã che bí mật) cạnh `output.log` (stream-json thô).
   - **Văn phòng 3D** (`hub/presence.ts`): báo OfficeHub `POST <mcp_url>/presence` — `working` + mã việc lúc bắt đầu job, nhãn thô thao tác (không gửi lệnh / đường dẫn / lời agent, ≤ 1 lần / 10 giây), `idle` khi xong + nhịp còn sống 2 phút → bot ngồi bàn / ra Khu nghỉ; job việc hỏng → `error` + loại lỗi ngắn (giữ tới job kế, TEST-121) — [office-bots-work.md](office-bots-work.md).
   - Tiến trình tách nhóm; hết `timeout_min` / dừng runner → SIGTERM cả process group, 10 giây sau SIGKILL. stdout / stderr → `{data_dir}/jobs/{id}/output.log` (đã che bí mật).
   - Env của CLI **không kế thừa** env runner: chỉ PATH / LANG / … + `HOME` = `executor.home` (`doctor` cảnh báo khi không đặt, hoặc HOME có `~/.claude/CLAUDE.md` / skills / agents / commands / plugin / hook — nạp vào mọi phiên vì `--setting-sources user`, TEST-140: để HOME riêng chỉ có đăng nhập CLI) + `env_file` (biến thử nghiệm: DB tạm, S3 thử, Mailpit) + `OFFICEHUB_TOKEN`. File MCP chỉ có `${OFFICEHUB_TOKEN}`, không chứa token; `mcp.json` + `prompt.md` xoá khi job xong.
6. **Prompt** (`prompt/`): chỉ mã NV / mã việc / id + các bước `get_my_role` → `get_project` (workGuide) → `get_task` → làm → `comment_task` → chuyển trạng thái trước bước duyệt; agent **chỉ commit, không push / không tạo PR**; quy tắc cứng (không `.env`, không sửa `agent-runner/`, không duyệt, không production). Không chép nội dung việc.
7. **Publisher**: nhánh có commit mới → `git push` + `gh pr create` (PR đã có → dùng lại); chạm `agent-runner/` → không push. Runner `comment_task` một dòng: PR, thời gian, lượt, chi phí, token, ghi chú lỗi.

## Log lúc khởi động (TEST-159)

`Runner.start` log một dòng `khởi động n/6: …` **trước** mỗi giai đoạn (nhìn log biết đang ở bước nào / kẹt ở đâu): 1 đưa lại job chạy dở → 2 kiểm tra git + agent → 3 bật agent (trạng thái 3D + nghe Telegram, mỗi agent một dòng) → 4 bắt bù việc (hoặc ghi rõ đã tắt bằng cờ / cấu hình) → 5 gửi mức dùng AI + transcript tồn → 6 sẵn sàng (agent đang chạy, `maxParallel`). Trong giai đoạn 2, `checkAgents` nhận `progress: DoctorProgress` (`doctor/finding.ts`): `step` gọi trước từng kiểm tra (dòng `→ kiểm tra CLI …`, `→ chạy thử model … — có thể mất tới 2 phút`), `finding` gọi ngay khi có dòng ✔ / ⚠ / ✘ — không còn chờ kiểm tra xong mọi agent mới in. Thêm bước kiểm tra mới trong `diagnoseAgent` → gọi `report.step(...)` trước nó. Lệnh `doctor` / `run` không truyền `progress` (gom rồi in như cũ).

## Bắt bù lúc khởi động (TEST-158)

Mỗi lần `start` (chủ dự án chốt 2026-11-18), sau khi kiểm tra agent, runner gọi `Runner.catchUp` cho từng agent đang bật — chạy nền, không chặn listener: việc đang giao mà không có tin đánh thức (giao trước khi runner chạy, runner tắt quá 24 giờ, tin Telegram gửi lỗi) vẫn được làm.

1. MCP `list_my_tasks` → `pickStartupTasks` (`validator.ts`, hàm thuần) giữ việc `projectActive = true`, `waitingOn = 0`, `awaitingHuman = false`, theo thứ tự máy chủ trả (hạn). `awaitingHuman` = bot đã báo (chuyển / bình luận), chưa có người thật thao tác lại (`BotWaitRules`, TEST-157) — sau mỗi phiên runner đều bình luận kết quả nên việc vừa chạy (kể cả lỗi) không bị chạy lại tới khi người thật trả lời / trả việc.
2. Mỗi việc đi qua `accept()` như tin đánh thức: hỏi lại `get_task`, khoá theo id việc (đã có job chờ / chạy, tin Telegram tồn → gộp).
3. Rào chắn (`policy.ts`): tối đa `STARTUP_CATCHUP_MAX` = 20 việc / agent / lần khởi động (phần còn lại lần sau); khoá có job kết thúc trong `STARTUP_RECENT_JOB_MIN` = 10 phút → bỏ (`store.finishedSince`, chống khởi động lại liên tục). OfficeHub bản cũ không trả `awaitingHuman` / tool lỗi → bỏ qua cả bước, log `warn`, runner vẫn chạy.
4. Log một dòng `bắt bù lúc khởi động` mỗi agent: `open`, `queued`, `notQueued`, `recent`, `awaitingHuman`, `blocked`, `inactive`, `invalid`, `overLimit`.

Tắt: `runner.startup_catchup: false` hoặc `start --no-catchup`. Lệnh `run` / `doctor` / `report` / `usage push` không bắt bù. Điểm yếu đã chấp nhận: người thật bình luận không @nhắc vào việc đang chờ duyệt → lần khởi động sau bot mở một phiên đọc và trả lời. Test: `validator.test.ts`, `catchup.test.ts`, `flow.test.ts` (start → chạy, khởi động lại không chạy lại, hai cách tắt).

## Mode workspace

`workspace.mode` mỗi agent: `worktree` (mặc định, như trên) | `in_place` (commit thẳng vào nhánh đang checkout, runner push nhánh đó lên origin, không PR) | `none` (agent nghiệp vụ: không repo / git, chỉ tool MCP — TEST-80) — chi tiết, điều kiện từ chối, rủi ro `.env`: [agent-runner-workspace.md](agent-runner-workspace.md).

## Git (TEST-46)

- `git.executable` (tuỳ chọn, đường dẫn tuyệt đối; trống = `git` trong PATH). Mọi lệnh git của runner qua lớp `Git` (`workspace/git.ts`); CLI agent / `gh` / hook dùng đúng git đó (thư mục của nó đặt đầu PATH). Khởi động / `doctor` chạy `git --version`: sai → mọi agent tắt, không nhận việc.
- **Tài khoản git của máy:** runner không ghi đè `user.name` / `user.email`, không lưu token git; push dùng credential helper / SSH key (`SSH_AUTH_SOCK`) sẵn có trong HOME. `GIT_TERMINAL_PROMPT=0` → thiếu đăng nhập thì lỗi ngay, không treo hỏi mật khẩu. `doctor` ghi commit sẽ đứng tên ai; thiếu `user.name` / `user.email` → agent tắt.
- **Đánh dấu commit của bot:** hook `commit-msg` (cài cạnh `pre-push`) chỉ khi có `OFFICEHUB_AGENT` (runner đặt cho CLI agent) → thêm trailer `Agent: <mã NV>`, `Task: <mã việc>`; tác giả giữ nguyên; commit của người không bị đụng.
- **Quy tắc:** mỗi việc một worktree + nhánh; hook `pre-push` chặn main / master, **force push** (remote không phải tổ tiên) và nhánh chạm `agent-runner/`; runner push không bao giờ `--force`; prompt cấm `git add -A` / `git add .`, sửa git config / hook.

## Cấu hình

`agents.example.yaml` (file thật `chmod 600`, có token; `agent-runner/agents.yaml` + `/.officehub-runner/` trong `.gitignore`). Kiểm tra khi đọc: repo không nằm trong `worktrees_dir`, token `ohk_…`, username bot kết thúc `bot`, `bin` tuyệt đối…

## Lệnh (`agent-runner/`)

| Lệnh | Việc |
|---|---|
| `bun src/cli.ts doctor [--agent NV120] [--no-telegram] [--no-model-check]` | CLI `--version` + model thật (chạy thử), token đúng nhân viên, repo có origin, cài hook, bot Telegram (`getMe`), `gh auth status` |
| `bun src/cli.ts start [--no-model-check] [--no-catchup]` | Dịch vụ (systemd: `deploy/officehub-runner.service`); lúc khởi động bắt bù việc đang giao |
| `bun src/cli.ts run --agent NV120 --task TEST-45` | Chạy ngay một việc (bỏ qua Telegram, vẫn hỏi lại OfficeHub) |
| `bun src/cli.ts report [--days 1]` | Chi phí theo agent, theo loại job (token không cache / ghi / đọc cache, tỉ lệ đọc cache) và theo model |
| `bun src/cli.ts usage push [--since yyyy-MM-dd] [--agent NV018] [--dry-run]` | Gửi bù chi phí / token các phiên chưa gửi lên OfficeHub ("Mức dùng AI") — [agent-runner-usage.md](agent-runner-usage.md) |
| `bun run build` | Một file chạy `dist/officehub-runner` — build từ commit đã merge `main`, cài `/opt/officehub-runner/` |
| `bun run typecheck`, `bun test` | Bắt buộc khi đổi `agent-runner/` (CI job `agent-runner`) |
| `bun run format` | Định dạng `src/` + `tests/` bằng Biome (`biome.json`: rộng 120, nháy đơn); CI chạy `bun run format:check` |

Test: đơn vị (cấu hình, validator, adapter + mẫu stream-json, store, prompt, hook) + **tích hợp** `tests/flow.test.ts` (Telegram giả + MCP giả + CLI giả + repo bare: tin hợp lệ / giả mạo, worktree ngoài repo, push nhánh, bình luận chi phí, nối phiên, việc không còn giao, chạm `agent-runner/` → không push + hook chặn). Đã thử adapter `claude` với CLI thật (Haiku, có `--resume`).

## Chưa làm (bước sau của TEST-44)

Đã làm (TEST-135): **gửi mức dùng AI** sau mỗi phiên (`POST /mcp/usage`) + `usage push` gửi bù — [agent-runner-usage.md](agent-runner-usage.md). Chưa thử với OfficeHub thật.


Bắt bù tin @nhắc chat chưa đọc lúc khởi động (`list_chats` có `mentionedUnread`; hiện chỉ bắt bù việc). Đọc trường `event` / `comment_id` (OfficeHub đã gửi từ TEST-63: assigned / returned / mentioned — `mentioned` không bắt buộc việc giao cho bot, prompt chỉ trả lời bằng bình luận; cancelled → dừng phiên chưa có), HMAC tin, tổng kết chi phí hằng ngày vào nhóm, adapter `codex` / `gemini`, user Linux riêng từng agent, chỉ chạy khi người giao nằm trong danh sách cho phép (prompt injection).
