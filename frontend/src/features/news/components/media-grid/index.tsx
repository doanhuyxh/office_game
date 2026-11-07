import { useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/common/dialog';
import { cn } from '@/utils/cn';
import { errorMessage } from '@/utils/errors';
import { newsApi } from '../../api/news.api';
import type { IMedia } from '../../types/news.types';
import { formatSize } from '../../utils/labels';

/** Ảnh / video dạng lưới (như Facebook; quá 4 mục thì ô cuối hiện "+N"), tệp khác liệt kê bên dưới. Ảnh bấm để xem lớn. */
export function MediaGrid({ media }: { media: IMedia[] }) {
  const visual = media.filter((m) => m.kind !== 'File');
  const files = media.filter((m) => m.kind === 'File');
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const shown = visual.slice(0, 4);
  const extra = visual.length - shown.length;
  const images = visual.filter((m) => m.kind === 'Image');

  async function download(m: IMedia) {
    setBusy(m.id);
    try { window.open((await newsApi.mediaUrl(m.id, true)).url, '_blank', 'noopener'); }
    catch (e) { toast.error(errorMessage(e)); }
    finally { setBusy(null); }
  }

  return (
    <div className="grid gap-2">
      {visual.length > 0 && (
        <div className={cn('grid gap-0.5 overflow-hidden rounded-lg', visual.length === 1 ? 'grid-cols-1' : 'grid-cols-2')} data-testid="media-grid">
          {shown.map((m, i) => (
            <div key={m.id} className={cn('relative bg-muted', visual.length === 1 ? 'max-h-[28rem]' : 'aspect-square', visual.length === 3 && i === 0 && 'col-span-2 aspect-video')}>
              {m.kind === 'Video' ? (
                <video src={m.url ?? undefined} controls preload="metadata" className="size-full bg-black object-contain" />
              ) : (
                <button type="button" className="block size-full cursor-zoom-in" onClick={() => setOpen(images.findIndex((x) => x.id === m.id))} aria-label={`Xem ảnh ${m.fileName}`}>
                  <img src={m.url ?? undefined} alt={m.fileName} loading="lazy" className={cn('size-full', visual.length === 1 ? 'max-h-[28rem] object-contain' : 'object-cover')} />
                </button>
              )}
              {i === shown.length - 1 && extra > 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55 text-3xl font-semibold text-white">+{extra}</div>
              )}
            </div>
          ))}
        </div>
      )}
      {files.map((f) => (
        <div key={f.id} className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2">
          <FileText className="size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{f.fileName}</p>
            <p className="text-xs text-muted-foreground">{formatSize(f.size)}</p>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={busy === f.id} onClick={() => download(f)}>
            {busy === f.id ? <Loader2 className="animate-spin" /> : <Download />} Tải về
          </Button>
        </div>
      ))}
      <Lightbox images={images} index={open} onIndex={setOpen} />
    </div>
  );
}

function Lightbox({ images, index, onIndex }: { images: IMedia[]; index: number | null; onIndex: (i: number | null) => void }) {
  const cur = index !== null ? images[index] : null;
  const go = (d: number) => index !== null && onIndex((index + d + images.length) % images.length);
  return (
    <Dialog open={cur !== null} onOpenChange={(o) => !o && onIndex(null)}>
      <DialogContent className="max-w-[min(96vw,64rem)] border-0 bg-black/90 p-2 text-white sm:max-w-[min(96vw,64rem)]" onPointerDownOutside={undefined} onInteractOutside={undefined}>
        <DialogTitle className="sr-only">{cur?.fileName ?? 'Ảnh'}</DialogTitle>
        <DialogDescription className="sr-only">Xem ảnh lớn</DialogDescription>
        {cur && <img src={cur.url ?? undefined} alt={cur.fileName} className="mx-auto max-h-[85vh] w-auto object-contain" />}
        {images.length > 1 && (
          <>
            <Button type="button" variant="ghost" size="icon" className="absolute top-1/2 left-2 -translate-y-1/2 text-white hover:bg-white/20" onClick={() => go(-1)} aria-label="Ảnh trước"><ChevronLeft /></Button>
            <Button type="button" variant="ghost" size="icon" className="absolute top-1/2 right-2 -translate-y-1/2 text-white hover:bg-white/20" onClick={() => go(1)} aria-label="Ảnh sau"><ChevronRight /></Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
