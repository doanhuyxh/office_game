import { Label } from '@/components/common/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/common/select';

/** Radix Select không cho value rỗng → dùng giá trị đặc biệt cho "không chọn". */
const NONE = '__none__';

export interface SelectOption {
  value: string;
  label: string;
}

/** Label + Select (shadcn). `allowEmpty` thêm lựa chọn "— Không —" (giá trị null). */
export function SelectField({ id, label, value, onChange, options, allowEmpty, emptyLabel = '— Không —', error, placeholder }: {
  id: string;
  label: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  options: SelectOption[];
  allowEmpty?: boolean;
  emptyLabel?: string;
  error?: string;
  placeholder?: string;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value ?? (allowEmpty ? NONE : undefined)} onValueChange={(v) => onChange(v === NONE ? null : v)}>
        <SelectTrigger id={id} className="w-full min-w-0" aria-invalid={!!error}>
          <SelectValue className="min-w-0 truncate block!" placeholder={placeholder ?? 'Chọn…'} />
        </SelectTrigger>
        <SelectContent>
          {allowEmpty && <SelectItem value={NONE}>{emptyLabel}</SelectItem>}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
