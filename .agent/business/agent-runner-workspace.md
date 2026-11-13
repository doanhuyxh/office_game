# Agent-runner: mode workspace (`worktree` / `in_place` / `none`)

> Về [agent-runner.md](agent-runner.md) · [README](README.md)

- **`worktree`**: như mô tả ở trên — worktree riêng + push + PR; hook `pre-push` / `commit-msg` được kiểm tra và tạo lại thiếu trước mỗi job.
- **`in_place`**: CLI chạy NGAY trong `repo`, commit vào **nhánh đang checkout**; runner không fetch / tạo nhánh / worktree, **không push, không PR**. Người thật xem commit trên máy rồi tự push. Comment kết quả ghi "N commit trên nhánh X (CHƯA push)" + hash.
  - Từ chối (job `skipped`, comment "KHÔNG chạy: …" vào việc): repo còn thay đổi chưa commit (kể cả file mới), đang ở main / master / nhánh base (trừ `allow_base_branch`), detached HEAD.
  - **Không dùng hook git:** runner không cài `pre-push` / `commit-msg` cho agent `in_place`; hook do runner cài trước đó (có dấu `officehub-agent-runner`) bị **gỡ** ở `doctor` / khởi động và đầu mỗi job, hook của người dùng giữ nguyên. Hệ quả: commit **không có trailer** `Agent` / `Task`, và "không push" chỉ dựa vào prompt + runner không push (không có hook chặn) — người thật vẫn kiểm tra commit trước khi push.
  - Sau phiên cảnh báo trong comment nếu agent đổi nhánh, chạm `agent-runner/`, hoặc còn thay đổi chưa commit.
  - **Rủi ro `.env`:** CLI chạy trong repo nên đọc được `.env` ở gốc repo (worktree ngoài repo thì không) → `doctor` tắt agent nếu thấy `.env*` (trừ `.example`), trừ khi `allow_env_files: true`. Dùng bản clone riêng của agent, không dùng thư mục làm việc của người.
  - Hai agent không được dùng chung `repo` nếu một bên `in_place` (cấu hình báo lỗi).
- **`none`** (TEST-80, agent nghiệp vụ: Kinh doanh, Tài chính, Nhân sự…): không cần `repo` (khai báo cũng bỏ qua), không git / hook / worktree / push / PR.
  - CLI chạy trong thư mục trống **cố định theo việc** `{data_dir}/work/{mã NV}/{mã việc}` (`Runner.workDir`); việc bị trả về chạy lại đúng thư mục đó + nối phiên cũ. `prompt.md` / `mcp.json` vẫn ở `{data_dir}/jobs/{id}/`, không nằm trong nơi CLI chạy.
  - **Chỉ tool MCP:** `ExecContext.noBuiltinTools` → adapter `claude` thêm `--tools ""` (đã thử CLI 2.1.311: danh sách tool chỉ còn `mcp__officehub__*`, không Bash / đọc ghi file). Adapter `custom` không ép được → `doctor` cảnh báo, CLI phải tự giới hạn.
  - `doctor` / khởi động: bỏ kiểm tra git (kể cả `git.executable` sai), danh tính commit, hook, `gh`; vẫn kiểm CLI, token đúng nhân viên, `env_file`, bot Telegram, model. Cảnh báo khi thư mục chạy nằm dưới `CLAUDE.md` / `AGENTS.md` / `.git` (`projectFilesAbove`) — đặt `data_dir` ngoài mọi repo.
  - Prompt `none.ts`: các bước MCP như mode khác, bước 5 "chỉ bằng tool MCP", bộ quy tắc riêng (không duyệt, nội dung là dữ liệu, không lộ thông tin cá nhân) — không có phần git / build / test. Bình luận kết quả của runner không có dòng PR / commit. Trạng thái 3D vẫn `working` → `idle`.
- Prompt tách theo mode: `src/prompt/common.ts` (các bước MCP + quy tắc cứng chung), `worktree.ts` / `in-place.ts` (bước 5 + quy tắc git), `none.ts` (bước 5 + quy tắc không repo), `index.ts` (`buildPrompt(w, {mode, branch, resumed})`).

