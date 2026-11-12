# Agent-runner: mode workspace (`worktree` / `in_place`)

> Về [agent-runner.md](agent-runner.md) · [README](README.md)

- **`worktree`**: như mô tả ở trên — worktree riêng + push + PR; hook `pre-push` / `commit-msg` được kiểm tra và tạo lại thiếu trước mỗi job.
- **`in_place`**: CLI chạy NGAY trong `repo`, commit vào **nhánh đang checkout**; runner không fetch / tạo nhánh / worktree, **không push, không PR**. Người thật xem commit trên máy rồi tự push. Comment kết quả ghi "N commit trên nhánh X (CHƯA push)" + hash.
  - Từ chối (job `skipped`, comment "KHÔNG chạy: …" vào việc): repo còn thay đổi chưa commit (kể cả file mới), đang ở main / master / nhánh base (trừ `allow_base_branch`), detached HEAD.
  - **Không dùng hook git:** runner không cài `pre-push` / `commit-msg` cho agent `in_place`; hook do runner cài trước đó (có dấu `officehub-agent-runner`) bị **gỡ** ở `doctor` / khởi động và đầu mỗi job, hook của người dùng giữ nguyên. Hệ quả: commit **không có trailer** `Agent` / `Task`, và "không push" chỉ dựa vào prompt + runner không push (không có hook chặn) — người thật vẫn kiểm tra commit trước khi push.
  - Sau phiên cảnh báo trong comment nếu agent đổi nhánh, chạm `agent-runner/`, hoặc còn thay đổi chưa commit.
  - **Rủi ro `.env`:** CLI chạy trong repo nên đọc được `.env` ở gốc repo (worktree ngoài repo thì không) → `doctor` tắt agent nếu thấy `.env*` (trừ `.example`), trừ khi `allow_env_files: true`. Dùng bản clone riêng của agent, không dùng thư mục làm việc của người.
  - Hai agent không được dùng chung `repo` nếu một bên `in_place` (cấu hình báo lỗi).
- Prompt tách theo mode: `src/prompt/common.ts` (các bước MCP + quy tắc cứng chung), `worktree.ts` / `in-place.ts` (bước 5 + quy tắc git), `index.ts` (`buildPrompt(w, {mode, branch, resumed})`).

