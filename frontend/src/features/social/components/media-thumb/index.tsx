import { Film } from 'lucide-react';
import { useMediaUrl } from '../../hooks/useSocial';
import type { ISocialMedia } from '../../types/social.types';

/** Ảnh / video đã gắn vào bài (link S3 có hạn, xin khi hiển thị). */
export function MediaThumb({ media }: { media: ISocialMedia }) {
  const { data } = useMediaUrl(media.id);
  if (media.kind === 'Video') {
    return data ? (
      <video src={data.url} controls preload="metadata" className="max-h-64 w-full rounded-md bg-black" />
    ) : (
      <div className="flex h-24 items-center justify-center gap-2 rounded-md bg-muted text-xs text-muted-foreground"><Film className="size-4" />{media.fileName}</div>
    );
  }
  return data
    ? <a href={data.url} target="_blank" rel="noopener noreferrer"><img src={data.url} alt={media.fileName} className="aspect-square w-full rounded-md object-cover" loading="lazy" /></a>
    : <div className="aspect-square w-full animate-pulse rounded-md bg-muted" />;
}
