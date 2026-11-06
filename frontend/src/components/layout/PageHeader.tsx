import type { ReactNode } from 'react';

/**
 * Tiêu đề trang — chỉ cho trình đọc màn hình. Chủ dự án chốt 2026-11-06: giao diện **không hiện tiêu đề / mô tả** trang
 * (sidebar đã cho biết đang ở đâu). Nút hành động của trang đặt bằng {@link PageToolbar}, ngang hàng thanh tab.
 */
export function PageHeader({ title }: { title: ReactNode }) {
  return <h1 className="sr-only">{title}</h1>;
}

/**
 * Hàng đầu trang: bên trái là thanh tab (`<TabsList>` — đặt bên trong `<Tabs>`) hoặc bộ lọc / chọn ngày của trang,
 * bên phải là nút hành động (căn phải; xuống dòng gọn trên điện thoại). Trang không có gì bên trái → nút đứng một mình bên phải.
 */
export function PageToolbar({ children, actions }: { children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      {actions && <div className="ms-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
