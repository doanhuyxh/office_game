import { useEffect, useState } from 'react';

/** Trả về giá trị sau khi ngừng thay đổi `delay` ms (ô tìm kiếm). */
export function useDebounce<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
