import { ExternalLink } from 'lucide-react';
import { isTrustedMediaUrl } from '@/utils/trustedMedia';
import { mediaKind } from '../../utils/media';

/** Xem trước link ảnh / video của việc: ảnh → <img>, file video → <video>, YouTube / Vimeo / Google Drive → iframe, còn lại → link. */
export function TaskMedia({ links }: { links: string[] }) {
  if (!links.length) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {links.map((url) => {
        const k = mediaKind(url);
        // Ảnh / file video ngoài S3 / cùng domain → chỉ hiện link (không tự tải từ máy người xem); YouTube / Vimeo / Drive nhúng như cũ
        const m = (k.kind === 'image' || k.kind === 'video') && !isTrustedMediaUrl(url) ? { kind: 'link' as const } : k;
        const open = (
          <a href={url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-1 text-xs text-primary hover:underline">
            <ExternalLink className="size-3 shrink-0" /><span className="truncate">{url}</span>
          </a>
        );
        if (m.kind === 'link') return <div key={url} className="rounded-md border p-2 sm:col-span-2">{open}</div>;
        return (
          <div key={url} className="grid gap-1 overflow-hidden rounded-md border p-1.5">
            {m.kind === 'image' && <a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt="" loading="lazy" className="max-h-60 w-full rounded bg-muted object-contain" /></a>}
            {m.kind === 'video' && <video src={url} controls preload="metadata" className="max-h-60 w-full rounded bg-black" />}
            {m.kind === 'embed' && <iframe src={m.src} title={url} loading="lazy" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin" className="aspect-video w-full rounded bg-black" />}
            {open}
          </div>
        );
      })}
    </div>
  );
}
