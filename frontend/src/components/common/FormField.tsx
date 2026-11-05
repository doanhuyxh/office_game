import type { InputHTMLAttributes } from 'react';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';

/** Label + Input + lỗi theo field. */
export function FormField({ label, id, error, hint, ...props }: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  id: string;
  error?: string;
  hint?: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-invalid={!!error} {...props} />
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
