import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { STORAGE_KEY } from '@/config/env';

export type Theme = 'light' | 'dark' | 'system';

const readStored = (): Theme => {
  try {
    const v = localStorage.getItem(STORAGE_KEY.theme);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
};

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

/** Gắn class "dark" lên <html> (biến màu trong global.css). index.html chạy bản rút gọn trước khi React tải để không nháy màu. */
function apply(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && systemDark());
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#020817' : '#ffffff');
}

const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void } | null>(null);

/** Theme sáng / tối / theo hệ thống — chỉ là tuỳ chọn hiển thị, lưu localStorage của trình duyệt. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored);

  useEffect(() => {
    apply(theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = (t: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY.theme, t);
    } catch {
      /* chế độ riêng tư: chỉ đổi trong phiên */
    }
    setThemeState(t);
  };

  return <ThemeContext value={{ theme, setTheme }}>{children}</ThemeContext>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme phải nằm trong <ThemeProvider>');
  return ctx;
}
