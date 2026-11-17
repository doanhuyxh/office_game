import { useState } from 'react';
import { Download, File as FileIcon } from 'lucide-react';
import { ImageViewer, type ImageViewerItem } from '@/components/common/image-viewer';
import type { ICommentAttachment } from '../../types/project.types';
import { formatBytes } from '../../utils/attachments';

/**
 * Ảnh / tệp đính kèm dưới nội dung một bình luận việc: ảnh = ô thu nhỏ, bấm mở trình xem dùng chung (`ImageViewer`, lướt qua mọi ảnh
 * của bình luận); tệp khác = chip tên + dung lượng, bấm tải về. Link presigned hết hạn sau 60 phút — mở lại việc để lấy link mới.
 */
export function CommentAttachments({ attachments, caption }: { attachments: ICommentAttachment[]; caption?: string }) {
  const [index, setIndex] = useState<number | null>(null);
  if (attachments.length === 0) return null;
  const images = attachments.filter((a) => a.isImage && a.url);
  const files = attachments.filter((a) => !(a.isImage && a.url));
  const gallery: ImageViewerItem[] = images.map((a) => ({ id: a.id, url: a.url, fileName: a.fileName, caption }));

  return (
    <div className="mt-1.5 grid gap-1.5" data-testid="task-comment-attachments">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {images.map((a, i) => (
            <button key={a.id} type="button" className="overflow-hidden rounded-md border bg-background hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              aria-label={`Xem ảnh ${a.fileName}`} title={a.fileName} onClick={() => setIndex(i)} data-testid="task-comment-image">
              <img src={a.url} alt={a.fileName} loading="lazy" className="size-24 object-cover" />
            </button>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {files.map((a) => (
            <li key={a.id}>
              <a href={a.url} download={a.fileName} target="_blank" rel="noopener noreferrer" title={`Tải ${a.fileName}`} data-testid="task-comment-file"
                className="flex max-w-64 items-center gap-2 rounded-md border bg-background py-1.5 ps-2 pe-2.5 hover:bg-muted">
                <FileIcon className="size-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">{a.fileName}</span>
                  <span className="block text-[11px] text-muted-foreground">{formatBytes(a.size)}</span>
                </span>
                <Download className="size-3.5 shrink-0 text-muted-foreground" />
              </a>
            </li>
          ))}
        </ul>
      )}
      <ImageViewer images={gallery} index={index} onIndex={setIndex} />
    </div>
  );
}
