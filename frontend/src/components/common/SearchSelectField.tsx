import { useMemo, useRef, useState } from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { Check, ChevronDown, Search } from 'lucide-react';
import { Label } from '@/components/common/label';
import { cn } from '@/utils/cn';
import type { SelectOption } from './SelectField';

export interface SearchOption extends SelectOption {
  /** Chữ phụ (phòng ban…) — hiện mờ, cũng dùng để tìm. */
  hint?: string;
}

/** Bỏ dấu tiếng Việt + chữ thường để tìm "nguyen" ra "Nguyễn". */
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

/**
 * Ô chọn có tìm kiếm cho danh sách dài (nhân viên…): bấm mở → ô tìm (không phân biệt dấu) + tối đa `limit` kết quả (mặc định 5).
 * Phím ↑ ↓ chọn, Enter xác nhận, Esc đóng. Cùng giao diện / props với SelectField (`allowEmpty` = lựa chọn "— Không —").
 */
export function SearchSelectField({ id, label, value, onChange, options, allowEmpty, emptyLabel = '— Không —', error, placeholder, limit = 5,
  searchPlaceholder = 'Gõ mã, tên, phòng ban…' }: {
  id: string;
  label: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  options: SearchOption[];
  allowEmpty?: boolean;
  emptyLabel?: string;
  error?: string;
  placeholder?: string;
  limit?: number;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value);

  const matches = useMemo(() => {
    const t = fold(q.trim());
    return t ? options.filter((o) => fold(`${o.label} ${o.hint ?? ''}`).includes(t)) : options;
  }, [options, q]);
  // Danh sách hiển thị: (— Không —) + tối đa `limit` kết quả
  const shown = useMemo(() => {
    const list: (SearchOption | null)[] = matches.slice(0, limit);
    return allowEmpty && !q.trim() ? [null, ...list] : list;
  }, [matches, limit, allowEmpty, q]);

  const pick = (o: SearchOption | null) => {
    onChange(o?.value ?? null);
    setOpen(false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown.length) pick(shown[Math.min(active, shown.length - 1)]); }
  };

  return (
    <div className="grid min-w-0 gap-2">
      {label && <Label htmlFor={id}>{label}</Label>}
      <PopoverPrimitive.Root open={open} onOpenChange={(o) => { setOpen(o); if (o) { setQ(''); setActive(0); } }}>
        <PopoverPrimitive.Trigger asChild>
          <button id={id} type="button" aria-invalid={!!error}
            className={cn('flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-left text-sm shadow-xs outline-none',
              'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50')}>
            <span className={cn('truncate', !selected && 'text-muted-foreground')}>
              {selected ? selected.label : value == null && allowEmpty ? emptyLabel : (placeholder ?? 'Chọn…')}
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content align="start" sideOffset={4} onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus(); }}
            collisionPadding={8}
            className="z-50 w-(--radix-popover-trigger-width) min-w-[min(16rem,var(--radix-popover-content-available-width))] max-w-(--radix-popover-content-available-width) rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
            <div className="flex items-center gap-2 border-b px-2 pb-1">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey}
                placeholder={searchPlaceholder} aria-label="Tìm" className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            </div>
            <ul role="listbox" className="mt-1 grid max-h-72 grid-cols-[minmax(0,1fr)] gap-0.5 overflow-y-auto">
              {shown.map((o, i) => {
                const isSel = o ? o.value === value : value == null;
                return (
                  <li key={o?.value ?? '__none__'} role="option" aria-selected={isSel} className="min-w-0">
                    <button type="button" onClick={() => pick(o)} onMouseEnter={() => setActive(i)}
                      className={cn('flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm', i === active && 'bg-accent text-accent-foreground')}>
                      <span className="min-w-0 flex-1 truncate">
                        {o ? o.label : emptyLabel}
                        {o?.hint && <span className="ml-1 text-xs text-muted-foreground">{o.hint}</span>}
                      </span>
                      {isSel && <Check className="size-4 shrink-0" />}
                    </button>
                  </li>
                );
              })}
            </ul>
            {matches.length === 0 && <p className="px-2 py-2 text-sm text-muted-foreground">Không tìm thấy.</p>}
            {matches.length > limit && (
              <p className="px-2 pt-1 text-xs text-muted-foreground">Còn {matches.length - limit} kết quả — gõ thêm để lọc</p>
            )}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
