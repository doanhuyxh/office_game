import { Outlet } from '@tanstack/react-router';
import { SidebarInset, SidebarProvider } from '@/components/common/sidebar';
import { SearchProvider } from '@/context/search-provider';
import { AppSidebar } from './AppSidebar';
import { Header } from './Header';

/** Trạng thái mở/thu gọn sidebar — SidebarProvider tự ghi cookie "sidebar_state", ở đây chỉ đọc lại. */
const sidebarOpen = () => !document.cookie.split('; ').includes('sidebar_state=false');

/** Khung các màn hình nhân sự (bố cục theo shadcn-admin): sidebar inset + header dính + nội dung tối đa 7xl. */
export function MainLayout() {
  return (
    <SearchProvider>
      <SidebarProvider defaultOpen={sidebarOpen()}>
        <AppSidebar />
        <SidebarInset className="@container/content">
          <Header />
          <main className="flex flex-1 flex-col gap-4 px-4 py-6 sm:gap-6 @7xl/content:mx-auto @7xl/content:w-full @7xl/content:max-w-7xl">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </SearchProvider>
  );
}
