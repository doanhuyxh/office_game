# Cache xác thực trong RAM (TEST-244)

> Bước B2a của kế hoạch cache phía server (B1 đo: TEST-243, B2b danh mục: TEST-245, B3 Redis: TEST-246). Về [auth-sessions.md](auth-sessions.md) · [auth.md](auth.md) · [mcp.md](mcp.md) · [../architecture.md](../architecture.md).

## Vì sao

Trước đây MỌI request đã đăng nhập đọc lại DB để xác thực: cookie 3 + 2 × số vai trò câu (`SecurityStampValidator`, `ValidationInterval = 0`), token AI 3 câu (+ claims ở route cho phép). Mỗi câu ~30 ms round trip ở prod.

## Cách làm

- `BuildingBlocks/Caching/CachingExtensions.cs`: `AddOfficeHubCache()` đăng ký `HybridCache` (gói `Microsoft.Extensions.Caching.Hybrid`) **chỉ L1 trong RAM** (`DisableDistributedCache`, chưa có `IDistributedCache`). Module gọi trong `Register` (gọi nhiều lần không sao), dùng qua lớp của chính module.
- `Identity/Infrastructure/AuthCache.cs`:
  - `UserAuthSnapshot` theo userId (khoá `identity:user:{id}`, tag `user:{id}`): security stamp, `IsActive`, `MustChangePassword`, lockout, `TwoFactorEnabled`, vai trò, đúng các claim `AppClaimsFactory` dựng.
  - `TokenAuthSnapshot` theo SHA-256 token (khoá `identity:token:{hash}`; tag `user:{userId}`, `token:{id}`, `grant:{id}`, `identity:tokens`): hạn, `RevokedAt`, grant còn hiệu lực, `LastUsedAt`. Không lưu token rõ; hash không tồn tại không được cache (chuỗi ngẫu nhiên không làm phình RAM).
  - TTL **60 giây** (`AuthCache.Ttl`) chỉ là lưới an toàn — hiệu lực ngay dựa vào xoá cache.
- Cookie: `CachedSecurityStampValidator` thay `ISecurityStampValidator` — vẫn so stamp ở mọi request, sai → từ chối + đăng xuất; đúng → thay principal bằng claim trong ảnh chụp + gia hạn cookie (như bản gốc).
- Token AI: `AccessTokenHandler` đọc 2 ảnh chụp. `AccessTokens__Enabled` (IOptionsMonitor) kiểm mỗi request, không cache. `LastUsedAt` vẫn ghi tối đa 5 phút / lần (`ExecuteUpdate`) rồi bỏ khoá token khỏi cache để lần sau đọc lại.

## Xoá cache ngay (phần bảo mật)

| Thay đổi | Đi qua | Xoá |
|---|---|---|
| Mọi `SaveChanges` của `OfficeIdentityDbContext` thêm / sửa / xoá `users` (stamp: đăng xuất, đăng nhập mới, đổi / đặt / cấp mật khẩu tạm, 2FA bật / tắt / đặt lại; khoá / mở; lockout do sai mật khẩu / xác nhận; họ tên…), `user_roles`, `user_claims` | `AuthCacheSaveChangesInterceptor` (sau khi ghi xong; lỗi giữa chừng cũng xoá) | `user:{id}` |
| `roles` / `role_claims` | như trên | toàn bộ (`identity`) |
| Thu hồi 1 token (`DELETE /auth/access-tokens/{id}`), grant OAuth (HR / người dùng thu hồi, refresh token bị dùng lại) | như trên (entity tracked) | `token:{id}` / `grant:{id}` |
| `AiAccessRevoker.RevokeAllAsync` (`ExecuteUpdate`) | gọi `AuthCacheInvalidator.InvalidateUserAsync` | `user:{id}` (mọi token của user) |
| `/oauth/revoke` (`ExecuteUpdate` theo hash), mã ủy quyền dùng lại | gọi tường minh | `identity:tokens` / `grant:{id}` |

- UserManager (`UpdateSecurityStampAsync`, `AddToRoleAsync`, `AccessFailedAsync`, `SetLockoutEndDateAsync`…) đều ghi qua `SaveChanges` → chỗ mới đổi stamp sau này **không phải nhớ xoá cache**. Chỉ `ExecuteUpdate` / `ExecuteDelete` lên `users`, `user_roles`, `access_tokens`, `oauth_grants` phải tự gọi `AuthCacheInvalidator.InvalidateAsync`.
- Chống đua: `AuthCacheInvalidator` ghi mốc xoá theo tag (`Stopwatch`); ảnh chụp đọc DB **trước** mốc đó (factory chạy song song với lệnh ghi) bị bỏ và đọc lại.
- ⚠ Sửa thẳng DB bằng SQL (script e2e `docker exec psql`) **không** xoá cache → Api thấy sau tối đa 60 giây.

## Giới hạn: chỉ 1 bản Api

Xoá cache chỉ trong tiến trình. Chạy **≥ 2 bản Api** thì bắt buộc làm B3 (Redis L2 + phát lệnh xoá sang bản khác, TEST-246) trước — nếu không, đăng xuất / khoá / thu hồi token ở bản này không tới bản kia trong tối đa 60 giây.

## Số liệu (DB tạm ~96 nhân viên, 240 việc; `db-query-count-e2e.ts`)

| Request | Trước (B1) | Sau |
|---|--:|--:|
| cookie rỗng (404) / token rỗng | 5 / 3 | 0 / 0 |
| `/auth/me` cookie / token | 7 / 9 | 3 / 3 |
| `/projects/{id}` cookie | 27 | 20 |
| `/projects/{id}/tasks?summary` | 15 | 8 |
| `/notifications/unread-count` | 6 | 1 |
| MCP `get_task` (3 request) | 58 | 37 |

Kiểm tra: `tests/OfficeHub.Modules.Identity.Tests/AuthCacheTests.cs`; e2e `scripts/dev/auth-cache-e2e.ts` (làm nóng cache → đổi trạng thái → request kế tiếp bị chặn: đăng nhập thiết bị B, thu hồi token, đổi vai trò, vai trò hr chưa bật 2FA, HR cấp mật khẩu tạm, lockout, khoá tài khoản).
