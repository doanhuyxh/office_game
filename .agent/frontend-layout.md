# Front-end: bố cục, theme, PWA

> Về [frontend.md](frontend.md) · [AGENTS.md](../AGENTS.md).

## Bố cục (`MainLayout`)

Theo mẫu [shadcn-admin](https://github.com/satnaing/shadcn-admin) (MIT), chỉ lấy bố cục, không copy feature:

- `SidebarProvider` + `AppSidebar` (`variant="inset"`, `collapsible="icon"`, Ctrl/⌘+B; trạng thái lưu cookie `sidebar_state`). Đầu sidebar: logo; giữa: nhóm menu từ `navigation.ts` (lọc vai trò bằng `useNavigation`); badge số đơn chờ trên "Phê duyệt"; chân: menu tài khoản (văn phòng 3D, đổi mật khẩu, đăng xuất).
- `Header` dính đầu trang: nút thu sidebar, ô tìm nhanh (Ctrl/⌘+K mở `CommandMenu`: nhảy màn hình + đổi theme), chuông `NotificationBell` (`@/features/notifications`), nút `ChatButton` (`@/features/chat`, badge tin chưa đọc), nút theme, avatar.
- **Màn rất lớn (2K, 4K)**: **giữ nguyên cỡ chữ** (chủ dự án chốt 2026-11-07), chỉ mở rộng khung để hiện nhiều nội dung hơn. `<main>` tối đa `max-w-7xl`, vùng nội dung ≥ 112rem (màn ≥ ~2050px) → trải gần hết bề ngang (`max-w-[200rem]`) + `px-8` (container query `@container/content` ở `MainLayout`); mỗi trang mở đầu bằng `PageHeader` (tiêu đề ẩn) và, nếu có nút hành động, `PageToolbar`.
- Theme sáng / tối / theo hệ thống: `context/theme-provider.tsx`, lưu localStorage `officehub:theme`; script nhỏ trong `index.html` áp class `dark` trước khi React tải (đổi key thì sửa cả hai chỗ). Font Inter (Google Fonts).
- Màn đăng nhập / đặt mật khẩu: `features/auth/components/AuthShell` (logo + thẻ giữa trang).
- Văn phòng 3D (`/office`) toàn màn hình, không nằm trong `MainLayout`.

## PWA (cài như ứng dụng, không push)

`public/manifest.webmanifest`, icon `public/icons/*` (sinh bằng `bun scripts/dev/make-icons.ts`), `public/sw.js` (tăng `VERSION` khi đổi chiến lược cache), `public/offline.html`. `src/pwa.ts`: `registerPwa()` chỉ đăng ký ở bản build (toast "Có bản mới" → "Tải lại" = skip-waiting), `usePwaInstall()` → mục "Cài ứng dụng" trong menu người dùng (iOS: hướng dẫn Chia sẻ → Thêm vào MH chính). Service worker **không bao giờ** cache `/api`, `/rt`, `/mcp`, `/livekit`, `/oauth`, `/.well-known`, `/health`; điều hướng khi mất mạng → `offline.html`; `/assets/*` cache-first (tên có hash). Mobile: gốc trang `grid grid-cols-1`, cột lưới dùng `minmax(0,1fr)`, bảng bọc `overflow-x-auto`, `TabsList` cuộn ngang.
