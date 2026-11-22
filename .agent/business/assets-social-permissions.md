# Quyền của token System User (BM Facebook) — TEST-204

> Nguồn sự thật là code: `Domain/SocialRules.cs` (`RequiredPermissions`, `MissingPermissions`, `SerializePermissions` / `ParsePermissions`), `Infrastructure/FacebookGraph.cs` (`PermissionsAsync`), `SocialService.CheckAndSyncAsync`, FE `features/assets/components/social-token-permissions`. Về [assets-social.md](assets-social.md).

## Dữ liệu (migration `AssetsSocialTokenPermissions`, bảng `assets.social_accounts`)

| Cột | Ý nghĩa |
|---|---|
| `TokenPermissions` jsonb | `[{"permission","status"}]` từ `GET /me/permissions` (bỏ trùng, sắp theo tên, `status` chữ thường: `granted` / `declined` / `expired`). null = chưa lấy được |
| `TokenPermissionsError` ≤ 500 | Token hợp lệ nhưng không lấy được danh sách quyền: "Không lấy được danh sách quyền: …" |

## Khi nào ghi

- Mỗi lần `CheckAndSyncAsync` chạy thành công (thêm BM có token, thay token, Đồng bộ trang; sau này cả job định kỳ): sau `/me` + `/me/accounts` → `/me/permissions`.
- `/me/permissions` lỗi (Facebook / mạng) → token **vẫn Hợp lệ**, `TokenPermissions = null` + `TokenPermissionsError`.
- Token lỗi (Facebook từ chối `/me` hoặc trang, hay job đăng gặp lỗi 190 / 102) → **giữ danh sách cũ**.
- Thay token (`PUT /accounts/{id}/token`) → xoá danh sách cũ trước khi kiểm tra.
- Graph: token qua header Bearer; phân trang theo cursor `after` (`limit=100`), không theo link `next` (chứa token).

## Quyền OfficeHub cần (`SocialRules.RequiredPermissions`, Graph API v23)

| Quyền | Thiếu thì |
|---|---|
| `pages_show_list` | không lấy được danh sách trang |
| `pages_manage_posts` | không đăng bài lên trang được |
| `pages_read_engagement` | không đọc bài / tương tác được (Meta cũng bắt buộc khi đăng bài; đồng bộ bài viết cần) |
| `business_management` | không truy cập được trang được gán qua Business Manager (System User) |
| `pages_read_user_content` | không đồng bộ được bài viết / số bình luận của trang (TEST-206 — [assets-social-page-posts.md](assets-social-page-posts.md)) |

Thêm quyền cần → sửa `RequiredPermissions` + hướng dẫn tạo token (`social-token-guide`) + `SocialRulesTests`.

## API

`SocialAccountDto` (danh sách + chi tiết BM) thêm `tokenPermissions` (`[{ permission, status, required }]` hoặc null), `tokenPermissionsError`, `missingPermissions` (`[{ permission, impact }]` — rỗng khi chưa lấy được danh sách). Không trả token.

## Giao diện

Sheet BM, mục "Token System User", dưới Trạng thái / Kiểm tra lúc: khối **Quyền của token** — chỉ hiện khi `tokenStatus = Valid`. Mỗi quyền một `StatusBadge` (đã cấp xanh; bị từ chối / hết hạn đỏ + nhãn; quyền OfficeHub cần chữ đậm). Thiếu quyền cần → hộp cảnh báo màu warning "Thiếu quyền X: …" + nhắc xem "Cách lấy token System User". Không lấy được danh sách → hiện `tokenPermissionsError`.

## Test

`SocialRulesTests` (so quyền có / thiếu, lưu / đọc JSON) · `social-e2e.ts`: đủ quyền (2 trang kết quả), thiếu `pages_manage_posts` → API báo thiếu, `/me/permissions` lỗi → Valid + ghi chú, token lỗi giữ danh sách cũ, không lộ token — 75/75 trên DB tạm + S3 tạm RustFS (2026-11-22).
