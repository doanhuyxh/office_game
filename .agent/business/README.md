# Nghiệp vụ — mục lục

> Nguồn sự thật là code (`backend/src/Modules/*`, `backend/src/OfficeHub.Realtime`, `frontend/src/features/*`); nếu code khác tài liệu, tin code và sửa tài liệu. Về [AGENTS.md](../../AGENTS.md).

OfficeHub là công cụ nội bộ của **một công ty** (~12 nhân sự, 1 văn phòng): văn phòng ảo 3D + quản lý nhân sự. Single-tenant, không có `tenant_id`.

## Khi sửa… đọc…

| Khi sửa | Đọc |
|---|---|
| Đăng nhập, cookie, mật khẩu, quên mật khẩu, link mời, admin seed, `IAccountService` (+ `ListByRoleAsync`) | [auth.md](auth.md) |
| Xác thực 2 lớp (TOTP): bật / tắt, mã dự phòng, đăng nhập 2 bước, bắt buộc admin / HR (cổng 403, token AI), HR đặt lại | [auth-2fa.md](auth-2fa.md) |
| Huỷ phiên & token AI: đăng xuất, đổi / đặt lại mật khẩu, khoá, mật khẩu tạm bị chặn ở server, xác nhận lại khi tạo token | [auth-sessions.md](auth-sessions.md) |
| Hồ sơ nhân viên, phòng ban, chức vụ, nghỉ việc, `IEmployeeDirectory` | [organization.md](organization.md) |
| Cấp / mời tài khoản, vai trò, bảo vệ admin | [organization-accounts.md](organization-accounts.md) |
| Nút chấm công, cách tính đi muộn / thiếu giờ, bảng công | [attendance.md](attendance.md) |
| Ca làm, lịch tuần, ngày lễ, UI chấm công | [attendance-shifts.md](attendance-shifts.md) |
| Văn phòng 3D, SignalR hub, bản đồ `shared/office-map.json`, chat HUD, voice token, chấm công trong 3D | [office.md](office.md) |
| Tin nhắn: kênh Office / phòng / 1-1, ảnh + tệp, thu hồi, chưa đọc, `ChatHub` · sửa tin, cảm xúc, tìm, nhóm tuỳ chọn | [chat.md](chat.md) · [chat-extras.md](chat-extras.md) |
| Bảng tin: bài viết kiểu Facebook (ai cũng đăng, chọn phạm vi người xem), bình luận, cảm xúc, @nhắc, email tuỳ chọn, kiểm duyệt HR · hẹn giờ, ai đã xem, chia sẻ lại | [news.md](news.md) · [news-extras.md](news-extras.md) |
| Engine 3D (Three.js): camera, đi / tìm đường, ngồi, minimap, đồ đạc, avatar | [office-engine.md](office-engine.md) |
| Tuỳ chỉnh nhân vật 3D: model, danh mục, `identity.user_avatars`, editor, `LookChanged` | [office-avatar.md](office-avatar.md) |
| Bot (agent AI qua MCP) hiện trong văn phòng 3D: cờ tài khoản `IsBot`, online 5 phút, xếp bàn theo khu, `BotStatus` | [office-bots.md](office-bots.md) |
| Luồng duyệt (quản lý → HR), không tự duyệt, `IApprovalHandler`, thêm loại đơn | [approval.md](approval.md) |
| Uỷ quyền duyệt (quản lý giao người duyệt thay theo khoảng ngày), "duyệt thay" | [approval-delegation.md](approval-delegation.md) |
| Loại phép, quỹ phép năm (cộng dồn, không hết hạn), đơn nghỉ, điều chỉnh của HR | [leave.md](leave.md) |
| Giải trình chấm công (bổ sung giờ vào / ra), nhắc quên chấm ra | [attendance-corrections.md](attendance-corrections.md) |
| Tăng ca (đơn, hệ số theo loại ngày, giới hạn) | [attendance-overtime.md](attendance-overtime.md) |
| Thông báo: chuông in-app + email (hàng đợi, thử lại), ai nhận gì khi gửi / duyệt / từ chối / huỷ đơn, `INotifier` · kênh Telegram đánh thức agent khi giao / trả lại việc cho bot hoặc bot được @nhắc · danh mục sự kiện thông báo + kênh gửi (bắt buộc cập nhật khi thêm / xoá thông báo) | [notifications.md](notifications.md) · [notifications-telegram.md](notifications-telegram.md) · [notifications-catalog.md](notifications-catalog.md) |
| Hợp đồng lao động: loại / thời hạn theo BLLĐ, phụ lục, lương mã hoá, file S3, quyền xem, mẫu hợp đồng Word | [contracts.md](contracts.md) |
| Nhắc hợp đồng sắp hết hạn (30 / 7 ngày), nhắc hết thử việc (7 / 3 ngày, quá hạn) | [contracts-reminders.md](contracts-reminders.md) |
| Kết nối AI (MCP): token truy cập cá nhân, route token được gọi, tool cho Claude / Cursor / Codex | [mcp.md](mcp.md) |
| Kết nối AI: OAuth 2.1 (DCR, PKCE, refresh), nhật ký AI (Audit), HR thu hồi, giới hạn / công tắc tắt | [mcp-oauth.md](mcp-oauth.md) |
| Giám sát agent / bot: nội dung lệnh ghi (7 ngày), cảnh báo bất thường gửi admin | [ai-monitoring.md](ai-monitoring.md) |
| Bot chiếu ảnh màn hình đang làm việc / tài liệu lên TV phòng họp (`present_screen`) | [office-bots-screen.md](office-bots-screen.md) |
| Bot đang làm → ngồi bàn, rảnh → Khu nghỉ / Pantry; agent-runner báo trạng thái (`/mcp/presence`) hoặc suy từ bảng việc (`inProgress`) | [office-bots-work.md](office-bots-work.md) |
| Đội agent tự phối hợp: rào chắn (không duyệt qua token, giới hạn việc / ngày + chuỗi bot do admin đặt), @nhắc, webhook cá nhân, việc phụ thuộc | [agent-team.md](agent-team.md) |
| Bộ điều phối agent `agent-runner/`: Telegram → kiểm tra lại qua MCP → CLI trong worktree riêng → PR + bình luận chi phí · mode `in_place` (commit thẳng vào nhánh đang checkout, không push / PR) | [agent-runner.md](agent-runner.md) · [agent-runner-workspace.md](agent-runner-workspace.md) · model thật agent dùng (log, bình luận chi phí, `doctor` chạy thử, `report` theo model): [agent-runner-model.md](agent-runner-model.md) |
| Hồ sơ cá nhân (tự sửa liên hệ / ảnh; CCCD, ngân hàng, ngày sinh qua HR duyệt; mã hoá; không ra MCP) | [profile.md](profile.md) |
| Mô tả + hướng dẫn phòng ban / chức vụ cho nhân viên và trợ lý AI (`get_my_role`), quyền trưởng phòng | [org-guides.md](org-guides.md) |
| Ký hợp đồng điện tử: OTP email, chữ ký vẽ tay, PDF có trang chứng nhận + SHA-256 | [contracts-esign.md](contracts-esign.md) |
| Bảng lương theo luật VN (BH, thuế TNCN, giảm trừ, thử việc 10 %), kỳ lương, phiếu lương | [payroll.md](payroll.md) |
| Báo cáo + Excel (bảng công, tiền tăng ca, tiền phép khi nghỉ việc), quy tắc lương giờ / ngày công chuẩn | [reports.md](reports.md) |
| Đặt phòng họp, chặn trùng giờ, mời họp, bảng "Đang họp" trong 3D | [meetings.md](meetings.md) |
| Kho tài liệu / tài sản số: kho + quyền, tải thẳng S3, phiên bản, ban hành, hạn lưu trữ, thùng rác, dự án, bàn giao | [documents.md](documents.md) · [documents-security.md](documents-security.md) |
| Tài liệu trong văn phòng 3D: tủ hồ sơ / thư viện / bảng tin (E), kéo thả tải lên, chiếu lên màn hình phòng (`PinScreen`) | [office-documents.md](office-documents.md) |
| Tài sản công ty: thiết bị + dịch vụ / ghế, cấp phát / thu hồi, nhắc hạn, nghỉ việc còn giữ, quyền xem | [assets.md](assets.md) |
| Tài sản: rà soát quyền định kỳ, kiểm kê, xuất Excel, tool MCP | [assets-review.md](assets-review.md) |
| Tài sản: khấu hao, biên bản giao nhận (xác nhận trong app, Word theo mẫu), ảnh / hoá đơn thiết bị (S3) | [assets-handover.md](assets-handover.md) |
| Tài sản: tài khoản mạng xã hội (Facebook BM, token System User mã hoá, bàn giao), đăng bài lên Fanpage (`/social`, job đăng, hẹn giờ) | [assets-social.md](assets-social.md) |
| Dự án: thành viên, phân bổ, mốc nghiệm thu, công việc, ngày công, `IProjectDirectory` (kho tài liệu dự án), chép dự án cũ từ Documents | [projects.md](projects.md) |
| Dự án — hợp đồng (nhiều HĐ / dự án), chốt phân bổ tháng, chi phí nhân công từ lương, thu / chi gắn dự án, lãi / lỗ | [projects-finance.md](projects-finance.md) |
| Dự án — tổng quan tiến độ: % hoàn thành, % thời gian, mốc tiếp, tình trạng Đúng tiến độ / Có rủi ro / Trễ | [projects-progress.md](projects-progress.md) |
| Dự án — phòng ban tham gia (chủ trì), nhân viên phòng ban xem dự án chỉ đọc, tab Phụ lục quyền hạn (sinh từ `ProjectViewer`) | [projects-departments.md](projects-departments.md) |
| Công việc dự án: cột trạng thái tự do (tên / màu / thứ tự, hoàn thành, cần người duyệt), quyền sửa theo chức vụ, quy trình đi lần lượt, lịch sử, BOT / MCP | [projects-tasks.md](projects-tasks.md) |
| Yêu cầu thay đổi (CR) của dự án → phụ lục hợp đồng bán (tăng / giảm giá trị, đợt thu mới) | [projects-changes.md](projects-changes.md) |
| Tài chính — chứng từ đính kèm dòng sổ / đề nghị chi (S3 `finance/`), Excel sổ thu chi + sổ quỹ + tổng hợp | [finance-docs.md](finance-docs.md) |
| Báo giá: hạng mục, chiết khấu (vượt ngưỡng → duyệt `quote_discount`), phiên bản, Word theo mẫu, lập hợp đồng từ báo giá | [sales-quotes.md](sales-quotes.md) |
| Kinh doanh: khách hàng, cơ hội, hợp đồng bán, lịch thu, công nợ, ghi nhận thu (→ `IFinanceLedger`), nhắc hạn thu | [sales.md](sales.md) |
| Tài chính: quyền theo chức vụ (`IFinanceAccess`), quỹ, sổ thu chi, khoá sổ, đề nghị chi qua bước duyệt `Finance` | [finance.md](finance.md) |
| Lịch sử sửa dữ liệu nhân sự (`[Audited]`, interceptor, che lương), nhật ký | [audit.md](audit.md) |
| Nhập nhân viên từ Excel (mẫu, xem trước, nhập hết hoặc không) | [employee-import.md](employee-import.md) |
| Thao tác hàng loạt trên danh sách nhân viên (tích chọn, đổi phòng ban / quản lý / chức vụ, nghỉ việc, xuất Excel) | [employee-bulk.md](employee-bulk.md) |

## Nguyên tắc chung

- **Vai trò** (`Roles`): `admin`, `hr`, `manager`, `employee`. Policy: `AuthPolicies.Hr` = admin|hr (mọi thao tác ghi dữ liệu nhân sự, ca, lịch), `AuthPolicies.Manager` = admin|hr|manager (xem bảng công người khác). Manager chỉ thấy **bản thân + cấp dưới** (theo `ManagerId`, cả gián tiếp, qua `GetSubordinateIdsAsync`). Kiểm tra quyền luôn ở back-end; menu / guard FE chỉ để điều hướng.
- **Dự án theo phòng ban** (TEST-40): nhân viên thuộc đúng phòng ban tham gia dự án (không tính phòng con) được **xem** dự án — chỉ đọc; làm việc / quản lý / ngày công / tài chính / kho tài liệu vẫn theo thành viên hoặc chức năng — [projects-departments.md](projects-departments.md).
- **Tài khoản ≠ nhân viên**: `identity.users` (đăng nhập) và `org.employees` (hồ sơ) liên kết bằng `employees.UserId`. Tài khoản không có hồ sơ (admin seed) đăng nhập được nhưng không chấm công.
- **Múi giờ**: mọi tính toán ngày giờ dùng `Office__TimeZone` (`Asia/Ho_Chi_Minh`). DB lưu `DateTimeOffset` UTC; `WorkDate` là ngày địa phương. FE hiển thị qua `utils/date.ts` cùng múi giờ.
- **Giờ do server quyết định** (chấm công). Không tin giờ trình duyệt.
- **Xoá mềm** dữ liệu nhân sự (`DeletedAt` / `Status = Resigned`); sự kiện chấm công không bao giờ sửa.
- **Lỗi** trả ProblemDetails với `detail` tiếng Việt; validate theo field (400) dùng key camelCase. FE hiển thị qua `fieldErrors` / `errorMessage`.
- **Thông báo tiếng Việt** viết trực tiếp trong code back-end (chưa có i18n).

## Điểm cần lưu ý / nợ kỹ thuật đã biết

1. **SMTP Gmail trên macOS**: MailKit kiểm tra thu hồi chứng chỉ (CRL/OCSP); trên macOS dev báo "incomplete certificate revocation check". Có tuỳ chọn `Smtp__CheckCertificateRevocation` (mặc định `true`); chỉ chủ dự án tự đặt `false` trong `.env` dev. Agent **không** tự đổi giá trị này.
2. Realtime phụ thuộc Api để kiểm tra phiên; Api không phản hồi thì **cho qua** (fail-open) — người bị khoá có thể vào văn phòng 3D trong lúc Api sập. Người đang online bị đẩy ra trễ tối đa `Realtime__SessionCheckSeconds`.
3. Không có transaction trải nhiều module (xem [database.md](../database.md#không-có)).
4. 2FA (TOTP, bắt buộc admin / HR — [auth-2fa.md](auth-2fa.md)): không có "ghi nhớ thiết bị", không chống dùng lại mã TOTP trong cùng cửa sổ ±60 giây (giới hạn của Identity); admin seed không có hồ sơ nhân viên → mất điện thoại + hết mã dự phòng thì chưa có màn đặt lại (phải sửa DB). Script e2e cũ đăng nhập bằng admin / HR phải bật 2FA trước (dùng `scripts/dev/totp.ts`).
5. Chống CSRF bằng kiểm tra `Sec-Fetch-Site` / `Origin` (không dùng token antiforgery) — [architecture.md](../architecture.md). Trang con khác **cùng origin** (vd. công cụ nhúng cùng tên miền và cổng) vẫn được coi là cùng nguồn.
6. Khai báo nhưng chưa dùng: `Office__InactiveMinutes`, FE `ENV`, `REALTIME.voiceToken`, `VITE_SENTRY_DSN`, `src/assets/icons|images` trống.
7. Registry shadcn `new-york-v4` viết sẵn `import { cn } from "cn"` và CLI cài gói npm rác `cn` → luôn thêm component bằng `bun run ui:add` (`frontend/scripts/ui-add.ts` tự sửa import + gỡ gói). CLI hỏi ghi đè file đã có (vd. `button.tsx` khi thêm `sidebar`) → trả lời `n` trừ khi muốn cập nhật.
8. Dev chạy qua Vite proxy → IP là localhost → chấm công luôn `Remote` trừ khi `Office__IpRanges` chứa `127.0.0.1/32`.
9. Bảng công và quỹ phép tính lại mỗi lần đọc (đủ nhanh cho ~12 người). Chưa có "chốt công", quy ra tiền tăng ca / giờ làm đêm, giờ lõi ca linh hoạt, ca qua đêm, quy ra tiền phép năm, tuỳ chọn tắt email thông báo.
10. `reactivate` không khôi phục `ManagerId` / `HeadEmployeeId` đã bị gỡ khi nghỉ việc. `departments.HeadEmployeeId` không có FK.
11. Văn phòng 3D là bản tối giản (sàn, vùng, avatar capsule); code game MVP cũ đã được xoá có chủ ý, engine đầy đủ sẽ viết mới trong `features/office/engine`.
12. FE không có lint và test tự động; BE chỉ có test kiến trúc + test hàm thuần theo module (`tests/OfficeHub.Modules.*.Tests`).
13. DB dev là Postgres dùng chung của công ty; admin seed đang dùng giá trị mẫu của `.env.example` (đã biết, chủ dự án chấp nhận khi dev).
