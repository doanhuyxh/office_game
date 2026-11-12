import { useCallback, useRef, useState } from 'react';

/**
 * Điều khiển bàn phím cho danh sách gợi ý @nhắc: ↑↓ chọn, Enter / Tab chèn, Esc đóng.
 * `handleKey` ổn định (đọc giá trị mới nhất qua ref) — dùng được trong cả onKeyDown của textarea lẫn editorProps của Tiptap.
 * Trả true khi đã xử lý phím (gọi preventDefault ở chỗ dùng). Danh sách đổi → gọi `setActive(0)`.
 */
export function useMentionNav<T>(options: T[], onPick: (o: T) => void, onClose: () => void) {
  const [active, setActive] = useState(0);
  const idx = Math.max(0, Math.min(active, options.length - 1));
  const latest = useRef({ options, idx, onPick, onClose });
  latest.current = { options, idx, onPick, onClose };
  const handleKey = useCallback((e: { key: string; shiftKey?: boolean; isComposing?: boolean }): boolean => {
    const s = latest.current;
    const n = s.options.length;
    if (n === 0 || e.isComposing) return false;
    if (e.key === 'ArrowDown') { setActive((s.idx + 1) % n); return true; }
    if (e.key === 'ArrowUp') { setActive((s.idx - 1 + n) % n); return true; }
    if (e.key === 'Escape') { s.onClose(); return true; }
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { s.onPick(s.options[s.idx]); return true; }
    return false;
  }, []);
  return { active: idx, setActive, handleKey };
}
