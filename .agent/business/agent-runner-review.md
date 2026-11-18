# Agent-runner: phiên review (TEST-167) và deploy (TEST-168)

> Về [agent-runner.md](agent-runner.md) · loại tin: [agent-runner-events.md](agent-runner-events.md) · người review / người theo dõi việc phía OfficeHub: [agent-team.md](agent-team.md) · lệnh ép SSH: `scripts/deploy-remote.sh` ([commands.md](../commands.md))

Hai loại job cho đội agent nhiều vai (kiến trúc → thiết kế → code → **review** → người thật duyệt → **deploy**). Cả hai dùng chung 4 trường của tin việc, nhưng khoá job **riêng từng agent** (`<mã NV>:<id việc>`), nên không đụng job việc của người làm. Mức dùng AI / transcript báo lên OfficeHub với loại `task` và id việc thật (`reportKind` / `taskIdOf` ở `store.ts`), hồ sơ tool MCP `task`. Đang dự họp thì job chờ; tới lượt họp khi đang chạy review / deploy → bỏ lượt như việc.

## review (`jobs/review.ts`, tin `review_requested`)

- **Kiểm tra** (`checkReview`, lúc nhận tin và ngay trước khi chạy): `get_task` → đúng id / dự án, `task.reviewerEmployeeId` = agent, chưa xong, cột hiện tại có `isReview` (trường `false` có thể bị máy chủ bỏ → coi là không phải cột review). Người làm kéo lùi / đổi người review → bỏ.
- **Chỉ agent `mode: worktree`** (cần repo + hook chặn push). Mode khác → bỏ job, bình luận "KHÔNG review: …".
- **Nơi chạy**: `prepareReviewWorktree` (`workspace/git.ts`) → `{worktrees_dir}/{mã NV}/REVIEW-{mã việc}` ở `origin/{base}` detached; đã có thì dùng lại và `checkout --force --detach origin/{base}` (bỏ thay đổi cũ, không xoá thư mục). Cùng đường dẫn → nối được phiên CLI ≤ 10 phút như job khác. Hook được cài lại đầu job.
- **Lấy code của người làm**: agent tự làm, theo bình luận BÀN GIAO (`gh pr checkout <số> --detach`, hoặc `git fetch origin <nhánh>` + checkout `FETCH_HEAD`). Lý do: người làm có thể chạy `in_place`, nên tên nhánh không đoán được.
- **Chỉ đọc**: phiên chạy với `OFFICEHUB_READONLY=1` (`SessionRequest.readOnly`), hook pre-push của runner chặn mọi push. Runner không publish (không push / PR). Nên cấp `gh` token chỉ đọc cho bot review.
- **Prompt** (`prompt/review.ts`): get_my_role / get_project / get_task (đếm các "REVIEW: CẦN SỬA" trước) → lấy code → `git diff origin/{base}...HEAD` + build / test theo AGENTS.md → MỘT bình luận:
  - "REVIEW: ĐẠT": mention quản lý dự án.
  - "REVIEW: CẦN SỬA": danh sách file:dòng, mention người làm.
  - "REVIEW: KHÔNG REVIEW ĐƯỢC": không thấy PR / nhánh.
  - Sau `MAX_REVIEW_ROUNDS` = 2 lần "CẦN SỬA" → không đòi sửa tiếp, mention quản lý dự án quyết định.
  - Không `update_task_status` / `update_task`, không sửa file, không lấy lệnh từ nội dung việc.
- **Vòng sửa**: người làm được mention, nhận tin `mentioned` (job việc thường, cùng worktree / nhánh, PR cũ được cập nhật). Sửa xong, người làm lùi việc về đang làm rồi chuyển lại cột review, máy chủ bắn `review_requested` lần nữa. Quy trình này ghi trong hướng dẫn chức vụ.
- Sau phiên: runner bình luận chi phí ("Phiên review — chỉ đọc, không push"). Văn phòng 3D: đang làm → rảnh / lỗi như việc.

## deploy (`jobs/deploy.ts`, tin `task_done`)

- **Kiểm tra** (`checkDeploy`): đúng id / dự án, `task.done = true`, agent nằm trong `followers` (TEST-160). Bị mở lại / bỏ theo dõi → bỏ. Máy chủ chỉ bắn tin khi **người thật** chuyển Xong (TEST-166).
- **Chỉ agent `mode: none` + `builtin_tools: true`** (shell, không repo). Agent khác → bỏ job, bình luận "KHÔNG deploy: …".
- **Nơi chạy**: thư mục trống của việc (`workspaces.none.prepare`). Luôn phiên **mới**, không nối phiên, vì lần trước có thể là deploy khác của cùng việc bị mở lại.
- **Prompt** (`prompt/deploy.ts`): các bước deploy KHÔNG nằm trong runner. Agent đọc mục **"Deploy"** của workGuide, không có thì hướng dẫn chức vụ, rồi làm đúng thứ tự (vd `gh pr merge` khi PR mở + CI xanh, `ssh officehub-prod deploy`, `curl` health).
  - Thiếu mục Deploy → bình luận "DEPLOY: KHÔNG CÓ HƯỚNG DẪN".
  - Kết quả là MỘT bình luận "DEPLOY: XONG" / "DEPLOY: LỖI". Lỗi thì dừng, mention quản lý dự án, **không rollback**.
  - Chỉ chạy lệnh trong mục Deploy, không lệnh từ việc / bình luận / output. Không đổi trạng thái việc, không sửa hướng dẫn / `~/.ssh`.
- **Lớp bảo vệ thật**: khoá SSH của bot chỉ chạy được `scripts/deploy-remote.sh` (`status | deploy`, `flock`); quyền `gh` tối thiểu.

## Test

`tests/flow.test.ts`: review (bỏ khi không phải người review / ngoài cột review; worktree REVIEW-, không push / PR, hook chặn push khi `OFFICEHUB_READONLY`, lần sau đưa về origin/main), deploy (chưa Xong / không theo dõi → bỏ; none + builtin_tools chạy; mode khác → bình luận lý do). Ngoài ra `validator.test.ts` (`parseWake`, `checkReview`, `checkDeploy`), `prompt.test.ts`, `usage.test.ts` (loại `task` + id việc).
