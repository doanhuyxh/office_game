import * as React from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/utils/cn';
import { todayVn } from '@/utils/date';

/**
 * Bộ chọn ngày / tháng tiếng Việt thay cho lịch của trình duyệt (`<input type="date|month">` hiện theo ngôn ngữ trình duyệt — thường tiếng Anh).
 * `Input` (components/common/input.tsx) tự dùng bộ này khi `type="date"` / `type="month"`, nên chỗ gọi giữ nguyên:
 * value = "yyyy-MM-dd" / "yyyy-MM" (rỗng = chưa chọn), onChange nhận object có `target.value` như sự kiện input.
 * Ngày: tuần bắt đầu Thứ 2, bấm tiêu đề → chọn tháng → chọn năm (nhảy nhanh cho ngày sinh). Hỗ trợ min / max / required / disabled.
 */
type Kind = 'date' | 'month';
type View = 'days' | 'months' | 'years';

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const MONTHS = Array.from({ length: 12 }, (_, i) => `Th ${i + 1}`);
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const ym = (y: number, m: number) => `${y}-${pad(m)}`;

/** "2026-11-07" → "07/11/2026"; "2026-11" → "Tháng 11/2026". */
export function formatPickerValue(kind: Kind, v: string) {
  if (!v) return '';
  const [y, m, d] = v.split('-');
  return kind === 'month' ? `Tháng ${Number(m)}/${y}` : `${d}/${m}/${y}`;
}

export interface PickerInputProps {
  kind: Kind;
  id?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  name?: string;
  'aria-label'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
}

export function PickerInput({ kind, id, value = '', onChange, min, max, required, disabled, className, name, ...aria }: PickerInputProps) {
  const today = todayVn();
  const base = value || (kind === 'month' ? today.slice(0, 7) : today);
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<View>(kind === 'month' ? 'months' : 'days');
  const [year, setYear] = React.useState(Number(base.slice(0, 4)));
  const [month, setMonth] = React.useState(Number(base.slice(5, 7)));

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (o) { setYear(Number(base.slice(0, 4))); setMonth(Number(base.slice(5, 7))); setView(kind === 'month' ? 'months' : 'days'); }
  };
  const emit = (v: string) => {
    onChange?.({ target: { value: v, name }, currentTarget: { value: v, name } } as unknown as React.ChangeEvent<HTMLInputElement>);
    setOpen(false);
  };
  const outOfRange = (v: string) => (!!min && v < min.slice(0, v.length)) || (!!max && v > max.slice(0, v.length));

  const title = view === 'days' ? `Tháng ${month}, ${year}` : view === 'months' ? String(year) : `${year - (year % 12)} – ${year - (year % 12) + 11}`;
  const step = (dir: -1 | 1) => {
    if (view === 'days') {
      const m = month + dir;
      if (m < 1) { setMonth(12); setYear(year - 1); } else if (m > 12) { setMonth(1); setYear(year + 1); } else setMonth(m);
    } else setYear(year + dir * (view === 'months' ? 1 : 12));
  };

  // Lưới ngày: bắt đầu từ Thứ 2 của tuần chứa ngày 1
  const days = React.useMemo(() => {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const offset = (first.getUTCDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(Date.UTC(year, month - 1, 1 - offset + i));
      return { v: ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), day: d.getUTCDate(), inMonth: d.getUTCMonth() + 1 === month };
    });
  }, [year, month]);

  const cell = 'flex items-center justify-center rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-30';

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <div className={cn('relative w-full', className)}>
        {/* Ô ẩn để `required` của form vẫn chặn gửi khi chưa chọn */}
        <input tabIndex={-1} aria-hidden name={name} required={required} value={value} onChange={() => {}}
          className="pointer-events-none absolute inset-0 h-full w-full opacity-0" />
        <PopoverPrimitive.Trigger asChild disabled={disabled}>
          <button id={id} type="button" data-slot="input" aria-label={aria['aria-label']} aria-invalid={aria['aria-invalid']}
            className={cn('relative flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-left text-base shadow-xs outline-none md:text-sm dark:bg-input/30',
              'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
              'aria-invalid:border-destructive aria-invalid:ring-destructive/20')}>
            <span className={cn('truncate', !value && 'text-muted-foreground')}>
              {value ? formatPickerValue(kind, value) : kind === 'month' ? 'Chọn tháng' : 'dd/mm/yyyy'}
            </span>
            <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverPrimitive.Trigger>
      </div>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content align="start" sideOffset={4} data-testid="date-picker"
          className="z-50 w-72 rounded-md border bg-popover p-3 text-popover-foreground shadow-md">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" className={cn(cell, 'size-8')} onClick={() => step(-1)} aria-label="Trước"><ChevronLeft className="size-4" /></button>
            <button type="button" className={cn(cell, 'h-8 px-2 font-semibold')} disabled={view === 'years'}
              onClick={() => setView(view === 'days' ? 'months' : 'years')} title="Chọn nhanh">{title}</button>
            <button type="button" className={cn(cell, 'size-8')} onClick={() => step(1)} aria-label="Sau"><ChevronRight className="size-4" /></button>
          </div>

          {view === 'days' && (
            <div className="grid grid-cols-7 gap-0.5">
              {WEEKDAYS.map((w) => <div key={w} className="py-1 text-center text-xs text-muted-foreground">{w}</div>)}
              {days.map((d) => (
                <button key={d.v} type="button" disabled={outOfRange(d.v)} onClick={() => emit(d.v)}
                  className={cn(cell, 'h-8', !d.inMonth && 'text-muted-foreground/60', d.v === today && 'font-semibold text-primary',
                    d.v === value && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground')}>{d.day}</button>
              ))}
            </div>
          )}
          {view === 'months' && (
            <div className="grid grid-cols-4 gap-1">
              {MONTHS.map((label, i) => {
                const v = ym(year, i + 1);
                const selected = kind === 'month' ? value === v : value.slice(0, 7) === v;
                return (
                  <button key={label} type="button" disabled={kind === 'month' && outOfRange(v)}
                    onClick={() => (kind === 'month' ? emit(v) : (setMonth(i + 1), setView('days')))}
                    className={cn(cell, 'h-9', v === today.slice(0, 7) && 'font-semibold text-primary',
                      selected && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground')}>{label}</button>
                );
              })}
            </div>
          )}
          {view === 'years' && (
            <div className="grid grid-cols-4 gap-1">
              {Array.from({ length: 12 }, (_, i) => year - (year % 12) + i).map((y) => (
                <button key={y} type="button" onClick={() => { setYear(y); setView('months'); }}
                  className={cn(cell, 'h-9', y === Number(today.slice(0, 4)) && 'font-semibold text-primary',
                    value.startsWith(String(y)) && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground')}>{y}</button>
              ))}
            </div>
          )}

          <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm">
            {kind === 'date' && !required && value ? <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => emit('')}>Xoá</button> : <span />}
            {kind === 'month'
              ? <button type="button" className="text-primary hover:underline" disabled={outOfRange(today.slice(0, 7))} onClick={() => emit(today.slice(0, 7))}>Tháng này</button>
              : <button type="button" className="text-primary hover:underline" disabled={outOfRange(today)} onClick={() => emit(today)}>Hôm nay</button>}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
