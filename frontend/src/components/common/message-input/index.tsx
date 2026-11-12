import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Loader2, SendHorizontal } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Textarea } from '@/components/common/textarea';
import { cn } from '@/utils/cn';

/** Chiều cao tối đa ô nhập (= max-h-40, khoảng 6 dòng) — quá thì cuộn bên trong. */
const MAX_HEIGHT = 160;

/**
 * Ô nhập kiểu tin nhắn dùng chung (chat, bình luận việc): một dòng khi trống, tự giãn theo nội dung,
 * nút gửi dạng icon bám đáy bên phải. Enter / Ctrl·Cmd+Enter gửi, Shift+Enter xuống dòng, đang gõ bộ gõ (isComposing) thì không gửi.
 */
export const MessageInput = forwardRef<HTMLTextAreaElement, {
  value: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
  /** Có thể gửi (mặc định: có chữ). */
  canSubmit?: boolean;
  /** Đang gửi → khoá nút + chỉ báo, chống gửi hai lần. */
  pending?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  sendLabel?: string;
  maxLength?: number;
  autoFocus?: boolean;
  onPaste?: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  /** Xử lý phím trước (vd danh sách gợi ý @nhắc); gọi preventDefault → ô nhập bỏ qua phím đó. */
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Con trỏ / vùng chọn đổi (bấm chuột, phím mũi tên). */
  onSelect?: () => void;
  /** Nút đặt trước ô nhập (vd đính kèm). */
  leading?: ReactNode;
  /** Phần phủ trong ô nhập (vd bộ đếm ký tự). */
  overlay?: ReactNode;
  inputTestId?: string;
  sendTestId?: string;
  className?: string;
}>(function MessageInput({ value, onChange, onSubmit, canSubmit, pending = false, placeholder, ariaLabel, sendLabel = 'Gửi', maxLength, autoFocus,
  onPaste, onKeyDown: onKeyDownFirst, onSelect, leading, overlay, inputTestId, sendTestId, className }, ref) {
  const area = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => area.current!, []);
  // Safari chưa hỗ trợ `field-sizing: content` (Textarea tự giãn) → ô kẹt 1 dòng. Tự giãn theo nội dung bằng JS.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el || CSS.supports?.('field-sizing', 'content')) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + el.offsetHeight - el.clientHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const enabled = !pending && (canSubmit ?? value.trim().length > 0);
  const submit = () => {
    if (!enabled) return;
    onSubmit();
    area.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDownFirst?.(e);
    if (e.defaultPrevented) return;
    if (e.key === 'Enter' && !e.nativeEvent.isComposing && (!e.shiftKey || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className={cn('flex items-end gap-2', className)}>
      {leading}
      <div className="relative min-w-0 flex-1">
        <Textarea
          ref={area}
          value={value}
          maxLength={maxLength}
          rows={1}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className="max-h-40 min-h-10 resize-none py-2"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onSelect={onSelect}
          data-testid={inputTestId}
        />
        {overlay}
      </div>
      <Button type="button" size="icon" className="shrink-0" aria-label={sendLabel} aria-busy={pending} disabled={!enabled} onClick={submit} data-testid={sendTestId}>
        {pending ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
      </Button>
    </div>
  );
});
