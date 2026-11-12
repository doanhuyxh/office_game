# Front-end: trang lỗi, lỗi tải chunk, bảo trì (TEST-67)

> Về [frontend.md](frontend.md) · [AGENTS.md](../AGENTS.md).

Không bao giờ để người dùng thấy "Something went wrong!" mặc định của TanStack Router, stack trace hay thông báo lỗi thô.

## Trang lỗi chung — `components/feedback/error-page` (`ErrorPage`)

- `routes/router.tsx`: route `main` có `errorComponent` → lỗi trong một màn hình hiện trang lỗi **trong khung trang** (giữ sidebar / header);
  `createRouter({ defaultErrorComponent })` → lỗi ngoài khung trang (đăng nhập, `/office`, trang OAuth…) hiện **toàn màn hình** (`fullScreen`).
- `main.tsx` bọc `<App />` bằng `AppErrorBoundary` (`components/feedback/app-error-boundary`): lỗi ngoài router (khởi tạo provider…) → cùng trang lỗi toàn màn hình.
- Nội dung: tiếng Việt, token màu (sáng / tối), nút **Tải lại trang** (`location.reload()`) và **Về trang chủ** (thẻ `<a href="/">` — boundary gốc nằm ngoài router nên không dùng `Link`).
  Chỉ hiện **mã lỗi ngắn** `yyyyMMdd-HHmm · <đường dẫn>` (giờ VN) để người dùng báo admin; lỗi thật ghi `console.error("[OfficeHub] Lỗi giao diện (<mã>)", err)`.

## Lỗi tải chunk sau deploy — `utils/chunk-reload.ts`

- Tab còn bản cũ, chuyển trang → file JS lazy cũ đã bị xoá ("Failed to fetch dynamically imported module" / Firefox "error loading dynamically imported module" / Safari "Importing a module script failed").
- `registerChunkReload()` (gọi ở `main.tsx`) bắt `vite:preloadError` → `reloadOnceForChunkError()`: tải lại **một lần**, ghi mốc thời gian `sessionStorage['officehub:chunk-reload']`; trong 60 giây đã thử rồi thì không tải lại nữa (chống lặp).
- `lazyRouteComponent` của TanStack tự tải lại một lần (khoá `tanstack_router_reload:<message>`); vẫn lỗi → `ErrorPage` nhận ra lỗi chunk, thử `reloadOnceForChunkError()`, hết lượt → trang **"Hệ thống vừa được cập nhật"** (không hiện mã lỗi).

## Bảo trì / API không phản hồi — `services/maintenance.ts`

- `http()` (`services/api-client.ts`) báo trạng thái chung, **không màn nào tự xử lý**:
  - 502 / 503 / 504 mà thân **không phải JSON** (trang lỗi của nginx khi container `api` tắt / khởi động lại) → bảo trì ngay. API tự trả 502 / 503 kèm ProblemDetails (gửi email lỗi, voice chưa cấu hình…) là lỗi nghiệp vụ, **không** tính.
  - `fetch` reject (lỗi mạng) **3 lần liên tiếp** khi `navigator.onLine` (mất mạng thật do service worker / `offline.html` lo); bỏ qua `AbortError`.
  - Bất kỳ phản hồi nào khác → `maintenance.ok()` (reset).
- `App.tsx` → `MaintenanceGate`: `useApiDown()` → `MaintenancePage` (`components/feedback/maintenance-page`) phủ toàn màn hình, nút **Thử lại** + tự gọi `GET /health` mỗi 20 giây; API chạy lại → tắt trang và `queryClient.refetchQueries({ type: 'active' })`.
- `/health` (liveness) đi qua container `web` (`location = /health`); dev: Vite proxy `/health` → `VITE_API_TARGET`.
- Trang bảo trì tĩnh ở nginx ngoài (khi cả container `web` tắt lúc deploy) chưa làm — việc ops của chủ dự án, không sửa máy chủ từ repo.

## Kiểm thử

Chrome headless (`scripts/dev/cdp.ts`) với API giả (Bun, đổi chế độ 502 HTML / 503 JSON / chạy) + Vite `VITE_API_TARGET=<API giả>`: bảo trì bật / tự tắt, 503 JSON không bật, lỗi render (ném lỗi tạm trong một màn) → trang lỗi trong khung, không lộ thông báo / stack, theme tối, chặn chunk bằng `Network.setBlockedURLs` → "vừa được cập nhật" không lặp, `/office` lỗi → toàn màn hình — 20/20 (2026-11-13). Không cần DB.
