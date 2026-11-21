# Mạng xã hội theo nền tảng: trang, sub-tab, API (TEST-207)

> Về [assets-social.md](assets-social.md) (nghiệp vụ Facebook BM) · [README.md](README.md). Chủ dự án chốt 2026-11-22: quản lý tài khoản vẫn ở `/assets`, mỗi nền tảng một trang đăng bài riêng; Zalo OA / TikTok hiện trên menu ngay, mở ra "Chưa hỗ trợ".

## Nguồn duy nhất: `frontend/src/config/social-platforms.ts`

`SOCIAL_PLATFORMS` (key `facebook` / `zalo-oa` / `tiktok`): `name` (menu, trang), `label` (tên tài khoản ở Tài sản, vd "Facebook Business Manager (BM)"), `tabLabel` (sub-tab), `path` (`PATHS.socialFacebook` …), `icon`, `supported`, `note` (dòng giải thích "Chưa hỗ trợ"). Kèm `FACEBOOK_PLATFORM`, `PLATFORM_UNSUPPORTED`, `socialPlatform(key)`, `SOCIAL_PATHS`. Đặt ở `config/` (không trong feature) vì menu (layout luôn tải), router, `features/assets`, `features/social` đều đọc.

## Trang (FE)

| Đường dẫn | Trang | Ghi chú |
|---|---|---|
| `/social` | — | Link cũ trong chuông / email: `redirect` (replace) sang `/social/facebook` (`routes/router.tsx`, `socialLegacy`) |
| `/social/facebook` | `FacebookPostsPage` | Soạn bài + danh sách bài (trước là `/social`) |
| `/social/zalo-oa` · `/social/tiktok` | `ZaloOaPage` · `TiktokPage` (`unsupported-platform-page`) | "Chưa hỗ trợ" + `note`; HR có link sang sub-tab ở Tài sản. Không gọi API |
| `/assets?tab=social&platform=<key>` | `SocialTab` (`features/assets`) | Sub-tab Facebook BM · Zalo OA · TikTok; thiếu / lạ `platform` → Facebook (link cũ `?tab=social` vẫn đúng). Nút "Thêm BM Facebook" chỉ ở sub-tab Facebook. Đổi tab chính xoá `platform` (`useTabParam` tuỳ chọn `param` / `reset`) |

Menu: nhóm **Mạng xã hội** (`navigation.ts`, dựng từ `SOCIAL_PLATFORMS`) — 3 mục, chỉ HR / admin và người giữ tài khoản MXH thấy (`useNavigation`: hiện = có ít nhất một Fanpage Facebook; thêm nền tảng có tài khoản thì cộng điều kiện của nó). Menu chỉ là giao diện — quyền ở back-end.

Link thông báo (back-end, `SocialRules`): `FacebookPostsLink` = `/social/facebook` (bàn giao / thu hồi BM, đăng bài lỗi), `FacebookAccountsLink` = `/assets?tab=social&platform=facebook` (token BM hỏng).

## Cấu trúc code theo nền tảng

- `features/social`: `api/facebook.api.ts` (`facebookApi`, `facebookKeys` — key `['social','facebook',…]`), `hooks/useFacebook.ts` (`useFacebookPages` qua barrel, dùng cho menu), `types/facebook.types.ts`, `utils/facebook-labels.ts`, components `facebook-posts-page` / `facebook-post-composer` / `facebook-post-card` / `facebook-media-thumb`; dùng chung: `unsupported-platform-page`.
- `features/assets`: `api/facebook.api.ts` (`facebookApi` — BM), `hooks/useFacebook.ts`, `types/facebook.types.ts` (`IFacebookAccount` …), components `facebook-accounts-panel` / `facebook-account-sheet` / `facebook-account-form-dialog` / `facebook-token-guide` / `facebook-token-permissions`; dùng chung: `social-tab` (sub-tab), `unsupported-platform-panel`, hook `useSocialPlatformParam`. Kiểu dùng chung mọi nền tảng (`SocialPlatform`, `SocialAccountStatus`, `SocialTokenStatus`, `IHeldSocial`) ở `asset.types.ts`.
- Back-end: `/api/assets/social/facebook/{accounts,pages,media,posts,targets}` (`SocialAccountEndpoints`, `SocialPostEndpoints`, tiền tố `SocialRules.FacebookApiPrefix`). Endpoint dùng chung mọi nền tảng (tài sản đang giữ trong hồ sơ / "Của tôi" / cảnh báo nghỉ việc: `/api/assets/my`, `/employees/{id}/holdings`) giữ nguyên. Không đổi schema: `social_accounts.Platform` đã phân biệt nền tảng. Token AI vẫn không vào được.

## Thêm nền tảng mới thì làm ở đâu

1. Back-end: enum `SocialPlatform` + bảng / cột riêng nếu cần; endpoint nhóm `/api/assets/social/<key>/…` (tiền tố là hằng trong `SocialRules`), không dùng chung route với Facebook; link chuông trỏ trang của nền tảng.
2. `config/social-platforms.ts`: `supported: true`, sửa `note`.
3. `features/social`: `<key>-…` (api / hooks / types / components) + trang thật → thay `page(PATHS.social<Key>, …)` trong `routes/router.tsx`.
4. `features/assets`: panel `<key>-accounts-panel` → thay nhánh "Chưa hỗ trợ" trong `social-tab`; nút "Thêm …" theo `platform` ở `assets-page`.
5. `useNavigation`: cộng điều kiện "người giữ tài khoản <nền tảng>" vào điều kiện hiện nhóm Mạng xã hội.
6. e2e riêng (`scripts/dev/<key>-e2e.ts`) + tài liệu (file này, `routes.md`).

## Test

`social-e2e.ts` 76/76 (route mới; route cũ `/api/assets/social/accounts` → 404; chuông bàn giao link `/social/facebook`), `social-token-check-e2e.ts` 18/18 (link `…&platform=facebook`) trên DB + S3 tạm 2026-11-22. Giao diện (Chrome headless, HR / người giữ BM / nhân viên thường; sáng / tối; 390×844): menu 3 mục, `/social` → `/social/facebook`, sub-tab + URL, trang "Chưa hỗ trợ" — 25/25 (script tạm, ngoài repo).
