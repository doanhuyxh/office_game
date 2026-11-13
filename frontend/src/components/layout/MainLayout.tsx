import { Outlet } from '@tanstack/react-router';
import { SidebarInset, SidebarProvider } from '@/components/common/sidebar';
import { ChatProvider } from '@/features/chat';
import { usePushForeground } from '@/features/notifications';
import { SearchProvider } from '@/context/search-provider';
import { AppSidebar } from './AppSidebar';
import { Header } from './Header';

/** Trạng thái mở/thu gọn sidebar — SidebarProvider tự ghi cookie "sidebar_state", ở đây chỉ đọc lại. */
const sidebarOpen = () => !document.cookie.split('; ').includes('sidebar_state=false');

/**
 * Khung các màn hình nhân sự (bố cục theo shadcn-admin): sidebar inset + header dính + nội dung.
 * `<main>` luôn rộng hết vùng nội dung ở mọi cỡ màn hình (không trần, không canh giữa); lề ngang tăng theo bề ngang vùng nội dung
 * (container query `@container/content`, tính cả sidebar mở / thu): 4 → từ @3xl 6 → từ @7xl 8 — `Header` dùng cùng lề.
 * Cỡ chữ giữ nguyên ở mọi màn hình; trang tự thêm cột khi rộng (xem .agent/frontend-layout.md).
 */
export function MainLayout() {
  usePushForeground();
  return (
    <SearchProvider>
      <ChatProvider>
        <SidebarProvider defaultOpen={sidebarOpen()}>
          <AppSidebar />
          <SidebarInset className="@container/content">
            <Header />
            <main className="flex flex-1 flex-col gap-4 px-4 py-6 sm:gap-6 @3xl/content:px-6 @7xl/content:px-8">
              <Outlet />
            </main>
          </SidebarInset>
        </SidebarProvider>
      </ChatProvider>
    </SearchProvider>
  );
}
