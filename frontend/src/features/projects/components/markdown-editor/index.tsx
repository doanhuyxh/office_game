import type { ReactNode } from 'react';
import { Label } from '@/components/common/label';
import { Markdown } from '@/components/common/markdown';
import { Textarea } from '@/components/common/textarea';

/**
 * Ô Markdown có 2 chế độ Viết / Xem trước (nội dung việc, hướng dẫn làm việc của dự án). Chế độ do component cha giữ (`preview`)
 * để tự chọn khi mở hộp thoại; không sửa được (`editable=false`) → luôn xem. Nhấp đúp vùng xem → chuyển sang viết.
 */
export function MarkdownEditor({ id, label, value, onChange, preview, onPreviewChange, editable = true, rows = 10, maxLength, placeholder, error,
  emptyText = 'Chưa có nội dung.', minHeightClass = '' }: {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  preview: boolean;
  onPreviewChange: (v: boolean) => void;
  editable?: boolean;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  error?: string;
  emptyText?: string;
  /** Chiều cao tối thiểu cho cả ô viết lẫn vùng xem (Textarea tự co theo nội dung nên `rows` không giữ chiều cao). */
  minHeightClass?: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {editable && <div className="flex shrink-0 rounded-md border p-0.5 text-xs">
          {([['Viết', false], ['Xem trước', true]] as const).map(([text, v]) => (
            <button key={text} type="button" onClick={() => onPreviewChange(v)}
              className={`rounded px-2 py-0.5 ${preview === v ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground'}`}>{text}</button>))}
        </div>}
      </div>
      {preview || !editable
        ? <div className={`min-h-20 rounded-md border px-3 py-2 wrap-anywhere ${minHeightClass}`} onDoubleClick={() => editable && onPreviewChange(false)}>
            {value.trim() ? <Markdown text={value} /> : <p className="text-sm text-muted-foreground">{emptyText}</p>}
          </div>
        : <Textarea id={id} rows={rows} maxLength={maxLength} className={`font-mono text-xs ${minHeightClass}`} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
