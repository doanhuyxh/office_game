> ⚠️ **Bản mới, có breaking change**: .NET 10, TypeScript **7** (bỏ `baseUrl`), Vite **8** (Rolldown), Tailwind **4**, React 19. Không chắc thì đọc `frontend/node_modules/<gói>/`; TanStack Router: `frontend/node_modules/@tanstack/react-router/skills/*/SKILL.md`.

# OfficeHub

Văn phòng ảo 3D + quản lý nhân sự nội bộ cho một công ty (giao diện tiếng Việt, múi giờ `Asia/Ho_Chi_Minh`). Back-end ASP.NET Core (.NET 10, PostgreSQL, SignalR), front-end React 19 + Vite + TanStack + Three.js; package manager FE là **bun**.

File này chỉ là bộ định tuyến. Tài liệu thật nằm trong `.agent/` — đọc file tương ứng trước khi làm việc.

| Khi bạn cần... | Đọc |
|---|---|
| **Đầu phiên**: tiến độ, việc tiếp theo, dữ liệu / tài khoản thử, bẫy đã gặp | [.agent/progress.md](.agent/progress.md) |
| Chạy dev, build, test, migration, CI, deploy · biến `.env` | [.agent/commands.md](.agent/commands.md) · [.agent/env.md](.agent/env.md) |
| Viết code đúng chuẩn: module BE, validation, đặt tên | [.agent/conventions.md](.agent/conventions.md) |
| Front-end: feature, shadcn/ui, theme sáng/tối, layout sidebar/header | [.agent/frontend.md](.agent/frontend.md) |
| Luồng request, cookie Api ↔ Realtime, cache | [.agent/architecture.md](.agent/architecture.md) |
| Tiền tố `/api/*` → module, danh sách trang FE + guard | [.agent/routes.md](.agent/routes.md) |
| Thêm/sửa bảng, index, migration, quy tắc ghi dữ liệu | [.agent/database.md](.agent/database.md) (schema approval / leave / notifications / contracts: [.agent/database-workflow.md](.agent/database-workflow.md)) |
| Nguyên tắc phân quyền, nợ kỹ thuật đã biết | [.agent/business/README.md](.agent/business/README.md) |
| Đăng nhập, mật khẩu, link mời, admin seed | [.agent/business/auth.md](.agent/business/auth.md) |
| Nhân viên, phòng ban · cấp tài khoản, vai trò | [.agent/business/organization.md](.agent/business/organization.md) · [.agent/business/organization-accounts.md](.agent/business/organization-accounts.md) |
| Chấm công, bảng công · ca, lịch, ngày lễ | [.agent/business/attendance.md](.agent/business/attendance.md) · [.agent/business/attendance-shifts.md](.agent/business/attendance-shifts.md) |
| Giải trình chấm công, nhắc quên chấm ra | [.agent/business/attendance-corrections.md](.agent/business/attendance-corrections.md) |
| Tăng ca | [.agent/business/attendance-overtime.md](.agent/business/attendance-overtime.md) |
| Thông báo (chuông in-app, email, hàng đợi gửi) | [.agent/business/notifications.md](.agent/business/notifications.md) |
| Hợp đồng lao động, phụ lục, lương mã hoá, file S3, nhắc hết hạn, mẫu hợp đồng Word | [.agent/business/contracts.md](.agent/business/contracts.md) |
| Báo cáo + Excel, quy ra tiền tăng ca / phép năm | [.agent/business/reports.md](.agent/business/reports.md) |
| Đặt phòng họp | [.agent/business/meetings.md](.agent/business/meetings.md) |
| Lịch sử sửa dữ liệu (`[Audited]`) · nhập nhân viên từ Excel | [.agent/business/audit.md](.agent/business/audit.md) · [.agent/business/employee-import.md](.agent/business/employee-import.md) |
| Luồng duyệt, thêm loại đơn | [.agent/business/approval.md](.agent/business/approval.md) |
| Nghỉ phép, quỹ phép năm | [.agent/business/leave.md](.agent/business/leave.md) |
| Kết nối AI (MCP): token cá nhân, host `OfficeHub.Mcp`, danh sách tool · OAuth, nhật ký AI, quản trị HR | [.agent/business/mcp.md](.agent/business/mcp.md) · [.agent/business/mcp-oauth.md](.agent/business/mcp-oauth.md) |
| Văn phòng 3D: bản đồ v2, lưới va chạm, SignalR, voice | [.agent/business/office.md](.agent/business/office.md) · engine 3D / HUD: [.agent/business/office-engine.md](.agent/business/office-engine.md) · mặt bằng + lộ trình: [design/README.md](design/README.md) |

## Luật không được vi phạm

1. **Kiểm tra quyền ở back-end** (`AuthPolicies.Hr` / `AuthPolicies.Manager`); manager chỉ thấy bản thân + cấp dưới (`GetSubordinateIdsAsync`). Guard/menu FE không phải lớp bảo mật.
2. **Ranh giới module**: module BE không tham chiếu project module khác — chỉ `OfficeHub.Modules.<X>.Contracts`; không JOIN / FK chéo schema. `dotnet test` (ModuleBoundaryTests) sẽ fail nếu vi phạm.
3. **Business logic đặt ở back-end** (endpoint/service/`Domain` của module). FE chỉ hiển thị, gọi API qua `services/api-client.ts`.
4. **`attendance.events` chỉ thêm, không sửa/xoá**; bảng công luôn tính từ sự kiện qua `TimesheetCalculator`. Đổi quy tắc tính → sửa cả `tests/OfficeHub.Modules.Attendance.Tests`.
5. **Thời gian do server quyết định** (`TimeProvider` + `Office__TimeZone`); lưu `DateTimeOffset` UTC.
6. **Không commit secret**: cấu hình qua `.env` (gitignore). Thêm biến → Settings có `ErrorMessage = "Thiếu X__Y trong .env"`, cập nhật `.env.example` + `commands.md`.
7. **FE**: ngoài feature chỉ import qua `@/features/<x>`; màn hình mới = feature + `page(...)` trong `routes/router.tsx`. Dùng helper sẵn có trước khi tạo mới. Chỉ dùng bun.
8. **Xong việc phải pass**: `backend/`: `dotnet build -warnaserror` và `dotnet test`; `frontend/`: `bun run build`.

## Giữ tài liệu đúng

- `.agent/` là nguồn sự thật duy nhất cho agent (`docs/ARCHITECTURE_V2.md` là kế hoạch, có phần chưa làm).
- Đổi business rule → sửa file trong `.agent/business/`; đổi schema → `database.md` / `database-workflow.md`; thêm lệnh/script/env → `commands.md`; đổi cấu trúc/luồng dữ liệu → `architecture.md`.
- Mỗi file ≤ ~8 KB, chỉ đọc file cần cho task; vượt thì tách theo domain con, thêm dòng vào bảng định tuyến (ở đây và `business/README.md`).
- Nếu tài liệu khác code, tin code và sửa tài liệu trong cùng commit.

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
