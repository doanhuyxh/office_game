import { Paperclip } from 'lucide-react';
import { Button } from '@/components/common/button';

/** Nút kẹp giấy + số chứng từ — bấm mở dialog. */
export function AttachmentButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="gap-1 px-2" aria-label="Chứng từ" title="Chứng từ" onClick={onClick}>
      <Paperclip className="size-4" />{count > 0 && <span className="tabular-nums">{count}</span>}
    </Button>
  );
}
