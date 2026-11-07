import { Outlet } from '@tanstack/react-router';
import { SidebarInset, SidebarProvider } from '@/components/common/sidebar';
import { ChatProvider } from '@/features/chat';
import { SearchProvider } from '@/context/search-provider';
import { AppSidebar } from './AppSidebar';
import { Header } from './Header';

/** Trạng thái mở/thu gọn sidebar — SidebarProvider tự ghi cookie "sidebar_state", ở đây chỉ đọc lại. */
const sidebarOpen = () => !document.cookie.split('; ').includes('sidebar_state=false');

/**
 * Khung các màn hình nhân sự (bố cục theo shadcn-admin): sidebar inset + header dính + nội dung giữa trang.
 * Độ rộng nội dung theo bề ngang vùng nội dung (container query): tối đa 7xl (80rem) như Full HD; vùng ≥ 112rem (màn 2K trở lên) → trải
 * gần hết bề ngang (tối đa 200rem) + lề 8 để hiển thị nhiều nội dung hơn. Cỡ chữ giữ nguyên ở mọi màn hình.
 */
export function MainLayout() {
  return (
    <SearchProvider>
      <ChatProvider>
        <SidebarProvider defaultOpen={sidebarOpen()}>
          <AppSidebar />
          <SidebarInset className="@container/content">
            <Header />
            <main className="flex flex-1 flex-col gap-4 px-4 py-6 sm:gap-6 @7xl/content:mx-auto @7xl/content:w-full @7xl/content:max-w-7xl @min-[112rem]/content:max-w-[200rem] @min-[112rem]/content:px-8">
              <Outlet />
            </main>
          </SidebarInset>
        </SidebarProvider>
      </ChatProvider>
    </SearchProvider>
  );
}
