import { useState, type FormEvent } from 'react';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { Input } from '@/components/common/input';

/** Emoji gợi ý trong menu tin nhắn; emoji khác gõ tự do qua hộp thoại (server kiểm tra đúng một emoji). */
export const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/** Nhập một emoji bất kỳ (bàn phím emoji của máy) để thả vào tin. */
export function EmojiDialog({ open, onOpenChange, onPick }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (emoji: string) => void;
}) {
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    onPick(v);
    setValue('');
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Thả cảm xúc</DialogTitle>
          <DialogDescription>Nhập hoặc dán một emoji bất kỳ (Windows: Win + . · macOS: Ctrl + Cmd + Space).</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <Input autoFocus maxLength={32} value={value} onChange={(e) => setValue(e.target.value)} className="text-center text-2xl" aria-label="Emoji" data-testid="chat-emoji-input" />
          <DialogFooter>
            <Button type="submit" disabled={!value.trim()}>Thả</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
