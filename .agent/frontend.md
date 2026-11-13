# Front-end (React 19 + Vite + TS, bun)

> Nguồn sự thật là code; feature tham chiếu `frontend/src/features/employees`. Về [AGENTS.md](../AGENTS.md) · quy ước chung/BE: [conventions.md](conventions.md). Thành phần giao diện (form, bảng, modal, màu): [frontend-ui.md](frontend-ui.md) · bố cục sidebar/header, theme, PWA, mobile: [frontend-layout.md](frontend-layout.md) · trang lỗi / bảo trì: [frontend-errors.md](frontend-errors.md).

## Cây thư mục `frontend/src`

```
assets/styles/global.css      # Tailwind v4 + biến màu theme shadcn
components/common/            # shadcn (tên file thường: button.tsx, dialog.tsx…) + FormField, SelectField
components/feedback/          # Spinner, ComingSoon, NotFoundPage, Forbidden, error-page / maintenance-page / app-error-boundary → frontend-errors.md
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
├── components/             # MỖI component MỘT thư mục kebab-case:
│   ├── employees-page/
│   │   └── index.tsx       #   export function EmployeesPage (tên export PascalCase giữ nguyên)
│   └── org-chart/
│       ├── index.tsx
│       └── org-chart.css   #   file kèm riêng (css, component con chỉ dùng nội bộ) để chung thư mục
└── index.ts                # public API (barrel)
```

- **Component trong feature: mỗi component một thư mục kebab-case** chứa `index.tsx` (chủ dự án chốt 2026-11-07; áp cho mọi feature, đã chuyển hết). Tên thư mục = tên component chuyển kebab (`AiAccessPage` → `ai-access-page`, `OAuthConsentPage` → `oauth-consent-page`). Import theo thư mục: `import { AssetSheet } from '../asset-sheet'` (trong `components/`), `'../components/asset-sheet'` (từ `hooks/`, barrel `index.ts`). **Không** tạo file component phẳng `components/Ten.tsx`. Thư mục dùng chung `src/components/common` (shadcn) giữ nguyên kiểu file như cũ.

- Ngoài feature **chỉ import qua `@/features/<x>`** (barrel). Trong feature dùng đường dẫn tương đối. Feature được có thêm thư mục riêng (vd `office/engine`, `office/store`).
- Màn hình mới: tạo feature → thêm `page(PATHS.x, () => import('@/features/x'), '<Export>')` trong `routes/router.tsx` → thêm `PATHS.x` vào `config/paths.ts` → thêm menu vào `components/layout/navigation.ts` (chọn nhóm, icon lucide); trang chỉ dành cho một số vai trò → thêm path vào `PAGE_ROLES` (`config/access.ts`) — menu và chặn route tự theo. Đầu trang: `<PageHeader title />` (chỉ `<h1 class="sr-only">` — **không hiện tiêu đề / mô tả**, chủ dự án chốt 2026-11-06) + `<PageToolbar actions={…}>` cùng file `components/layout/PageHeader.tsx`: nút hành động **ngang hàng thanh tab** (đặt `<TabsList>` làm children, bên trong `<Tabs>`), căn phải. Trang không có tab: nút vào hàng điều khiển sẵn có của trang (vd Phòng họp: cạnh ô chọn ngày), không có gì thì `<PageToolbar actions />` đứng một mình bên phải. **Không** tạo file route bọc lại component (không có thư mục `app/`).
- Interface đặt tên `I<Tên>`; kiểu union string literal cho enum (khớp tên enum C#).
- Gọi API **luôn** qua `http`/`httpPost`/`httpUpload` (file, multipart field `file`) (`services/api-client.ts`, `credentials: 'include'`). Không lưu token (đăng nhập bằng cookie HttpOnly).
- Lỗi: `fieldErrors(err)` cho form, `errorMessage(err)` cho toast (`utils/errors.ts`). Toast dùng `toast` từ `sonner`.
- Ngày giờ (`utils/date.ts`, múi giờ `Asia/Ho_Chi_Minh`): API trả thời điểm UTC `…Z` → hiển thị bằng `formatDate` / `formatTime` / `formatDateTime` (đổi sang giờ VN); gửi thời điểm lên bằng `toApiInstant(date)` (BE từ chối chuỗi thiếu múi giờ). Ngày / tháng "hôm nay" theo VN: `todayVn()` / `currentMonthVn()` — **không** dùng `toLocaleDateString()` không kèm `timeZone` (lấy theo máy người dùng). Ngày `yyyy-MM-dd`, giờ `HH:mm` gửi nguyên dạng.
- State: TanStack Query cho dữ liệu server; Zustand chỉ cho văn phòng 3D (`features/office/store`). Không dùng Redux.
- Style: Tailwind class; ghép class bằng `cn()` (`utils/cn.ts`). CSS thuần chỉ ở văn phòng 3D (`office-view/office.css`, mọi selector bọc trong `.office-root`).
- Bảng danh sách: **phân trang ở BE** — `usePageState` + hook `use…Page` + `TablePagination` (quy ước: [conventions.md](conventions.md) mục Phân trang).
