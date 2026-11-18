import { useEffect } from 'react';

/** Ô nhập kiểu nút / chọn (không gõ chữ) → không cần menu gốc để dán / sửa chính tả. */
const NON_TEXT_INPUT = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image', 'hidden']);

/** Phần tử nhận chữ (input chữ, textarea, contenteditable) → vẫn để menu gốc của trình duyệt. */
function isTextEditable(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const el = target.closest('input, textarea, [contenteditable]');
  if (!el) return false;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUT.has(el.type);
  if (el instanceof HTMLTextAreaElement) return true;
  return (el as HTMLElement).isContentEditable;
}

/**
 * Bỏ menu chuột phải (mobile: nhấn giữ) mặc định của trình duyệt trên toàn web (TEST-174) — gọi một lần ở `App.tsx`.
 * Ngoại lệ: ô nhập chữ / textarea / contenteditable giữ menu gốc. Chỉ là giao diện, không phải lớp bảo mật:
 * không chặn phím tắt, không chặn chọn / sao chép chữ. Canvas văn phòng 3D tự chặn riêng (`OfficeScene`).
 */
export function useBlockContextMenu() {
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      if (!isTextEditable(e.target)) e.preventDefault();
    };
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, []);
}
