import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/common/collapsible';

/** Hướng dẫn tạo token System User trong Business Manager (thu gọn mặc định). */
export function SocialTokenGuide() {
  return (
    <Collapsible className="rounded-md border bg-muted/40 text-xs">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 px-3 py-2 text-left font-medium">
        Cách lấy token System User
        <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="grid list-decimal gap-1 py-2 pr-3 pl-7 text-muted-foreground">
          <li>Tạo một app loại <b>Business</b> tại developers.facebook.com và thêm app vào Business Manager (Cài đặt doanh nghiệp → Tài khoản → Ứng dụng).</li>
          <li>Cài đặt doanh nghiệp → Người dùng → <b>Người dùng hệ thống</b> → Thêm (vai trò Quản trị viên).</li>
          <li>Chọn người dùng hệ thống → <b>Gán tài sản</b> → Trang → chọn các Fanpage cần đăng, bật quyền tạo nội dung (hoặc toàn quyền).</li>
          <li><b>Tạo mã mới</b> → chọn app ở bước 1 → Hết hạn: <b>Không bao giờ</b> → quyền <code>pages_show_list</code>, <code>pages_read_engagement</code>,{' '}
            <code>pages_manage_posts</code>.</li>
          <li>Dán token vào đây. Hệ thống kiểm tra với Facebook và tự lấy danh sách trang. Thêm / bớt trang trong BM → bấm "Đồng bộ trang".</li>
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}
