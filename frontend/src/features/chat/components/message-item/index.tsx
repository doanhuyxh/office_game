import { Fragment } from 'react';
import { AlertCircle, File as FileIcon, Loader2, MoreHorizontal, RotateCcw, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/common/dropdown-menu';
import { BotBadge } from '@/components/common/bot-badge';
import { PersonAvatar } from '@/components/common/PersonAvatar';
import { formatTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { cn } from '@/utils/cn';
import { chatApi } from '../../api/chat.api';
import type { IAttachment, IMessage } from '../../types/chat.types';
import { formatBytes } from '../../utils/labels';

const URL_RE = /(https?:\/\/[^\s<>"']+)/g;

/** Văn bản thuần: tự biến đường dẫn http(s) thành liên kết (React tự escape, không chèn HTML). */
function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_RE).map((part, i) =>
        i % 2 ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 break-all">{part}</a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ))}
    </>
  );
}

async function download(a: IAttachment) {
  try {
    const { url } = await chatApi.attachmentUrl(a.id, true);
    const link = document.createElement('a');
    link.href = url;
    link.rel = 'noopener';
    link.click();
  } catch (e) {
    toast.error(errorMessage(e, 'Không tải được tệp'));
  }
}

function Attachments({ items, local, onPreview }: { items: IAttachment[]; local: boolean; onPreview: (a: IAttachment) => void }) {
  if (items.length === 0) return null;
  const images = items.filter((a) => a.isImage && a.url);
  const files = items.filter((a) => !(a.isImage && a.url));
  return (
    <div className="mt-1.5 grid gap-1.5 first:mt-0">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {images.map((a) => (
            <button key={a.id} type="button" className="overflow-hidden rounded-md" onClick={() => onPreview(a)} aria-label={`Xem ảnh ${a.fileName}`}>
              <img src={a.url} alt={a.fileName} loading="lazy" className="max-h-56 max-w-full object-cover sm:max-w-72" />
            </button>
          ))}
        </div>
      )}
      {files.map((a) => (
        <button
          key={a.id}
          type="button"
          disabled={local}
          onClick={() => void download(a)}
          className="flex max-w-72 items-center gap-2 rounded-md border bg-background/60 px-2.5 py-1.5 text-start text-foreground hover:bg-background disabled:opacity-70"
          title={local ? a.fileName : `Tải ${a.fileName}`}
        >
          <FileIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">{a.fileName}</span>
            <span className="block text-[11px] text-muted-foreground">{formatBytes(a.size)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Một tin nhắn: bong bóng (của tôi bên phải), tệp / ảnh, trạng thái gửi, menu thu hồi. */
export function MessageItem({ m, mine, showHeader, onRecall, onRetry, onDiscard, onPreview }: {
  m: IMessage;
  mine: boolean;
  showHeader: boolean;
  onRecall: (m: IMessage) => void;
  onRetry: (m: IMessage) => void;
  onDiscard: (m: IMessage) => void;
  onPreview: (a: IAttachment) => void;
}) {
  const local = m.local;
  return (
    <div className={cn('group flex gap-2', mine ? 'justify-end' : 'justify-start', showHeader ? 'mt-3' : 'mt-0.5')} data-testid="chat-message">
      {!mine && (showHeader ? <PersonAvatar name={m.senderName} className="mt-0.5 size-8 shrink-0" /> : <div className="w-8 shrink-0" />)}
      <div className={cn('flex max-w-[80%] flex-col sm:max-w-[70%]', mine ? 'items-end' : 'items-start')}>
        {showHeader && (
          <div className="mb-0.5 flex items-baseline gap-2 px-1 text-[11px] text-muted-foreground">
            {!mine && <span className="font-medium text-foreground/80">{m.senderName}</span>}
            {!mine && m.byBot && <BotBadge />}
            <span>{formatTime(m.createdAt)}</span>
          </div>
        )}
        <div className={cn('flex items-center gap-1', mine && 'flex-row-reverse')}>
          <div
            className={cn(
              'min-w-0 rounded-2xl px-3 py-2 text-sm leading-relaxed',
              mine ? 'bg-primary text-primary-foreground' : 'bg-muted',
              m.deleted && 'bg-transparent text-muted-foreground italic ring-1 ring-border',
              local?.status === 'sending' && 'opacity-70',
              local?.status === 'failed' && 'ring-1 ring-destructive',
            )}
          >
            {m.deleted ? (
              'Tin nhắn đã thu hồi'
            ) : (
              <>
                {m.text && <p className="break-words whitespace-pre-wrap"><Linkified text={m.text} /></p>}
                <Attachments items={m.attachments} local={!!local} onPreview={onPreview} />
              </>
            )}
          </div>
          {mine && !m.deleted && !local && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7 shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 max-md:opacity-60" aria-label="Tuỳ chọn tin nhắn">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onRecall(m)} data-testid="chat-recall"><Undo2 /> Thu hồi</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {local?.status === 'sending' && (
          <span className="mt-0.5 flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {m.attachments.length > 0 && local.progress > 0 ? `Đang tải lên ${Math.round(local.progress * 100)}%` : 'Đang gửi…'}
          </span>
        )}
        {local?.status === 'failed' && (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 text-[11px] text-destructive">
            <AlertCircle className="size-3" /> {local.error ?? 'Gửi không được'}
            <button type="button" className="inline-flex items-center gap-0.5 font-medium underline" onClick={() => onRetry(m)}><RotateCcw className="size-3" /> Gửi lại</button>
            <button type="button" className="inline-flex items-center gap-0.5 font-medium underline" onClick={() => onDiscard(m)}><X className="size-3" /> Bỏ</button>
          </span>
        )}
      </div>
    </div>
  );
}
