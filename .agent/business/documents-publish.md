# Kho tài liệu: tải lên là ban hành luôn, duyệt thành cấu hình bật / tắt (TEST-111)

> Phần mở rộng của [documents.md](documents.md). Code: `Features/SettingsEndpoints.cs`, `Features/AssetEndpoints.cs` (CreateAsync, SubmitAsync, ApproversAsync, AddVersionAsync, TrashAsync), `Domain/DocumentRules.cs` (`CanChangeFile` / `CanTrash`), `Domain/Entities.cs` (`DocumentSettings`, `Asset.AutoPublished`); FE thẻ `features/documents/components/document-settings-card` trong Hệ thống → Cấu hình → Tài liệu → Ban hành tài liệu (`?tab=config&section=documents`).

Chủ dự án chốt 2026-11-15: tải lên là **Ban hành luôn**; quy trình duyệt cũ giữ nguyên nhưng thành cấu hình admin bật / tắt, mặc định **tắt**.

## Cấu hình

- Bảng một dòng `documents.settings` (`Id = 1`, `RequirePublishApproval`, `UpdatedAt`, `UpdatedByName`), `[Audited]` → Lịch sử thay đổi (entity `DocumentSettings`). Chưa có dòng = tắt.
- `GET /api/documents/settings` — ai đăng nhập cũng đọc (`{ requirePublishApproval, isDefault, updatedAt, updatedByName }`). `PUT /api/documents/settings { requirePublishApproval }` — **chỉ admin** (`AuthPolicies.Admin`; HR / nhân viên 403, token AI 403 vì route không mở cho token).
- Đổi cấu hình không đụng tài liệu đã có và đơn đang chờ duyệt (handler `DocumentPublishHandler` không đọc cấu hình: duyệt → Ban hành, từ chối → Nháp như cũ).

## Khi TẮT (mặc định)

- `POST /assets` (tải lên — từng file, kể cả nhập cả thư mục): tạo xong gọi `AssetPublisher.PublishAsync` ngay → `Published`, số hiệu `{stt}/{năm}/{loại}-{kho}`, `PublishedAt`, hạn lưu trữ từ ngày ban hành; `AutoPublished = true`, `SubmittedByEmployeeId` = người tải. Không tạo đơn duyệt. Mỗi file một số hiệu riêng.
- Mức Hạn chế / Mật cũng ban hành ngay (mức chỉ quyết định ai xem; bảng tin 3D vẫn chỉ hiện Nội bộ).
- Nháp có sẵn (tạo khi đang bật, bị từ chối, hoặc tạo bằng `POST /assets/text`): `GET /approvers` trả `step: "Self"` + "Công ty không bắt buộc duyệt…" → nút "Ban hành ngay"; `POST /submit` trên web ban hành luôn (`AutoPublished = true`).
- **Tải nhầm file**: tài liệu `AutoPublished` vẫn được người tạo / phụ trách / quản lý kho (`CanActAsync`) **thay file** (phiên bản mới, giữ số hiệu + trạng thái) và **chuyển thùng rác** (khôi phục / xoá hẳn như nháp). Đổi loại vẫn chỉ khi Nháp (loại quyết định số hiệu). Ban hành qua duyệt / tự ban hành theo chức vụ (`AutoPublished = false`) giữ luật cũ: khoá file, không xoá, chỉ lưu trữ / huỷ theo hạn.
- Trợ lý AI giữ nguyên: `POST /assets/text` tạo Nháp, `submit` bằng token **luôn tạo đơn** cho người duyệt (kể cả khi tắt). Tool MCP không đổi.
- `SelfPublishDocuments` (tự ban hành theo chức vụ) không còn tác dụng khi tắt; cờ vẫn giữ.

## Khi BẬT

Quy trình như trước: tải lên → Nháp → gửi duyệt (quản lý trực tiếp / HR) → Ban hành; chức vụ tự ban hành vẫn "Ban hành ngay". Tài liệu đã ban hành tự động trước đó giữ `AutoPublished` (vẫn sửa file / xoá được).

## FE

- Thẻ "Tài liệu: duyệt trước khi ban hành" (checkbox + Lưu, người / lúc sửa cuối) ở tab Cấu hình trang Hệ thống, mục Tài liệu → Ban hành tài liệu (chỉ admin vào trang).
- Hàng đợi tải lên ghi "Đã ban hành" / "Nháp" từng file; sheet chi tiết ghi "tự động khi tải lên (không qua duyệt)" cạnh ngày ban hành. Nút thay file / xoá theo cờ `can` của API.

## Test

`DocumentRulesTests` (`CanChangeFile` / `CanTrash` theo `AutoPublished`); e2e `scripts/dev/documents-e2e.ts` mục `[111]` (quyền admin / HR / nhân viên / chưa đăng nhập, lịch sử sửa, đơn đang chờ khi đổi cấu hình, tải lên + thư mục → Ban hành có số hiệu, Mật, thay file / thùng rác, nháp có sẵn, tài liệu chữ vẫn Nháp, bật lại) — 96/96 (2026-11-15); `documents-extra-e2e.ts` 27/27 (không MCP).
