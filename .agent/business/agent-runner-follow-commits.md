# Agent-runner: bước theo dõi chờ commit của người làm có trên origin (TEST-225)

> Về [agent-runner-follow.md](agent-runner-follow.md) (job `follow`) · push sau phiên của người làm: [agent-runner-workspace.md](agent-runner-workspace.md). Chỉ áp dụng cho bot theo dõi mode `worktree` (công cụ `repo`).

**Vì sao**: người làm đổi cột TRONG phiên, runner của họ publish (push `in_place` / push + PR `worktree`) SAU phiên → bot theo dõi có thể được đánh thức trước khi commit lên origin (TEST-223: bot review fetch sớm ~30 giây, bình luận "KHÔNG REVIEW ĐƯỢC").

- Trước khi tạo worktree: `commitRefs` lấy hash commit trong **5 bình luận mới nhất không phải của chính agent** (`FOLLOW_COMMIT_COMMENTS`; tối đa 10 hash). Hash = chuỗi hex thường 7–40 ký tự đứng riêng (không dính chữ / số / `_` / `-` → loại đoạn UUID, tên nhánh, tên file), có cả chữ lẫn số (loại số token).
- `commitsMissingOnOrigin`: `git fetch origin` (mọi nhánh) rồi `git for-each-ref --contains=<hash> refs/remotes/origin`. Còn hash chưa nằm trong nhánh nào của origin → fetch lại mỗi `FOLLOW_COMMIT_POLL_SEC` (10 giây), tối đa `FOLLOW_COMMIT_WAIT_SEC` (180 giây) — `policy.ts`; test đổi qua `Runner.followCommitWait`.
- Đủ → chạy (đã chờ thì `get_task` + `checkFollow` lại: việc có thể đã sang cột khác). Hết trần → **vẫn chạy**, log `warn` (người làm "CHƯA push", hoặc chuỗi không phải commit) — agent báo theo hướng dẫn cột. Không có hash → không chờ. Fetch lỗi → không chờ (khâu tạo worktree báo lỗi lên việc).
- Runner dừng lúc đang chờ → `RunnerStopped` → job về hàng đợi. Nội dung bình luận chỉ dùng để tìm hash; hash là hex thuần nên an toàn làm tham số git.
- Agent `none` (shell / chỉ MCP) không chờ — không có repo để kiểm tra; hướng dẫn cột nên tự ghi bước thử lại.

Code: `awaitCommits` ở `src/jobs/follow.ts`, `commitRefs` ở `src/validator.ts`, `commitsMissingOnOrigin` ở `src/workspace/git.ts`. Test: `validator.test.ts` (`commitRefs`), `flow.test.ts` (chưa có trên origin → chưa chạy CLI; push lên → chạy; hết trần vẫn chạy; hash chỉ trong bình luận của chính agent → không chờ).

**Triển khai**: bot theo dõi chạy máy nào thì cập nhật mã runner + khởi động lại ở máy đó. Phòng thêm ở hướng dẫn cột (bot tự chờ 30 giây, fetch lại tối đa 3 lần) vì runner chỉ chờ được khi bình luận đã có hash.
