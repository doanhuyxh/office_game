# Agent-runner: một agent làm nhiều dự án (`projects`, TEST-200)

> Về [agent-runner.md](agent-runner.md) · mode workspace: [agent-runner-workspace.md](agent-runner-workspace.md)

Một agent (một mã NV, một bot Telegram, một token AI) nhận việc của **nhiều dự án OfficeHub**, mỗi dự án một repo / nhánh gốc / mode riêng. Runner chọn nơi làm theo `project_id` của tin đánh thức — không cần tạo mỗi repo một tài khoản agent.

**Repo chỉ khai theo dự án** (chủ dự án chốt 2026-11-21): `repo` ở cấp agent đã bỏ — `agents.yaml` cũ báo lỗi cấu hình kèm cách chuyển (`agents[i].repo không còn dùng — chuyển vào agents[i].projects`). Mọi máy chạy runner phải sửa `agents.yaml` khi cập nhật bản này.

## Cấu hình

```yaml
agents:
  - employee_code: NV120
    executor: { … }                     # dùng chung mọi dự án
    # workspace ở cấp agent: tuỳ chọn — mặc định cho các mục projects không khai; base_branch KHÔNG khai ở cấp agent
    projects:                           # BẮT BUỘC với agent có repo, ít nhất một mục
      - project: OFFICE                 # mã dự án trên OfficeHub
        repo: /srv/agents/NV120/office_game
        base_branch: developer
      - project: SHOP
        repo: /srv/agents/NV120/shop
        workspace: { mode: in_place }
```

- Agent có repo (mode `worktree` / `in_place`) **bắt buộc** có `projects` (≥ 1 mục). Việc của dự án không khai → không chạy.
- Agent nghiệp vụ (`workspace.mode: none` ở cấp agent) không có `projects` / repo, nhận việc của **mọi** dự án như trước.
- Mỗi mục: `project` bắt buộc, không trùng trong cùng agent (không phân biệt hoa thường); `repo` tuyệt đối, ngoài `worktrees_dir`; `base_branch` không khai → `runner.base_branch` (nhánh gốc đi theo dự án: khai `base_branch` ở cấp agent → lỗi cấu hình); `workspace` không khai → theo cấp agent, **có khai thì thay cả mục** (cờ không ghi = false, `mode` không ghi = worktree).
- Lỗi cấu hình: `workspace.mode: none` ở cấp agent mà khai `projects`; mục `projects` có mode `none`; repo `in_place` bị dùng chung — xét trên từng cặp (agent, dự án), kể cả hai mục của cùng một agent. Worktree dùng chung repo thì được.

## Runner chọn nơi làm thế nào

- `workspaceFor(agent, projectId)` (`config.ts`) là nơi DUY NHẤT trả repo / nhánh gốc / mode cho một job: mục `projects` của dự án; agent mode none → nơi làm không repo cho mọi dự án (`defaultWorkspace`); còn lại `null` (dự án không khai, chưa đổi được id, đang tắt). **Không đọc thẳng `cfg.workspace` lúc chạy job** (`AgentConfig` không còn `repo` / `baseBranch`).
- **Đổi mã → id** (`doctor/agent.ts` `resolveProjects`, lúc khởi động / `doctor` / `run`): MCP `get_project(<mã>)` lấy `project.id`, ghi vào `ProjectWorkspace.projectId`. Mã không thấy, agent không xem được, `canWork = false` (không phải thành viên) → dòng `⚠ NV120 (dự án X): … dự án TẮT`, ghi `problem` vào mục; **agent vẫn chạy** các dự án khác. Sửa xong phải khởi động lại runner.
- **Kiểm tra git theo từng repo** (`checkRepoWorkspace`): origin, nhánh gốc, danh tính commit, gitignore `worktrees_dir`, hook, `.env` với in_place, cảnh báo đang ở main — kết quả in theo phạm vi `(dự án <mã>)`. Repo của một mục lỗi → chỉ dự án đó tắt (⚠); mọi mục đều tắt → agent tắt (✘ "không dự án nào trong projects chạy được").
- **Job việc** (`jobs/task.ts`): `workspaceFor` trả `null` → job `skipped` + bình luận "KHÔNG chạy: dự án <mã> chưa gắn repo trên máy chạy agent (agents.yaml → projects)" (mục đang tắt: nêu lý do tắt), không mở phiên CLI. Mã dự án trong câu lấy từ mã việc.
- **Job theo dõi** (`jobs/follow.ts`): công cụ theo `workspace` của dự án (`toolsOf`); dự án chưa gắn repo → bỏ ngay lúc nhận tin, chỉ log `warn`, không bình luận.
- **Bắt bù lúc khởi động**: `pickStartupTasks(list, hasWorkspace)` bỏ việc của dự án chưa gắn repo (đếm `noWorkspace` trong dòng log) — không mở job chỉ để bình luận mỗi lần khởi động.
- **Hook pre-push** (chung của repo): chặn nhánh gốc của mọi cặp (agent, dự án) dùng repo đó (`repoBaseBranches`); `OFFICEHUB_BASE_BRANCH` đặt theo dự án của job (`agentEnv(agent, git, baseBranch)`), cho cả git của runner (`gitFor(agent, place)`) lẫn CLI agent.
- Không đổi: phiên `chat_mention` / `meeting_turn` (không repo); worktree `{worktrees_dir}/{mã NV}/{mã việc}` (mã việc đã khác nhau giữa các dự án); nối phiên theo thư mục chạy.

## Giới hạn

- Mỗi agent vẫn **một phiên cùng lúc** → việc của các dự án xếp hàng nối tiếp.
- Tin đánh thức việc của dự án chưa gắn repo vẫn tạo một job `skipped` + một bình luận mỗi lần tin tới (người thật thấy lý do ngay trên việc).
- Mã dự án viết sai → dự án đó tắt, việc của nó bị bỏ + bình luận; đọc dòng ⚠ của `doctor`.

## Test

`config.test.ts` (thiếu `projects` / `repo` cấp agent → lỗi, projects hợp lệ / sai, in_place theo cặp, `repoBaseBranches`), `validator.test.ts` (`noWorkspace`), `flow.test.ts` "TEST-200" (MCP giả + 2 repo bare: việc A → repo A / nhánh gốc A, việc B → repo B, dự án chưa gắn / đang tắt → skipped + bình luận, doctor chỉ tắt dự án lỗi, bắt bù).
