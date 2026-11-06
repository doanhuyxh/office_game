import type { ReactNode } from 'react';

/**
 * Đầu trang chuẩn. Chủ dự án chốt 2026-11-06: giao diện **không hiện tiêu đề / mô tả** trang (sidebar đã cho biết đang ở đâu).
 * `title` vẫn render thành <h1> ẩn (sr-only) cho trình đọc màn hình; `description` bỏ qua. Chỉ hiện hàng nút `actions` (căn phải) nếu có.
 */
export function PageHeader({ title, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  if (!actions) return <h1 className="sr-only">{title}</h1>;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <h1 className="sr-only">{title}</h1>
      {actions}
    </div>
  );
}
