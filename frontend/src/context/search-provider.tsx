import { createContext, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';

const SearchContext = createContext<{ open: boolean; setOpen: Dispatch<SetStateAction<boolean>> } | null>(null);

/** Trạng thái hộp tìm nhanh (Ctrl/⌘ + K). Hộp thoại nằm ở components/layout/CommandMenu. */
export function SearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return <SearchContext value={{ open, setOpen }}>{children}</SearchContext>;
}

export function useSearch() {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error('useSearch phải nằm trong <SearchProvider>');
  return ctx;
}
