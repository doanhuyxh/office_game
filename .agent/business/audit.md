# Nhật ký (module Audit)

> Nguồn sự thật là code: `BuildingBlocks/Auditing/ChangeAudit.cs`, `backend/src/Modules/Audit/`, `frontend/src/features/audit/`. Về [README.md](README.md).

Hai loại nhật ký, đều **chỉ thêm**:

| Loại | Bảng | Ghi gì | Xem |
|---|---|---|---|
| Lịch sử sửa dữ liệu nhân sự | `audit.changes` | Ai (hoặc "Hệ thống" / "qua trợ lý AI"), lúc nào, thêm / sửa / xoá bản ghi nào, trường nào từ gì sang gì. Không tự xoá | `/audit` (HR), `GET /api/audit/changes` |
| Request của trợ lý AI | `audit.ai_requests` | [mcp-oauth.md](mcp-oauth.md#nhật-ký-ai-module-audit-schema-audit) | `/ai-access` |

## Lịch sử sửa — cách hoạt động

- Entity gắn `[Audited]` (BuildingBlocks) được `AuditSaveChangesInterceptor` bắt khi `SaveChanges` (interceptor gắn sẵn cho mọi DbContext qua `AddModuleDbContext`). Chụp giá trị cũ / mới **trước** khi lưu, chỉ gửi **sau** khi lưu thành công → `IChangeAuditSink` (module Audit: hàng đợi RAM 20 000 → `ChangeAuditWriter` ghi theo lô). Không có module Audit (host khác) → `NullChangeAuditSink`, không ghi gì.
- Đang gắn: `Employee`, `Department`, `Position` · `LaborContract`, `ContractAmendment`, `ContractTemplate` · `Shift`, `ScheduleEntry`, `Holiday` · `LeaveType`, `LeaveAdjustment` · `AppUser`. Đổi vai trò (bảng nối Identity) ghi tay trong `AccountService.SetRolesAsync` (trường `Roles`).
- **Entity mới cần lịch sử → thêm `[Audited]`** (quy ước: mọi dữ liệu nhân sự HR sửa tay). Không gắn cho dữ liệu đã có dấu vết riêng (sự kiện chấm công, đơn qua luồng duyệt, thông báo, token).
- **Che giá trị**: tên kết thúc `Encrypted` / `Hash` hoặc `[AuditMask]` → chỉ ghi `•••` + `masked` (lương, phụ cấp, mật khẩu không bao giờ vào nhật ký).
- **Bỏ qua**: entity owned (file đính kèm), khoá chính, trường kỹ thuật (`CreatedAt`, `UpdatedAt`, `LastUsedAt`, `LastLoginAt`, `Reminded30At/7At`, `AccessFailedCount`, `LockoutEnd`, stamp, normalized); bản sửa chỉ đổi trường kỹ thuật thì không ghi. Xoá mềm = `Modified` có `DeletedAt` (FE hiện "Xoá").
- Người sửa lấy từ `HttpContext` (`AuditActor`): `web` / `ai` (token AI) / `system` (job nền). Nhãn bản ghi = `FullName` / `Name` / `Number` / `Title` / `Code` / `UserName` đầu tiên có giá trị.
- `GET /api/audit/changes?entity=&entityId=&userId=&search=` (HR), mới nhất trước: có `page=&pageSize=` → `PagedResult` (trang `/audit`); không có → mảng, lùi bằng `before=` (ISO kèm múi giờ) + `take=` (≤ 200; script e2e). Token AI bị chặn (không có trong danh sách route).
- FE `/audit` (menu Tổ chức, admin / hr): lọc loại dữ liệu, tìm theo tên đối tượng / người sửa (đổi bộ lọc → về trang 1), phân trang `TablePagination` (`audit-changes`); nhãn trường / giá trị tiếng Việt, Id phòng ban / chức vụ / nhân viên đổi thành tên.
