# Front-end (React 19 + Vite + TS, bun)

> Nguồn sự thật là code; feature tham chiếu `frontend/src/features/employees`. Về [AGENTS.md](../AGENTS.md) · quy ước chung/BE: [conventions.md](conventions.md).

## Cây thư mục `frontend/src`

```
assets/styles/global.css      # Tailwind v4 + biến màu theme shadcn
components/common/            # shadcn (tên file thường: button.tsx, dialog.tsx…) + FormField, SelectField
components/feedback/          # Spinner, ComingSoon
context/                      # theme-provider (sáng/tối), search-provider (Ctrl/⌘+K)
components/layout/            # MainLayout, AppSidebar, Header (⌘K, chuông thông báo, theme, tài khoản), PageHeader, navigation.ts
config/                       # env.ts, paths.ts (PATHS), roles.ts (ROLE), theme.ts
features/<x>/                 # mỗi màn hình / nghiệp vụ một feature
hooks/                        # hook dùng chung (useDebounce, use-mobile của sidebar shadcn)
routes/                       # router.tsx, guards.ts
services/api-client.ts        # http(), httpPost(), ApiError
types/                        # api.ts (ProblemDetails), generated/ (Orval)
utils/                        # cn.ts, date.ts, errors.ts
```

## Cấu trúc một feature (mẫu: `features/employees`)

```
features/employees/
├── api/org.api.ts          # hàm gọi API + query key (orgKeys)
├── hooks/useOrg.ts         # useQuery / useMutation; mutation invalidate theo key gốc
├── types/employee.types.ts # interface I* khớp DTO back-end
├── utils/labels.ts         # nhãn tiếng Việt, hằng số riêng feature
├── components/             # EmployeesPage (màn hình) + component con
└── index.ts                # public API (barrel)
```

- Ngoài feature **chỉ import qua `@/features/<x>`** (barrel). Trong feature dùng đường dẫn tương đối. Feature được có thêm thư mục riêng (vd `office/engine`, `office/store`).
- Màn hình mới: tạo feature → thêm `page(PATHS.x, () => import('@/features/x'), '<Export>')` trong `routes/router.tsx` → thêm `PATHS.x` vào `config/paths.ts` → thêm menu vào `components/layout/navigation.ts` (chọn nhóm, icon lucide); trang chỉ dành cho một số vai trò → thêm path vào `PAGE_ROLES` (`config/access.ts`) — menu và chặn route tự theo. Đầu trang: `<PageHeader title />` (chỉ `<h1 class="sr-only">` — **không hiện tiêu đề / mô tả**, chủ dự án chốt 2026-11-06) + `<PageToolbar actions={…}>` cùng file `components/layout/PageHeader.tsx`: nút hành động **ngang hàng thanh tab** (đặt `<TabsList>` làm children, bên trong `<Tabs>`), căn phải. Trang không có tab: nút vào hàng điều khiển sẵn có của trang (vd Phòng họp: cạnh ô chọn ngày), không có gì thì `<PageToolbar actions />` đứng một mình bên phải. **Không** tạo file route bọc lại component (không có thư mục `app/`).
- Interface đặt tên `I<Tên>`; kiểu union string literal cho enum (khớp tên enum C#).
- Gọi API **luôn** qua `http`/`httpPost`/`httpUpload` (file, multipart field `file`) (`services/api-client.ts`, `credentials: 'include'`). Không lưu token (đăng nhập bằng cookie HttpOnly).
- Lỗi: `fieldErrors(err)` cho form, `errorMessage(err)` cho toast (`utils/errors.ts`). Toast dùng `toast` từ `sonner`.
- Form: `FormField` / `SelectField` (`components/common`). `SelectField` dùng giá trị đặc biệt cho "không chọn" (Radix không nhận value rỗng) và trả `null`.
- Ngày giờ (`utils/date.ts`, múi giờ `Asia/Ho_Chi_Minh`): API trả thời điểm UTC `…Z` → hiển thị bằng `formatDate` / `formatTime` / `formatDateTime` (đổi sang giờ VN); gửi thời điểm lên bằng `toApiInstant(date)` (BE từ chối chuỗi thiếu múi giờ). Ngày / tháng "hôm nay" theo VN: `todayVn()` / `currentMonthVn()` — **không** dùng `toLocaleDateString()` không kèm `timeZone` (lấy theo máy người dùng). Ngày `yyyy-MM-dd`, giờ `HH:mm` gửi nguyên dạng.
- State: TanStack Query cho dữ liệu server; Zustand chỉ cho văn phòng 3D (`features/office/store`). Không dùng Redux.
- Style: Tailwind class; ghép class bằng `cn()` (`utils/cn.ts`). CSS thuần chỉ ở văn phòng 3D (`office.css`, mọi selector bọc trong `.office-root`).
- UI dùng **shadcn/ui** (style `new-york`, Tailwind v4, `components.json`): button, card, dialog, input, label, select, checkbox, radio-group, tabs, table, badge… trong `components/common`. Không dùng `<input type="checkbox|radio">` / `<select>` thuần — dùng `Checkbox` (`onCheckedChange={(c) => set(c === true)}`), `RadioGroup`, `SelectField`.
- Thêm component: `bun run ui:add <tên>` (script sửa lỗi registry sinh `from "cn"`). Được chỉnh file trong `components/common` nhưng `--overwrite` sẽ ghi đè.
- Màu dùng token (`bg-background`, `text-muted-foreground`, `border`, `bg-primary`…), không hard-code mã màu → dark mode (`.dark`, nút ở header) chạy đúng. Palette slate theo shadcn-admin; đổi màu chủ đạo: `--primary`/`--ring` trong `global.css`. Animation `animate-in/out` từ `tw-animate-css`. `sonner.tsx` dùng `useTheme` của dự án thay `next-themes`.
- Màu trạng thái: token tự thêm `success` / `warning` / `info` (+ `-foreground`) cạnh `destructive` → `text-success`, `bg-warning/15`… Badge trạng thái dùng `StatusBadge` (`components/common/StatusBadge.tsx`, prop `tone`); map nhãn trong `features/<x>/utils/labels.ts` khai báo `tone`, không khai báo class màu. Sidebar dùng token `sidebar-*`.

## Bố cục (`MainLayout`)

Theo mẫu [shadcn-admin](https://github.com/satnaing/shadcn-admin) (MIT), chỉ lấy bố cục, không copy feature:

- `SidebarProvider` + `AppSidebar` (`variant="inset"`, `collapsible="icon"`, Ctrl/⌘+B; trạng thái lưu cookie `sidebar_state`). Đầu sidebar: logo; giữa: nhóm menu từ `navigation.ts` (lọc vai trò bằng `useNavigation`); badge số đơn chờ trên "Phê duyệt"; chân: menu tài khoản (văn phòng 3D, đổi mật khẩu, đăng xuất).
- `Header` dính đầu trang: nút thu sidebar, ô tìm nhanh (Ctrl/⌘+K mở `CommandMenu`: nhảy màn hình + đổi theme), chuông `NotificationBell` (`@/features/notifications`), nút theme, avatar.
- `<main>` tối đa `max-w-7xl`; mỗi trang mở đầu bằng `PageHeader` (tiêu đề ẩn) và, nếu có nút hành động, `PageToolbar`.
- Theme sáng / tối / theo hệ thống: `context/theme-provider.tsx`, lưu localStorage `officehub:theme`; script nhỏ trong `index.html` áp class `dark` trước khi React tải (đổi key thì sửa cả hai chỗ). Font Inter (Google Fonts).
- Màn đăng nhập / đặt mật khẩu: `features/auth/components/AuthShell` (logo + thẻ giữa trang).
- Văn phòng 3D (`/office`) toàn màn hình, không nằm trong `MainLayout`.

## PWA (cài như ứng dụng, không push)

`public/manifest.webmanifest`, icon `public/icons/*` (sinh bằng `bun scripts/dev/make-icons.ts`), `public/sw.js` (tăng `VERSION` khi đổi chiến lược cache), `public/offline.html`. `src/pwa.ts`: `registerPwa()` chỉ đăng ký ở bản build (toast "Có bản mới" → "Tải lại" = skip-waiting), `usePwaInstall()` → mục "Cài ứng dụng" trong menu người dùng (iOS: hướng dẫn Chia sẻ → Thêm vào MH chính). Service worker **không bao giờ** cache `/api`, `/rt`, `/mcp`, `/livekit`, `/oauth`, `/.well-known`, `/health`; điều hướng khi mất mạng → `offline.html`; `/assets/*` cache-first (tên có hash). Mobile: gốc trang `grid grid-cols-1`, cột lưới dùng `minmax(0,1fr)`, bảng bọc `overflow-x-auto`, `TabsList` cuộn ngang.

