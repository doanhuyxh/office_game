import { useEffect, useState } from 'react';

/**
 * Ảnh màn hình bot đang chiếu (cập nhật vài giây / lần, URL đổi `?v=`): tải ảnh mới ngầm rồi mới thay → không nháy trắng giữa hai khung.
 * Ảnh mới lỗi (bot vừa tắt chiếu…) → giữ khung cũ.
 */
export function LiveImage({ src, alt }: { src: string; alt: string }) {
  const [shown, setShown] = useState(src);
  useEffect(() => {
    if (src === shown) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => { if (!cancelled) setShown(src); };
    img.src = src;
    return () => { cancelled = true; };
  }, [src, shown]);
  return <img src={shown} alt={alt} data-testid="office-screen-live-img" />;
}
