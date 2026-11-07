import { useEffect, useState } from 'react';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { Textarea } from '@/components/common/textarea';

/** Hỏi lý do (ẩn bài / bình luận — HR). Tác giả nhận được lý do này trong thông báo. */
export function ReasonDialog({ open, title, description, confirmLabel, busy, onClose, onConfirm }: {
  open: boolean; title: string; description: string; confirmLabel: string; busy?: boolean; onClose: () => void; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) setReason(''); }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Lý do (bắt buộc)" data-testid="reason-input" autoFocus />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
          <Button type="button" variant="destructive" disabled={busy || reason.trim().length === 0} onClick={() => onConfirm(reason.trim())} data-testid="reason-confirm">{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
