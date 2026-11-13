> ⚠️ **Bản mới, có breaking change**: .NET 10, TypeScript **7** (bỏ `baseUrl`), Vite **8** (Rolldown), Tailwind **4**, React 19. Không chắc thì đọc `frontend/node_modules/<gói>/`; TanStack Router: `frontend/node_modules/@tanstack/react-router/skills/*/SKILL.md`.

# OfficeHub

Văn phòng ảo 3D + quản lý nhân sự nội bộ cho một công ty (giao diện tiếng Việt, múi giờ `Asia/Ho_Chi_Minh`). Back-end ASP.NET Core (.NET 10, PostgreSQL, SignalR), front-end React 19 + Vite + TanStack + Three.js; package manager FE là **bun**.

File này chỉ là bộ định tuyến. Tài liệu thật nằm trong `.agent/` — đọc file tương ứng trước khi làm việc.

| Khi bạn cần... | Đọc |
|---|---|
| **Đầu phiên**: nhật ký đã xong, dữ liệu / tài khoản thử · bẫy đã gặp. **Việc còn lại / để sau / chờ chủ dự án: trên bảng dự án `TEST` của OfficeHub (không ghi vào file local)** | [.agent/progress.md](.agent/progress.md) · [.agent/pitfalls.md](.agent/pitfalls.md) |
| Chạy dev, build, test, migration, CI, deploy · biến `.env` (S3 / SMTP / FCM / IP văn phòng sửa được trên trang Hệ thống → Cấu hình, ưu tiên hơn `.env`) · trang Hệ thống → Vận hành (phiên bản, sao lưu, email, job nền) | [.agent/commands.md](.agent/commands.md) · [.agent/env.md](.agent/env.md) · [.agent/ops.md](.agent/ops.md) |
| Script e2e, test trên DB tạm (+ Mailpit đọc email) | [.agent/e2e.md](.agent/e2e.md) |
| Viết code đúng chuẩn: module BE, validation, đặt tên | [.agent/conventions.md](.agent/conventions.md) |
| Front-end: cây thư mục, cấu trúc feature, quy tắc import / API / ngày giờ · form, bảng (nút "Cột"), modal, xác nhận, màu token, shadcn/ui · layout sidebar/header, theme sáng/tối, PWA, mobile · trang lỗi, lỗi tải chunk sau deploy, trang bảo trì khi API tắt | [.agent/frontend.md](.agent/frontend.md) · [.agent/frontend-ui.md](.agent/frontend-ui.md) · [.agent/frontend-layout.md](.agent/frontend-layout.md) · [.agent/frontend-errors.md](.agent/frontend-errors.md) |
| Luồng request, cookie Api ↔ Realtime, cache | [.agent/architecture.md](.agent/architecture.md) |
| Tiền tố `/api/*` → module, danh sách trang FE + guard | [.agent/routes.md](.agent/routes.md) |
| Thêm/sửa bảng, index, migration, quy tắc ghi dữ liệu | [.agent/database.md](.agent/database.md) (schema approval / leave / notifications / contracts / documents: [.agent/database-workflow.md](.agent/database-workflow.md)) |
| Nguyên tắc phân quyền, nợ kỹ thuật đã biết | [.agent/business/README.md](.agent/business/README.md) |
| Đăng nhập, mật khẩu, link mời, admin seed · xác thực 2 lớp (TOTP, bắt buộc admin / HR) · huỷ phiên & token AI (đăng xuất, đổi mật khẩu, mật khẩu tạm, xác nhận lại khi tạo token) | [.agent/business/auth.md](.agent/business/auth.md) · [.agent/business/auth-2fa.md](.agent/business/auth-2fa.md) · [.agent/business/auth-sessions.md](.agent/business/auth-sessions.md) |
| Nhân viên, phòng ban · cấp tài khoản, vai trò | [.agent/business/organization.md](.agent/business/organization.md) · [.agent/business/organization-accounts.md](.agent/business/organization-accounts.md) |
| Mô tả + hướng dẫn phòng ban / chức vụ cho trợ lý AI | [.agent/business/org-guides.md](.agent/business/org-guides.md) |
| Hồ sơ cá nhân: liên hệ, ảnh, CCCD, ngân hàng, yêu cầu HR duyệt | [.agent/business/profile.md](.agent/business/profile.md) |
| Chấm công, bảng công · ca, lịch, ngày lễ | [.agent/business/attendance.md](.agent/business/attendance.md) · [.agent/business/attendance-shifts.md](.agent/business/attendance-shifts.md) |
| Giải trình chấm công, nhắc quên chấm ra | [.agent/business/attendance-corrections.md](.agent/business/attendance-corrections.md) |
| Tăng ca | [.agent/business/attendance-overtime.md](.agent/business/attendance-overtime.md) |
| Thông báo (chuông in-app, email, hàng đợi gửi) · Telegram đánh thức agent khi giao việc cho bot (một tin JSON vào nhóm, agent nhận theo employee_code, hàng đợi, thử lại) · danh mục sự kiện thông báo + kênh gửi (`NotificationCatalog`) | [.agent/business/notifications.md](.agent/business/notifications.md) · [.agent/business/notifications-telegram.md](.agent/business/notifications-telegram.md) · [.agent/business/notifications-catalog.md](.agent/business/notifications-catalog.md) |
| Hợp đồng lao động, phụ lục, lương mã hoá, file S3, mẫu hợp đồng Word · nhắc hết hạn / hết thử việc | [.agent/business/contracts.md](.agent/business/contracts.md) · [.agent/business/contracts-reminders.md](.agent/business/contracts-reminders.md) |
| Báo cáo + Excel, quy ra tiền tăng ca / phép năm | [.agent/business/reports.md](.agent/business/reports.md) |
| Bảng lương (BH, thuế TNCN, kỳ, phiếu) · ký hợp đồng điện tử (OTP email) | [.agent/business/payroll.md](.agent/business/payroll.md) · [.agent/business/contracts-esign.md](.agent/business/contracts-esign.md) |
| Đặt phòng họp · phiên họp agent trong phòng họp (người thật mở / dừng, bot chủ trì, trần 30 lượt / 30 phút do admin chỉnh, chia lượt nói + đánh thức `meeting_turn`) · tool MCP họp của bot (xem phiên, phát biểu, bỏ / chỉ định lượt) · giao diện "Họp với AI" (nút mở ở /meetings + kênh phòng + HUD 3D, thanh lượt nói / dừng, thẻ cấu hình trần) · họp trong 3D (bot đi bộ vào phòng họp khi mở, ở lại suốt phiên, về chỗ khi dừng; 🎤 bot giữ lượt; bảng phòng "Đang họp với AI") · e2e xuyên Api + Realtime + Mcp `agent-meeting-full-e2e.ts` | [.agent/business/meetings.md](.agent/business/meetings.md) · [.agent/business/meetings-agents.md](.agent/business/meetings-agents.md) · [.agent/business/meetings-agents-mcp.md](.agent/business/meetings-agents-mcp.md) · [.agent/business/meetings-agents-ui.md](.agent/business/meetings-agents-ui.md) · [.agent/business/meetings-agents-3d.md](.agent/business/meetings-agents-3d.md) |
| Tin nhắn (chat web ↔ 3D, kênh phòng, 1-1, tệp đính kèm) · sửa tin (24 giờ), cảm xúc emoji, tìm trong tin, nhóm chat tuỳ chọn, @nhắc người / bot trong tin | [.agent/business/chat.md](.agent/business/chat.md) · [.agent/business/chat-extras.md](.agent/business/chat-extras.md) |
| Bảng tin nội bộ (bài viết kiểu Facebook, bình luận, cảm xúc, @nhắc, phạm vi người xem) · hẹn giờ đăng, ai đã xem, chia sẻ lại, bài mới tự hiện, dọn tệp mồ côi | [.agent/business/news.md](.agent/business/news.md) · [.agent/business/news-extras.md](.agent/business/news-extras.md) |
| Kho tài liệu (tài sản số): kho phòng ban / dự án, tải thẳng S3, phiên bản, ban hành, hạn lưu trữ, bàn giao · trong văn phòng 3D (tủ hồ sơ, chiếu màn hình) | [.agent/business/documents.md](.agent/business/documents.md) · mức Hạn chế / Mật + watermark PDF + AI tạo / gửi duyệt tài liệu: [.agent/business/documents-security.md](.agent/business/documents-security.md) · [.agent/business/office-documents.md](.agent/business/office-documents.md) |
| Tài sản công ty: thiết bị (máy tính…), dịch vụ / tài khoản phần mềm (Figma…), cấp phát / thu hồi, nhắc bảo hành / gia hạn, nghỉ việc còn giữ · rà soát quyền, kiểm kê, Excel, MCP · khấu hao, biên bản giao nhận, ảnh / hoá đơn · tài khoản mạng xã hội (Facebook Business Manager: token, bàn giao, đăng bài lên Fanpage `/social`) | [.agent/business/assets.md](.agent/business/assets.md) · [.agent/business/assets-review.md](.agent/business/assets-review.md) · [.agent/business/assets-handover.md](.agent/business/assets-handover.md) · [.agent/business/assets-social.md](.agent/business/assets-social.md) |
| **Dự án**: thành viên + phân bổ %, mốc nghiệm thu (→ đợt thu đến hạn), công việc kanban, ngày công theo chấm công; sở hữu dự án thay module Documents · nhiều hợp đồng / dự án, chốt phân bổ, chi phí nhân công, lãi / lỗ dự án · yêu cầu thay đổi (CR) → phụ lục hợp đồng bán · phòng ban tham gia + quyền xem theo phòng ban + tab Phụ lục quyền hạn · tổng quan tiến độ (Đúng tiến độ / Có rủi ro / Trễ) · cột trạng thái công việc tự do (màu, kéo thả, quyền theo chức vụ), quy trình đi lần lượt / cần người duyệt, BOT | [.agent/business/projects.md](.agent/business/projects.md) · [.agent/business/projects-tasks.md](.agent/business/projects-tasks.md) · [.agent/business/projects-finance.md](.agent/business/projects-finance.md) · [.agent/business/projects-changes.md](.agent/business/projects-changes.md) · [.agent/business/projects-progress.md](.agent/business/projects-progress.md) · [.agent/business/projects-departments.md](.agent/business/projects-departments.md) |
| **Kinh doanh**: khách hàng, liên hệ, chăm sóc, cơ hội (pipeline), hợp đồng bán + lịch thu, công nợ, ghi nhận thu → sổ Finance · báo giá (mẫu Word, duyệt chiết khấu) | [.agent/business/sales.md](.agent/business/sales.md) · [.agent/business/sales-quotes.md](.agent/business/sales-quotes.md) |
| **Tài chính**: quyền theo chức vụ, quỹ, sổ thu chi, khoá sổ, đề nghị chi (duyệt quản lý → Duyệt chi) · chứng từ đính kèm (S3) + Excel sổ thu chi / sổ quỹ · kế hoạch kinh doanh / dự án / affiliate | [.agent/business/finance.md](.agent/business/finance.md) · [.agent/business/finance-docs.md](.agent/business/finance-docs.md) · [docs/BUSINESS_PLAN.md](docs/BUSINESS_PLAN.md) |
| Lịch sử sửa dữ liệu (`[Audited]`) · nhập nhân viên từ Excel · thao tác hàng loạt (đổi phòng ban / quản lý / chức vụ, nghỉ việc, xuất Excel) | [.agent/business/audit.md](.agent/business/audit.md) · [.agent/business/employee-import.md](.agent/business/employee-import.md) · [.agent/business/employee-bulk.md](.agent/business/employee-bulk.md) |
| Luồng duyệt, thêm loại đơn · uỷ quyền duyệt (duyệt thay) | [.agent/business/approval.md](.agent/business/approval.md) · [.agent/business/approval-delegation.md](.agent/business/approval-delegation.md) |
| Nghỉ phép, quỹ phép năm | [.agent/business/leave.md](.agent/business/leave.md) |
| Kết nối AI (MCP): token cá nhân, host `OfficeHub.Mcp`, danh sách tool · OAuth, nhật ký AI, quản trị HR · giám sát agent (nội dung lệnh ghi, cảnh báo bất thường) · đội agent tự phối hợp (webhook, việc phụ thuộc, rào chắn) | [.agent/business/mcp.md](.agent/business/mcp.md) · [.agent/business/mcp-tools.md](.agent/business/mcp-tools.md) · [.agent/business/mcp-oauth.md](.agent/business/mcp-oauth.md) · [.agent/business/ai-monitoring.md](.agent/business/ai-monitoring.md) · [.agent/business/agent-team.md](.agent/business/agent-team.md) |
| Bộ điều phối agent (`agent-runner/`): nhận tin Telegram đánh thức, kiểm tra lại việc qua MCP, chạy CLI agent (Claude Code / tuỳ chỉnh) trong worktree riêng, push + PR, bình luận chi phí; cấu hình `agents.yaml`, systemd, `doctor` · mode workspace `in_place` (commit thẳng vào nhánh đang checkout, không push / PR) · mode `none` cho agent nghiệp vụ (không repo / git, chỉ tool MCP) · tin `chat_mention` / `meeting_turn` (người thật @nhắc bot trong chat, tới lượt nói trong cuộc họp → phiên ngắn chỉ có tool MCP; đang họp thì việc chờ) | [.agent/business/agent-runner.md](.agent/business/agent-runner.md) · [.agent/business/agent-runner-workspace.md](.agent/business/agent-runner-workspace.md) · [.agent/business/agent-runner-events.md](.agent/business/agent-runner-events.md) · model thật agent dùng (log, bình luận chi phí, `doctor` chạy thử, `report` theo model): [.agent/business/agent-runner-model.md](.agent/business/agent-runner-model.md) · sự kiện "agent đang làm gì" cho người xem trực tiếp trong 3D (lệnh, diff, suy nghĩ; che bí mật, file nhạy cảm): [.agent/business/agent-runner-activity.md](.agent/business/agent-runner-activity.md) |
| Văn phòng 3D: bản đồ v2, lưới va chạm, SignalR, voice | [.agent/business/office.md](.agent/business/office.md) · engine 3D / HUD: [.agent/business/office-engine.md](.agent/business/office-engine.md) · nhân vật tuỳ chỉnh: [.agent/business/office-avatar.md](.agent/business/office-avatar.md) · bot AI hiện trong 3D (đi lại, chat): [.agent/business/office-bots.md](.agent/business/office-bots.md) · bot chiếu màn hình: [.agent/business/office-bots-screen.md](.agent/business/office-bots-screen.md) · luồng "agent đang làm gì" (lệnh, diff, suy nghĩ — RAM, `/mcp/activity` → `/rt/internal/bot-activity-feed`, hub `WatchBot` chỉ trong phạm vi nghe được, e2e `bot-activity-e2e.ts`): [.agent/business/office-bots-activity.md](.agent/business/office-bots-activity.md) · bấm vào bot trong 3D để xem (FE: chọn bot, phạm vi nghe ở client, hook `use-bot-watch`, bảng tạm): [.agent/business/office-bots-watch.md](.agent/business/office-bots-watch.md) · bot đang làm → bàn / rảnh → Khu nghỉ (agent-runner báo `/mcp/presence`, hoặc việc bot vừa thao tác — cột nào cũng tính): [.agent/business/office-bots-work.md](.agent/business/office-bots-work.md) · mặt bằng + lộ trình: [design/README.md](design/README.md) |

## Luật không được vi phạm

1. **Kiểm tra quyền ở back-end** (`AuthPolicies.Hr` / `AuthPolicies.Manager`); manager chỉ thấy bản thân + cấp dưới (`GetSubordinateIdsAsync`). Guard/menu FE không phải lớp bảo mật.
2. **Ranh giới module**: module BE không tham chiếu project module khác — chỉ `OfficeHub.Modules.<X>.Contracts`; không JOIN / FK chéo schema. `dotnet test` (ModuleBoundaryTests) sẽ fail nếu vi phạm.
3. **Business logic đặt ở back-end** (endpoint/service/`Domain` của module). FE chỉ hiển thị, gọi API qua `services/api-client.ts`.
4. **`attendance.events` chỉ thêm, không sửa/xoá**; bảng công luôn tính từ sự kiện qua `TimesheetCalculator`. Đổi quy tắc tính → sửa cả `tests/OfficeHub.Modules.Attendance.Tests`.
5. **Thời gian do server quyết định** (`TimeProvider` + `Office__TimeZone`); lưu `DateTimeOffset` UTC.
6. **Không commit secret**: cấu hình qua `.env` (gitignore). Thêm biến → Settings có `ErrorMessage = "Thiếu X__Y trong .env"`, cập nhật `.env.example` + `commands.md`.
7. **FE**: ngoài feature chỉ import qua `@/features/<x>`; màn hình mới = feature + `page(...)` trong `routes/router.tsx`. Component trong feature: **mỗi component một thư mục kebab-case** `components/<ten-component>/index.tsx` (không file phẳng `components/Ten.tsx`) — chi tiết [.agent/frontend.md](.agent/frontend.md). Dùng helper sẵn có trước khi tạo mới. Chỉ dùng bun.
8. **Xong việc phải pass**: `backend/`: `dotnet build -warnaserror` và `dotnet test`; `frontend/`: `bun run build`; đổi `agent-runner/`: `bun run typecheck` và `bun test` trong đó. **Agent chạy qua bộ điều phối không được sửa `agent-runner/`** (runner + hook pre-push chặn).
9. **Đổi tool MCP phải cập nhật màn hình quản trị**: thêm / sửa / xoá tool trong `backend/src/OfficeHub.Mcp/Tools/*.cs` → cập nhật ngay catalog `frontend/src/features/mcp-tools/utils/catalog.ts` (tên, tiêu đề, mô tả, tham số, loại read/write/destructive, endpoint) cho khớp. Đây là màn hình tham chiếu "Công cụ AI (MCP)" (`/mcp-tools`, chỉ admin), không tự suy ra từ code nên không được để lệch. Cập nhật luôn số lượng tool trong [.agent/business/mcp.md](.agent/business/mcp.md) và bảng nhóm tool [.agent/business/mcp-tools.md](.agent/business/mcp-tools.md).

## Giữ tài liệu đúng

- `.agent/` là nguồn sự thật duy nhất cho agent (`docs/ARCHITECTURE_V2.md` là kế hoạch, có phần chưa làm).
- Đổi business rule → sửa file trong `.agent/business/`; đổi schema → `database.md` / `database-workflow.md`; thêm lệnh/script/env → `commands.md`; đổi cấu trúc/luồng dữ liệu → `architecture.md`.
- Mỗi file ≤ ~8 KB, chỉ đọc file cần cho task; vượt thì tách theo domain con, thêm dòng vào bảng định tuyến (ở đây và `business/README.md`).
- Nếu tài liệu khác code, tin code và sửa tài liệu trong cùng commit.
- **Thêm / xoá sự kiện thông báo** (hằng `NotificationCategories`, nơi gọi `NotifyAsync`, phương thức `ITelegramWakeup`, `WebhookEvents`) → sửa danh mục `NotificationCatalog` trong cùng commit (tên, mô tả ai nhận / khi nào, nhóm, kênh, email). `dotnet test` (NotificationCatalogTests) fail nếu lệch — [.agent/business/notifications-catalog.md](.agent/business/notifications-catalog.md).
- **Đối chiếu kế hoạch theo từng task**: khi làm xong một task (trước khi chuyển Chờ review), xem task đó có thuộc mục nào trong kế hoạch ở `docs/` (`BUSINESS_PLAN.md`, `ARCHITECTURE_V2.md`) không. Có → cập nhật mục đó cho khớp (đổi ⏳ → ✅, ghi trạng thái / phần còn lại, sửa lộ trình) **trong cùng commit** với task. Không thuộc kế hoạch → bỏ qua. Nếu thấy mục kế hoạch đã xong / đã bỏ mà vẫn ghi chưa làm, sửa luôn. Chỉ đánh dấu trạng thái mục kế hoạch; **việc còn lại / để sau ghi trên bảng dự án `TEST`**, không thêm danh sách tiến độ vào `docs/` hay `.agent/progress.md`. Ghi trong bình luận kết quả của task: đã đối chiếu kế hoạch, sửa mục nào (hoặc "không thuộc kế hoạch").

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**This project has a knowledge graph. Start with the code-review-graph
MCP tools to narrow scope, then read the source.** The graph is cheaper than scanning files and
gives you structural context (callers, dependents, test coverage) that file search cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes_tool` or `query_graph_tool` instead of Grep
- **Understanding impact**: `get_impact_radius_tool` instead of manually tracing imports
- **Code review**: `detect_changes_tool` + `get_review_context_tool` instead of reading entire files
- **Finding relationships**: `query_graph_tool` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview_tool` + `list_communities_tool`

### Verify in the source

- Narrow scope with the graph, then read the source. Do not change code from graph output alone.
- For any non-trivial change, read the implementation and the relevant tests before concluding.
- Verify the exact source when touching behavior, database logic, migrations, retries, fallbacks,
  recovery, or compatibility code.
- When the graph and the source disagree, the source wins. The graph may be stale or may not
  model that relationship.
- An empty graph result can mean "not indexed" or "not statically visible", not "does not exist".

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes_tool` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context_tool` | Need source snippets for review — token-efficient |
| `get_impact_radius_tool` | Understanding blast radius of a change |
| `get_affected_flows_tool` | Finding which execution paths are impacted |
| `query_graph_tool` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes_tool` | Finding functions/classes by name or keyword |
| `get_architecture_overview_tool` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes_tool` for code review.
3. Use `get_affected_flows_tool` to understand impact.
4. Use `query_graph_tool` pattern="tests_for" to check coverage.
<!-- /code-review-graph MCP tools -->
