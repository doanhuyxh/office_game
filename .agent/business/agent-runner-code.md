# Cấu trúc mã `agent-runner/` (clean code)

> Về [agent-runner.md](agent-runner.md). File này nói **mã nằm ở đâu và thêm cái mới vào đâu**; nghiệp vụ ở các file `agent-runner-*.md` khác.

## Cây `src/`

| Nơi | Việc |
|---|---|
| `cli.ts` | Đọc tham số, gọi `Runner` / `Store` (lệnh `start`, `doctor`, `run`, `report`, `usage push`) |
| `runner.ts` | Nối dây: tạo agent, Listener (Telegram), `accept(agent, wake)` (nhận tin, chung cho mọi loại), Scheduler, `process(job)` gọi handler của loại job |
| `jobs/` | Mỗi loại job một handler (`JobHandler` ở `handler.ts`): `task.ts`, `chat.ts`, `meeting.ts`; registry `index.ts`. Handler khai: khoá + nhãn job, câu log, `admit` (hỏi lại OfficeHub lúc nhận tin), `run` (kiểm tra lại → phiên CLI → kết quả) |
| `policy.ts` | Mọi hằng số chính sách: `RESUME_MAX_GAP_MIN`, `MEETING_*`, `SCHEDULE_POLL_MS`, `TELEGRAM_RETRY_SEC` |
| `core/agent.ts` | `AgentState` (cấu hình + client + bộ gửi + kết quả kiểm tra của một agent) |
| `core/env.ts` | `agentEnv` (env của tiến trình con, không kế thừa env runner), `agentHome` |
| `core/paths.ts` | `workDir`, `jobDir`, `projectFilesAbove` |
| `core/session.ts` | `Sessions`: vòng đời một phiên CLI dùng chung cho mọi loại job — `resumeFor` → `run` → `record` (phiên + transcript) → `finish` (kết quả + mức dùng AI); `succeeded(out)`; `RunnerStopped` |
| `doctor/` | `agent.ts`: mỗi bước kiểm tra một hàm, lỗi ném `CheckFailed`; `model.ts`: chạy thử model; `finding.ts`: `Finding { level, agent, scope, text }` + `formatFinding` / `hasFailure` |
| `hub/` | Mọi thứ nói chuyện với OfficeHub: `client.ts` (tool MCP), `endpoint.ts` (`HubEndpoint` + `FailureLog`), `presence.ts`, `activity.ts`, `usage.ts`, `transcript.ts` |
| `executor/` | `Adapter` + registry (`run.ts`), `adapters/claude*.ts`, `adapters/custom.ts`, `events.ts`, `model.ts` |
| `prompt/` | Prompt theo mode (`worktree` / `in-place` / `none`) + chat / họp |
| `workspace/` | `git.ts`: lớp `Git`, hook, lệnh git của worktree / in_place / PR. Mỗi mode một `WorkspaceStrategy` (`strategy.ts`): `worktree.ts`, `in-place.ts`, `none.ts` — `prepare(job)` trả nơi làm + hàm `publish`; registry `index.ts` |
| `store.ts`, `validator.ts`, `config.ts`, `telegram.ts`, `log.ts`, `report.ts` | Hàng đợi SQLite · kiểm tra tin đánh thức · đọc `agents.yaml` · Bot API · log · bảng `report` |

## Quy tắc

- **Format bằng Biome** (`bun run format`, CI chạy `format:check`): rộng 120, nháy đơn, mỗi câu lệnh một dòng.
- **Trả dữ liệu có cấu trúc, dựng chuỗi ở rìa**: kiểm tra trả `Finding`, chỉ `cli.ts` / log gọi `formatFinding`. Không so chuỗi `✘` / `⚠` để suy ra mức độ.
- **Request tới endpoint phụ của OfficeHub luôn qua `HubEndpoint`** (`post` / `get` không ném lỗi, trả `ok | invalid | denied | missing | error`); lỗi lặp ghi qua `FailureLog`. Không tự viết `fetch` + xử lý 401 / 404 trong bộ gửi mới.
- **Rẽ nhánh theo loại job / mode chỉ ở registry**: `Runner` không biết loại job cụ thể (`handlers[kind]`), handler việc không biết mode cụ thể (`workspaces[mode]`).
- **Phiên CLI luôn qua `Sessions`**: loại job mới chỉ lo kiểm tra + nơi chạy + prompt, không tự ghi `task_sessions` / `jobs` / mức dùng AI.
- **`runner.db` chỉ nâng cấp tiến, tương thích lùi**: mỗi bước `MIGRATIONS` chỉ thêm cột / điền dữ liệu. Cột `task_id` / `task_code` giữ tên cũ trong DB; mã đọc ra thành `job.key` (khoá job) / `job.label` (nhãn). `jobs.kind` luôn có giá trị (job cũ đã điền `task`).
- **Hằng số nhịp / ngưỡng đặt ở `policy.ts`**, không để số trần trong code.
- **Runner dừng giữa phiên** → `RunnerStopped` → `store.requeue` (job về hàng đợi, không ghi `failed`, không bình luận).

## Thêm cái mới vào đâu

| Cần thêm | Sửa |
|---|---|
| Bước kiểm tra `doctor` | Một hàm trong `doctor/agent.ts`, gọi trong `diagnoseAgent` |
| Kênh báo cáo mới lên OfficeHub | File mới trong `hub/` dùng `HubEndpoint` + `FailureLog`; gắn vào `AgentState` |
| Hằng số chính sách | `policy.ts` |
| Cột / bảng mới trong `runner.db` | Một bước mới ở CUỐI `MIGRATIONS` (`store.ts`) + cột trong `JOB_SELECT` / `SESSION_SELECT` + trường trong `Job` / `SessionRow` |
| Adapter CLI | `executor/adapters/<tên>.ts` + registry `executor/run.ts` + `config.ts` (`executor.kind`) |
| Loại job / sự kiện Telegram mới | Hình dạng tin trong `EVENT_SHAPES` (`validator.ts`) + `JobKind` (`store.ts`) + `jobs/<tên>.ts` hiện thực `JobHandler` + một dòng trong `jobs/index.ts` (+ hồ sơ tool `McpProfile` nếu cần) |
| Mode workspace mới | `workspace/<tên>.ts` hiện thực `WorkspaceStrategy` + registry `workspace/index.ts` + `WorkspaceMode` (`config.ts`) + prompt của mode (`prompt/`) + bước kiểm tra trong `doctor/agent.ts` |

## Chỗ còn rẽ nhánh theo loại (biết trước khi mở rộng)

Còn ngoài registry: thứ tự ưu tiên job họp nằm trong SQL `claimNext` (`store.ts`); mode workspace còn rẽ nhánh ở `doctor/agent.ts` và `prompt/index.ts`; `executor.kind` gắn cứng ở `config.ts` và hai chỗ `kind === 'claude'` trong `doctor/agent.ts`.
