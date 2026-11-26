# Agent-runner: dọn dữ liệu việc đã xong khỏi máy (TEST-247)

> Về [agent-runner.md](agent-runner.md) · nối phiên / máy mới lấy nhánh từ origin: [agent-runner-workspace.md](agent-runner-workspace.md) · transcript trên cloud: [agent-transcripts.md](agent-transcripts.md)

Vấn đề: mỗi việc để lại trên máy worktree (kèm `node_modules`, `bin/obj`… — vài trăm MB tới vài GB), transcript CLI (`<HOME>/.claude/projects/<cwd>/<session>.jsonl` + thư mục `<session>/`, 10–40 MB / phiên), thư mục chạy `{data_dir}/work/…` và log `{data_dir}/jobs/{id}/` — trước đây giữ mãi.

## Khi nào dọn

Mã: `src/core/cleanup.ts` (`Cleaner`, `cleanupDue`). `start` chạy một lượt ở nền lúc khởi động rồi mỗi `CLEANUP_INTERVAL_MIN` = 360 phút; lệnh `cleanup [--agent NV] [--dry-run]` chạy tay (cả khi `enabled: false`).

Xét từng dòng `task_sessions` chưa dọn (`cleaned_at` trống), lần chạy cuối cách ≥ `after_done_hours`, khoá không còn job đang chờ / chạy, agent còn trong `agents.yaml`:
- **Việc / follow**: `get_task` (token của agent) → `task.done = true` → dọn. Lần chạy cuối cách ≥ `stale_days` → dọn luôn, không hỏi (việc bị bỏ / xoá / đổi người). `get_task` lỗi → để lượt sau. Tối đa `CLEANUP_MAX_TASK_CHECKS` = 50 lần hỏi / lượt.
- **Chat / họp**: quá `after_done_hours` là dọn (chỉ nối phiên trong ≤ 10 phút).
- **Log job**: thư mục `jobs/{id}` của job đã kết thúc quá `logs_keep_days` ngày.

## Chỉ xoá khi không mất gì — không đạt thì GIỮ (log + dòng `GIỮ` ở lệnh `cleanup`), lượt sau xét lại

- Transcript còn trong hàng chờ gửi cloud (`transcript_pending = 1`, agent có bộ gửi transcript).
- Worktree việc (không phải `FOLLOW-…`): còn thay đổi chưa commit (`git status --porcelain`, file bị ignore như `node_modules` không tính) hoặc commit chưa có ở nhánh nào của origin (`rev-list HEAD --not --remotes=origin`). Worktree theo dõi chỉ đọc → bỏ qua kiểm tra.
- Lỗi git / xoá lỗi → giữ, không đánh dấu.
- Ngay trước khi xoá kiểm tra lại khoá có job mới không.

## Xoá gì

| Nơi chạy (`task_sessions.worktree`) | Xoá |
|---|---|
| Dưới `worktrees_dir` | `git worktree remove --force` + `git branch -D` nhánh việc (lấy lại từ origin — `prepareWorktree` `existing: 'origin'`) + cả thư mục transcript của cwd (`Adapter.cwdPaths`) |
| Dưới `{data_dir}/work` (mode none, chat, họp) | Thư mục chạy + cả thư mục transcript của cwd |
| Nơi khác (mode `in_place` = repo dùng chung với người) | **Chỉ** transcript của các phiên runner (`Adapter.sessionPaths` cho mọi `jobs.session_id` của khoá); repo + phiên Claude Code của người không đụng |

Adapter không khai `sessionPaths` / `cwdPaths` (codex, cursor, antigravity, custom) → không xoá file của CLI, chỉ worktree / thư mục chạy / log.

Sau khi xoá: `task_sessions.session_id = NULL`, `cleaned_at = now` (migration 3 của `runner.db`). Việc mở lại → phiên mới chế độ "ĐÃ TỪNG LÀM" (Bàn giao + nhánh từ origin), `saveSession` xoá `cleaned_at`.

## Cấu hình (`runner.cleanup`, tuỳ chọn)

```yaml
runner:
  cleanup:
    enabled: true          # false = không dọn theo nhịp
    after_done_hours: 24   # 0–2160: chờ sau lần chạy cuối (việc bị mở lại ngay vẫn còn worktree)
    stale_days: 30         # 1–365: việc chưa Xong mà không chạy ngần này ngày cũng dọn
    logs_keep_days: 14     # 1–365: giữ log job
```

Điểm yếu đã chấp nhận: job được nhận đúng lúc đang `git worktree remove` (sau lần kiểm tra lại) — cửa sổ rất nhỏ, việc đã Xong; `prepareWorktree` tạo lại từ origin. Phiên Claude Code người tự mở không thuộc runner — dọn bằng `cleanupPeriodDays` trong `~/.claude/settings.json`.

Test: `tests/cleanup.test.ts` (repo git thật + origin bare: dry-run, xoá worktree + nhánh + transcript, giữ khi chưa push / dirty / transcript chờ gửi / job đang chờ, in_place chỉ xoá phiên runner, chat, stale, log, cấu hình).
