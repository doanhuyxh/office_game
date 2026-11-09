import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';

type MoneyInputProps = Omit<ComponentProps<'input'>, 'type' | 'value' | 'onChange' | 'defaultValue'> & {
  value: number | null | undefined;
  onValueChange: (v: number | null) => void;
  /** Cho nhập dấu "-" ở đầu (vd khoản trừ lương). */
  allowNegative?: boolean;
};

const fmt = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? '' : Math.round(n).toLocaleString('vi-VN'));
const parse = (s: string, allowNegative: boolean): number | null => {
  const digits = s.replace(/\D/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return allowNegative && s.trim().startsWith('-') ? -n : n;
};

/**
 * Ô nhập tiền VND: hiển thị "15.000.000" khi gõ, trả về số qua `onValueChange` (rỗng → null).
 * Giữ vị trí con trỏ khi dấu chấm nghìn được chèn / bỏ.
 */
export function MoneyInput({ value, onValueChange, allowNegative = false, ...props }: MoneyInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null); // số chữ số đứng trước con trỏ sau lần gõ gần nhất
  const [text, setText] = useState(() => fmt(value));
  const [prev, setPrev] = useState(value);
  // Giá trị đổi từ ngoài (reset form, mở bản ghi khác) → định dạng lại; đổi do chính ô này gõ thì giữ nguyên text (vd "-" đang gõ dở).
  if (value !== prev) {
    setPrev(value);
    if (parse(text, allowNegative) !== (value ?? null)) setText(fmt(value));
  }

  useLayoutEffect(() => {
    const el = ref.current;
    if (caret.current == null || !el || document.activeElement !== el) return;
    let want = caret.current, pos = 0;
    while (pos < text.length && want > 0) { if (/[\d-]/.test(text[pos])) want--; pos++; }
    el.setSelectionRange(pos, pos);
    caret.current = null;
  }, [text]);

  return (
    <Input ref={ref} inputMode="numeric" autoComplete="off" {...props} value={text}
      onChange={(e) => {
        const raw = e.target.value;
        const neg = allowNegative && raw.trim().startsWith('-');
        const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 15);
        caret.current = raw.slice(0, e.target.selectionStart ?? raw.length).replace(/[^\d-]/g, '').replace(/^(-?)0+(?=\d)/, '$1').length;
        setText((neg ? '-' : '') + (digits ? Number(digits).toLocaleString('vi-VN') : ''));
        onValueChange(digits ? (neg ? -Number(digits) : Number(digits)) : null);
      }} />
  );
}

/** Label + MoneyInput + lỗi theo field (giống FormField). */
export function MoneyField({ label, id, error, hint, ...props }: MoneyInputProps & { label: string; id: string; error?: string; hint?: string }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <MoneyInput id={id} aria-invalid={!!error} {...props} />
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
