# Front-end: bố cục, theme, PWA

> Về [frontend.md](frontend.md) · [AGENTS.md](../AGENTS.md).

## Bố cục (`MainLayout`)

Theo mẫu [shadcn-admin](https://github.com/satnaing/shadcn-admin) (MIT), chỉ lấy bố cục, không copy feature:

- `SidebarProvider` + `AppSidebar` (`variant="inset"`, `collapsible="icon"`, Ctrl/⌘+B; trạng thái lưu cookie `sidebar_state`). Đầu sidebar: logo; giữa: nhóm menu từ `navigation.ts` (lọc vai trò bằng `useNavigation`); badge số đơn chờ trên "Phê duyệt"; chân: menu tài khoản (văn phòng 3D, đổi mật khẩu, đăng xuất).
- `Header` dính đầu trang: nút thu sidebar, ô tìm nhanh (Ctrl/⌘+K mở `CommandMenu`: nhảy màn hình + đổi theme), chuông `NotificationBell` (`@/features/notifications`), nút `ChatButton` (`@/features/chat`, badge tin chưa đọc), nút theme, avatar.
- **Màn rất lớn (2K, 4K)** (TEST-91): **giữ nguyên cỡ chữ** (chủ dự án chốt 2026-11-07), chỉ mở rộng vùng hiển thị. `<main>` **luôn rộng hết** vùng nội dung (không `max-w` / `mx-auto`, không trần); lề ngang theo container query `@container/content` (đặt ở `SidebarInset`, đã trừ sidebar mở / thu): `px-4` → `@3xl/content:px-6` → `@7xl/content:px-8`, `Header` cùng lề. Mỗi trang mở đầu bằng `PageHeader` (tiêu đề ẩn) và, nếu có nút hành động, `PageToolbar`. Ba nhóm trang:
  1. **Bảng / danh sách / kanban / lịch / báo cáo**: rộng hết khung, không bọc `max-w-*` ở cấp trang; cột chữ dài giãn, cột số / ngày / trạng thái vừa nội dung.
  2. **Lưới thẻ / thẻ thống kê**: thêm bậc cột theo vùng nội dung (`@7xl/content:grid-cols-4 @min-[112rem]/content:grid-cols-6`…), không dùng `xl:` / `2xl:` theo cửa sổ cho bậc màn rộng. Hàng thẻ thống kê số lượng cố định → mỗi thẻ tối đa ~28rem (`@min-[112rem]/content:grid-cols-[repeat(4,minmax(0,28rem))]`), phần dư bên phải để trống.
  3. **Trang đọc / nhập liệu một cột**: không kéo dòng chữ hết màn; vùng ≥ 96rem → xếp 2 – 3 cột từ khối đã có (Bảng tin: cột bài ~42rem + cột bài ghim dính, cả khối canh giữa, không có bài ghim → một cột `max-w-2xl` giữa (TEST-105); Hồ sơ: thẻ lưới 2 → 3 cột; Hướng dẫn dự án: markdown 48rem + quy trình bên phải); không có khối để xếp cạnh → canh trái theo lề khung (trừ trang một bài viết: canh giữa như Bảng tin).
  Tin nhắn: bong bóng tối đa 48rem; danh sách hội thoại `w-80` → `w-96` khi vùng ≥ 112rem. Không đụng hộp thoại (`sm:max-w-*`), trang đăng nhập, `/office`, bố cục điện thoại / máy tính bảng.
- Theme sáng / tối / theo hệ thống: `context/theme-provider.tsx`, lưu localStorage `officehub:theme`; script nhỏ trong `index.html` áp class `dark` trước khi React tải (đổi key thì sửa cả hai chỗ). Font Inter (Google Fonts).
- Màn đăng nhập / đặt mật khẩu: `features/auth/components/AuthShell` (logo + thẻ giữa trang).
- Văn phòng 3D (`/office`) toàn màn hình, không nằm trong `MainLayout`.

## PWA (cài như ứng dụng, không push)

`public/manifest.webmanifest`, icon `public/icons/*` (sinh bằng `bun scripts/dev/make-icons.ts`), `public/sw.js` (tăng `VERSION` khi đổi chiến lược cache), `public/offline.html`. `src/pwa.ts`: `registerPwa()` chỉ đăng ký ở bản build (toast "Có bản mới" → "Tải lại" = skip-waiting), `usePwaInstall()` → mục "Cài ứng dụng" trong menu người dùng (iOS: hướng dẫn Chia sẻ → Thêm vào MH chính). Service worker **không bao giờ** cache `/api`, `/rt`, `/mcp`, `/livekit`, `/oauth`, `/.well-known`, `/health`; điều hướng khi mất mạng → `offline.html`; `/assets/*` cache-first (tên có hash). Mobile: gốc trang `grid grid-cols-1`, cột lưới dùng `minmax(0,1fr)`, bảng bọc `overflow-x-auto`, `TabsList` cuộn ngang.
