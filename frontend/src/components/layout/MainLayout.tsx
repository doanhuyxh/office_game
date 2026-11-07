import { Outlet } from '@tanstack/react-router';
import { SidebarInset, SidebarProvider } from '@/components/common/sidebar';
import { SearchProvider } from '@/context/search-provider';
import { AppSidebar } from './AppSidebar';
import { Header } from './Header';

/** Trạng thái mở/thu gọn sidebar — SidebarProvider tự ghi cookie "sidebar_state", ở đây chỉ đọc lại. */
const sidebarOpen = () => !document.cookie.split('; ').includes('sidebar_state=false');

/**
 * Khung các màn hình nhân sự (bố cục theo shadcn-admin): sidebar inset + header dính + nội dung giữa trang.
 * Độ rộng nội dung theo bề ngang vùng nội dung (container query): tối đa 7xl (80rem) như Full HD; vùng ≥ 104rem (2K) → 96rem + lề 8;
 * vùng ≥ 140rem (4K / màn siêu rộng) → 128rem. Kết hợp cỡ chữ gốc tăng dần (global.css) để màn lớn không bị chữ nhỏ, khung hẹp giữa.
 */
export function MainLayout() {
  return (
    <SearchProvider>
      <SidebarProvider defaultOpen={sidebarOpen()}>
        <AppSidebar />
        <SidebarInset className="@container/content">
          <Header />
          <main className="flex flex-1 flex-col gap-4 px-4 py-6 sm:gap-6 @7xl/content:mx-auto @7xl/content:w-full @7xl/content:max-w-7xl @min-[104rem]/content:max-w-[96rem] @min-[104rem]/content:px-8 @min-[140rem]/content:max-w-[128rem]">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </SearchProvider>
  );
}
