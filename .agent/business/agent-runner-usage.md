# agent-runner: gửi mức dùng AI lên OfficeHub (TEST-135)

> Về [agent-runner.md](agent-runner.md) · [README](README.md) · phía máy chủ (hợp đồng, lưu, API đọc, giao diện): [ai-usage.md](ai-usage.md) · model thật: [agent-runner-model.md](agent-runner-model.md)

Code: `agent-runner/src/hub/usage.ts` (dựng phiên + `UsageReporter`), `store.ts` (cột, hàng chờ), `core/session.ts` (`Sessions.finish`), `runner.ts` (nhịp gửi lại), `commands/usage-push.ts` (`usage push`). Test: `tests/usage.test.ts`, phần usage trong `flow.test.ts` / `meeting.test.ts`.

## Khi nào gửi

- **Sau mỗi phiên CLI**, mọi loại job (việc / chat / họp), cả thành công lẫn lỗi (`Sessions.finish` ghi `jobs.cli_ran = 1` rồi gọi `UsageReporter.flush()` ở nền — job không chờ, lỗi chỉ log).
- Job **không chạy CLI** (bỏ qua ở bước kiểm tra lại, workspace chưa sẵn sàng, lỗi trước khi chạy) → không gửi (`cli_ran` null).
- Khởi động runner + mỗi **5 phút** (`USAGE_RETRY_MS`): gửi lại phiên chưa gửi (máy chủ tạm lỗi / chưa deploy bản có `/mcp/usage`).
- Mỗi agent một `UsageReporter` (token AI riêng — Mcp gắn `userId` theo token, chỉ tài khoản bot). Lô ≤ 50 phiên, theo id job tăng dần; gọi chồng nhau (nhiều phiên xong cùng lúc) → chờ lượt đang gửi rồi gửi thêm một lượt, không gửi trùng.

## Body (`POST <mcp_url>/usage`, hợp đồng `AiUsageSession`)

| Trường | Lấy từ |
|---|---|
| `sourceId` | `<tên máy ≤ 40, bỏ ":">:<mã runner.db 8 hex>:<mã NV>:<id job>` — mã DB (bảng `meta.db_id`, tạo một lần) để máy bị xoá / DB mới đếm job lại từ 1 không ghi đè phiên cũ (lệch nhẹ so với mô tả việc `<máy>:<NV>:<jobId>`, có chủ ý) |
| `kind` | `jobs.kind` (null = `task`) |
| `taskId` / `projectId` / `taskCode` | chỉ job việc (GUID hợp lệ; mã việc ≤ 50). Chat / họp: không gửi (`task_id` là khoá `<NV>:<id>`, `task_code` là nhãn log) |
| `executor` | `jobs.executor` (`claude` / `custom`); job cũ → kind trong cấu hình agent hiện tại |
| `status` | `done` / `failed` |
| `startedAt` / `finishedAt` | `jobs.started_at` (lúc lấy job ra chạy, gồm chuẩn bị worktree) / `finished_at`, ISO UTC |
| `turns`, `costUsd` | `jobs.turns`, `jobs.cost_usd` — không có → **null**, không gửi 0 |
| `models[]` | `model_usage` (mỗi model một dòng, ≤ 20); không có → một dòng = `jobs.model` (bỏ hậu tố " (cấu hình)") với số tổng của phiên; không rõ model → bỏ trường (máy chủ ghi "không rõ") |

**Token cache**: adapter `claude` đọc `cache_read_input_tokens` / `cache_creation_input_tokens` (sự kiện `result`) và `cacheReadInputTokens` / `cacheCreationInputTokens` (`modelUsage`) → `jobs.cache_read_tokens` / `cache_write_tokens`, `ModelUse.cacheReadTokens` / `cacheWriteTokens`. `input_tokens` trong `runner.db` vẫn là **tổng gồm cache** (như `report` / bình luận cũ); lúc gửi `inputTokens` = tổng − đọc − ghi cache. CLI không báo cache (adapter `custom`, job trước TEST-135) → `inputTokens` = tổng, cache null. `readModelUsage` không có trường token nào → `inputTokens` undefined (trước là 0).

## Phản hồi

| Mã | Runner làm |
|---|---|
| 200 | `jobs.usage_sent_at` = giờ gửi; log `đã gửi mức dùng AI` (created / updated) |
| 400 / 413 | Gửi lại **từng phiên**; phiên vẫn 400 → `jobs.usage_error` (câu `detail` của máy chủ), runner không tự gửi lại — `usage push` thử lại |
| 401 / 403 | Ngừng gửi cho agent đó tới khi khởi động lại (token sai / tài khoản chưa được HR đánh dấu bot), log một lần |
| 404 / 405 | Máy chủ chưa có `/mcp/usage` (chưa deploy / nginx chưa chuyển tiếp) → giữ phiên, thử lại theo nhịp, log một lần |
| Khác / mạng | Giữ phiên, thử lại theo nhịp; lỗi giống lần trước không ghi lại |

## `runner.db`

Cột thêm bằng `ALTER TABLE` lúc mở `Store`: `cache_read_tokens`, `cache_write_tokens`, `executor`, `cli_ran`, `usage_sent_at`, `usage_error`; bảng `meta` (`db_id`); index `ix_jobs_usage_pending`. Lần nâng cấp đầu: job cũ có dấu hiệu đã chạy CLI (`done` / `failed`, có `session_id` / `model` / `cost_usd` / `turns` / `input_tokens`) → `cli_ran = 2` = **chỉ gửi bằng `usage push`** (runner không tự gửi lịch sử khi vừa cập nhật).

## Gửi bù: `usage push`

```bash
bun src/cli.ts usage push [--since 2026-11-01] [--agent NV018] [--dry-run] --config /etc/officehub-runner/agents.yaml
```

- Gửi mọi phiên chưa gửi: job cũ (`cli_ran = 2`), phiên chưa gửi được, phiên từng bị từ chối. `--since` = ngày xong theo giờ VN.
- `--dry-run`: mỗi agent một dòng — số phiên, khoảng ngày, tổng chi phí, số phiên không có chi phí, URL sẽ gửi. Không gọi mạng.
- Agent có phiên nhưng không còn trong cấu hình (không có token) → bỏ qua, in một dòng.
- Máy chủ upsert theo `sourceId` → chạy lại an toàn (không đếm hai lần). Có phiên bị từ chối / dừng giữa chừng → mã thoát 1.
- Chạy song song với runner đang chạy được (SQLite WAL); trùng thì máy chủ cập nhật.

`report` và bình luận chi phí vào việc (`resultComment`) giữ nguyên.

## Chưa làm

Chưa chạy thật với OfficeHub (Api + Mcp trên DB tạm hoặc production): một job việc + một lượt chat → hiện ở "Mức dùng AI"; `usage push --since` gửi bù, tổng khớp `report`. Thêm bước chạy runner với CLI giả vào `scripts/dev/ai-usage-flow-e2e.ts` ([ai-usage.md](ai-usage.md#kiểm-tra)).
