# Cấu trúc mã `agent-runner/` (clean code)

> Về [agent-runner.md](agent-runner.md). File này nói **mã nằm ở đâu và thêm cái mới vào đâu**; nghiệp vụ ở các file `agent-runner-*.md` khác.

## Cây `src/`

| Nơi | Việc |
|---|---|
| `cli.ts` | Đọc tham số, gọi `Runner` / `Store` (lệnh `start`, `doctor`, `run`, `report`, `usage push`) |
| `runner.ts` | Nối dây: tạo agent, Listener (Telegram), nhận tin (`accept*`), Scheduler, xử lý từng loại job (`processTask` / `processChat` / `processMeeting`) |
| `policy.ts` | Mọi hằng số chính sách: `RESUME_MAX_GAP_MIN`, `MEETING_*`, `SCHEDULE_POLL_MS`, `TELEGRAM_RETRY_SEC` |
| `core/agent.ts` | `AgentState` (cấu hình + client + bộ gửi + kết quả kiểm tra của một agent) |
| `core/env.ts` | `agentEnv` (env của tiến trình con, không kế thừa env runner), `agentHome` |
| `core/paths.ts` | `workDir`, `jobDir`, `projectFilesAbove` |
| `core/session.ts` | `Sessions`: vòng đời một phiên CLI dùng chung cho mọi loại job — `resumeFor` → `run` → `record` (phiên + transcript) → `finish` (kết quả + mức dùng AI); `succeeded(out)`; `RunnerStopped` |
| `doctor/` | `agent.ts`: mỗi bước kiểm tra một hàm, lỗi ném `CheckFailed`; `model.ts`: chạy thử model; `finding.ts`: `Finding { level, agent, scope, text }` + `formatFinding` / `hasFailure` |
| `hub/` | Mọi thứ nói chuyện với OfficeHub: `client.ts` (tool MCP), `endpoint.ts` (`HubEndpoint` + `FailureLog`), `presence.ts`, `activity.ts`, `usage.ts`, `transcript.ts` |
| `executor/` | `Adapter` + registry (`run.ts`), `adapters/claude*.ts`, `adapters/custom.ts`, `events.ts`, `model.ts` |
| `prompt/` | Prompt theo mode (`worktree` / `in-place` / `none`) + chat / họp |
| `workspace.ts` | Lớp `Git`, hook, worktree / in_place, publish |
| `store.ts`, `validator.ts`, `config.ts`, `telegram.ts`, `log.ts`, `report.ts` | Hàng đợi SQLite · kiểm tra tin đánh thức · đọc `agents.yaml` · Bot API · log · bảng `report` |

## Quy tắc

- **Format bằng Biome** (`bun run format`, CI chạy `format:check`): rộng 120, nháy đơn, mỗi câu lệnh một dòng.
- **Trả dữ liệu có cấu trúc, dựng chuỗi ở rìa**: kiểm tra trả `Finding`, chỉ `cli.ts` / log gọi `formatFinding`. Không so chuỗi `✘` / `⚠` để suy ra mức độ.
- **Request tới endpoint phụ của OfficeHub luôn qua `HubEndpoint`** (`post` / `get` không ném lỗi, trả `ok | invalid | denied | missing | error`); lỗi lặp ghi qua `FailureLog`. Không tự viết `fetch` + xử lý 401 / 404 trong bộ gửi mới.
- **Phiên CLI luôn qua `Sessions`**: loại job mới chỉ lo kiểm tra + nơi chạy + prompt, không tự ghi `task_sessions` / `jobs` / mức dùng AI.
- **Hằng số nhịp / ngưỡng đặt ở `policy.ts`**, không để số trần trong code.
- **Runner dừng giữa phiên** → `RunnerStopped` → `store.requeue` (job về hàng đợi, không ghi `failed`, không bình luận).

## Thêm cái mới vào đâu

| Cần thêm | Sửa |
|---|---|
| Bước kiểm tra `doctor` | Một hàm trong `doctor/agent.ts`, gọi trong `diagnoseAgent` |
| Kênh báo cáo mới lên OfficeHub | File mới trong `hub/` dùng `HubEndpoint` + `FailureLog`; gắn vào `AgentState` |
| Hằng số chính sách | `policy.ts` |
| Adapter CLI | `executor/adapters/<tên>.ts` + registry `executor/run.ts` + `config.ts` (`executor.kind`) |

## Chỗ còn rẽ nhánh theo loại (biết trước khi mở rộng)

Loại job (`kind`) còn rẽ nhánh ở `runner.ts`, `validator.ts`, `store.ts`; mode workspace ở `runner.ts`, `doctor/agent.ts`, `prompt/`; `executor.kind` gắn cứng ở `config.ts`. Thêm loại job / mode / adapter mới hiện phải sửa các nơi đó.
