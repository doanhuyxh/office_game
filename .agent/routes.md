# Route API và trang front-end

> Nguồn sự thật: `MapEndpoints` của từng module, `frontend/src/routes/router.tsx`. Kiến trúc chung: [architecture.md](architecture.md). Về [AGENTS.md](../AGENTS.md).

## Route API

| Tiền tố | Module | Tài liệu |
|---|---|---|
| `/api/auth/*` | Identity | [business/auth.md](business/auth.md) |
| `/api/org/*` | Organization | [business/organization.md](business/organization.md) |
| `/api/attendance/*` | Attendance | [business/attendance.md](business/attendance.md), [business/attendance-corrections.md](business/attendance-corrections.md), [business/attendance-overtime.md](business/attendance-overtime.md) |
| `/api/notifications/*` | Notification | [business/notifications.md](business/notifications.md) |
| `/api/contracts/*` | LaborContracts | [business/contracts.md](business/contracts.md) |
| `/api/approval/*` | Approval | [business/approval.md](business/approval.md) |
| `/api/leave/*` | Leave | [business/leave.md](business/leave.md) |
| `/rt/hub/office`, `/rt/voice/token` | Realtime | [business/office.md](business/office.md) |
| `/api/reports`, `/api/audit` | khung | chỉ `GET /_status` |

## Trang front-end (`routes/router.tsx`)

| Path | Guard | Component (barrel) |
|---|---|---|
| `/login`, `/forgot-password` | `guestOnly` (đã đăng nhập → `/`) | `LoginForm`, `ForgotPasswordForm` (`@/features/auth`) |
| `/accept-invite`, `/reset-password` | không (link email, search `uid`, `token`) | `AcceptInviteForm`, `ResetPasswordForm` |
| `/change-password` | `requireSession` | `ChangePasswordForm` |
| `/office` | `requireAuth`, toàn màn hình | `OfficeView` (`@/features/office`, lazy, kéo Three.js) |
| `/` `/attendance` `/employees` `/leave` `/approvals` `/contracts` `/reports` | `requireAuth`, trong `MainLayout` | `Dashboard`, `AttendancePage`, `EmployeesPage`, `LeavePage`, `ApprovalsPage`, `ContractsPage`; reports là `ComingSoon` |

`requireAuth`: chưa đăng nhập → `/login?returnUrl=…`; `mustChangePassword` → `/change-password`. Quay lại sau đăng nhập dùng `safeReturnPath` (chỉ đường dẫn cùng origin). Mọi trang trong `page(...)` là lazy chunk; Three.js tách chunk `three` (`vite.config.ts` `manualChunks`). Menu sidebar (nhóm → mục, icon lucide) lọc theo `roles` trong `components/layout/navigation.ts` (Hợp đồng, Báo cáo: admin/hr; còn lại ai cũng thấy). Bố cục khung trang: [frontend.md](frontend.md#bố-cục-mainlayout).

