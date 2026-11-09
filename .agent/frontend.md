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
- Form: `FormField` / `SelectField` (`components/common`). `SelectField` dùng giá trị đặc biệt cho "không chọn" (Radix không nhận value rỗng) và trả `null`. Ngày / tháng: dùng `Input type="date"` / `type="month"` như thường — `Input` tự hiện **bộ chọn tiếng Việt** (`components/common/date-picker.tsx`: dd/mm/yyyy, "Tháng 11/2026", tuần bắt đầu T2, bấm tiêu đề → tháng → năm; min / max / required / disabled), `e.target.value` vẫn là `yyyy-MM-dd` / `yyyy-MM`. Không dùng lịch gốc của trình duyệt (hiện tiếng Anh). Tab cấp trang → **`useTabParam(mặc định, [tab được phép])`** (`hooks/useTabParam.ts`): lưu `?tab=` trên URL, reload / gửi link giữ đúng tab (tab trong hộp thoại thì không). Danh sách dài (chọn nhân viên…) → **`SearchSelectField`**: ô tìm không dấu + chỉ hiện 5 kết quả (`limit`), `hint` = chữ phụ (phòng ban). Ô nhập **tiền** → **`MoneyField` / `MoneyInput`** (`components/common/money-input.tsx`): hiện `15.000.000` khi gõ, `onValueChange(number | null)`, `allowNegative` cho khoản trừ — không dùng `type="number"` cho tiền.
- Ngày giờ (`utils/date.ts`, múi giờ `Asia/Ho_Chi_Minh`): API trả thời điểm UTC `…Z` → hiển thị bằng `formatDate` / `formatTime` / `formatDateTime` (đổi sang giờ VN); gửi thời điểm lên bằng `toApiInstant(date)` (BE từ chối chuỗi thiếu múi giờ). Ngày / tháng "hôm nay" theo VN: `todayVn()` / `currentMonthVn()` — **không** dùng `toLocaleDateString()` không kèm `timeZone` (lấy theo máy người dùng). Ngày `yyyy-MM-dd`, giờ `HH:mm` gửi nguyên dạng.
- State: TanStack Query cho dữ liệu server; Zustand chỉ cho văn phòng 3D (`features/office/store`). Không dùng Redux.
- Style: Tailwind class; ghép class bằng `cn()` (`utils/cn.ts`). CSS thuần chỉ ở văn phòng 3D (`office-view/office.css`, mọi selector bọc trong `.office-root`).
- UI dùng **shadcn/ui** (style `new-york`, Tailwind v4, `components.json`): button, card, dialog, input, label, select, checkbox, radio-group, tabs, table, badge… trong `components/common`. Không dùng `<input type="checkbox|radio">` / `<select>` thuần — dùng `Checkbox` (`onCheckedChange={(c) => set(c === true)}`), `RadioGroup`, `SelectField`.
- Modal (`DialogContent`, `SheetContent`) mặc định **không đóng khi click ra ngoài** (đã chặn `onPointerDownOutside`/`onInteractOutside` trong `components/common`); chỉ đóng bằng Esc, nút X, `DialogClose`. Cần đóng khi click ngoài → truyền `onPointerDownOutside={undefined}` tại chỗ dùng. `AlertDialog` (Radix) vốn đã vậy.
- **Cấm `window.confirm` / `prompt` / `alert`**. Xác nhận / nhập nhanh: `await confirmDialog({ title, description?, confirmText?, destructive? })` → `boolean`, `await promptDialog({ title, label?, multiline?, required? })` → chuỗi đã trim hoặc `null` (`components/common/confirm-dialog.tsx`, `<ConfirmHost />` gắn ở `App.tsx`).
- Thêm component: `bun run ui:add <tên>` (script sửa lỗi registry sinh `from "cn"`). Được chỉnh file trong `components/common` nhưng `--overwrite` sẽ ghi đè.
- Màu dùng token (`bg-background`, `text-muted-foreground`, `border`, `bg-primary`…), không hard-code mã màu → dark mode (`.dark`, nút ở header) chạy đúng. Palette slate theo shadcn-admin; đổi màu chủ đạo: `--primary`/`--ring` trong `global.css`. Animation `animate-in/out` từ `tw-animate-css`. `sonner.tsx` dùng `useTheme` của dự án thay `next-themes`.
- Màu trạng thái: token tự thêm `success` / `warning` / `info` (+ `-foreground`) cạnh `destructive` → `text-success`, `bg-warning/15`… Badge trạng thái dùng `StatusBadge` (`components/common/StatusBadge.tsx`, prop `tone`); map nhãn trong `features/<x>/utils/labels.ts` khai báo `tone`, không khai báo class màu. Sidebar dùng token `sidebar-*`.

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

Bảng danh sách: **phân trang ở BE** — `usePageState` + hook `use…Page` + `TablePagination` (quy ước: [conventions.md](conventions.md) mục Phân trang).

## Bảng nhiều cột: nút "Cột"

`components/common/columns` → `useColumns(tableId, COLUMNS)` + `<ColumnsMenu state={cols} />` (đặt ở hàng công cụ của bảng, căn phải). `COLUMNS: ColumnDef[]` khai báo hằng ngoài component (`id` ổn định, `required` = không cho ẩn, `defaultHidden`). Trong bảng: `{v('id') && <TableHead>…}` và ô tương ứng; dòng trống / đang tải dùng `colSpan={cols.span(sốCộtCốĐịnh)}`; footer có colSpan thì tính theo cột đang hiện. Lựa chọn lưu localStorage `officehub.columns.<tableId>` (mỗi trình duyệt). Đang dùng: danh bạ nhân viên, hợp đồng, kỳ lương, chấm công hôm nay / tổng hợp tháng / bảng công tháng, báo cáo tăng ca + phép năm, quỹ phép. Bảng mới ≥ 6 cột dữ liệu → thêm nút này.

