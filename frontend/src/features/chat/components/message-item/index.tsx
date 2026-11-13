import { Fragment, useMemo, useState, type KeyboardEvent } from 'react';
import { AlertCircle, File as FileIcon, Loader2, MoreHorizontal, Pencil, RotateCcw, SmilePlus, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/common/dropdown-menu';
import { Textarea } from '@/components/common/textarea';
import { BotBadge } from '@/components/common/bot-badge';
import { PersonAvatar } from '@/components/common/PersonAvatar';
import { formatTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { cn } from '@/utils/cn';
import { splitMentions } from '@/utils/mention';
import { chatApi } from '../../api/chat.api';
import type { IAttachment, IMention, IMessage } from '../../types/chat.types';
import { mentionsUser } from '../../utils/cache';
import { MAX_TEXT, formatBytes, isSystemMessage } from '../../utils/labels';
import { EmojiDialog, QUICK_EMOJIS } from '../emoji-dialog';
import { ReactionBar } from '../reaction-bar';

/** Cùng quy tắc server: chỉ sửa trong 24 giờ sau khi gửi. */
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const canEdit = (m: IMessage) => Date.now() - new Date(m.createdAt).getTime() <= EDIT_WINDOW_MS;

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

/** Chữ của tin: "@mã" của người được nhắc (server trả `mentions`) → "@Họ tên" tô nổi (hover: mã); phần còn lại tự nhận link. */
function MessageText({ text, mentions, mine }: { text: string; mentions?: IMention[]; mine: boolean }) {
  const names = useMemo(() => new Map((mentions ?? []).map((x) => [x.code.toUpperCase(), x.name])), [mentions]);
  if (names.size === 0) return <Linkified text={text} />;
  return (
    <>
      {splitMentions(text, names).map((part, i) =>
        typeof part === 'string' ? <Linkified key={i} text={part} />
          : <span key={i} title={part.code} data-testid="chat-mention"
            className={cn('font-semibold', mine ? 'underline underline-offset-2' : 'rounded bg-primary/10 px-0.5 text-primary')}>@{part.name}</span>)}
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

/** Ô sửa nội dung ngay trong bong bóng: Enter lưu, Shift+Enter xuống dòng, Esc huỷ. */
function EditBox({ m, onSave, onCancel }: { m: IMessage; onSave: (text: string) => Promise<boolean>; onCancel: () => void }) {
  const [text, setText] = useState(m.text ?? '');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const t = text.trim();
    if (saving || (!t && m.attachments.length === 0)) return;
    if (t === (m.text ?? '')) return onCancel();
    setSaving(true);
    const ok = await onSave(t);
    setSaving(false);
    if (ok) onCancel();
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') onCancel();
    else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void save();
    }
  };
  return (
    <div className="grid w-72 max-w-full gap-1.5">
      <Textarea autoFocus value={text} maxLength={MAX_TEXT} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={3} className="bg-background text-foreground" data-testid="chat-edit-input" />
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Huỷ</Button>
        <Button size="sm" onClick={() => void save()} disabled={saving} data-testid="chat-edit-save">{saving && <Loader2 className="animate-spin" />} Lưu</Button>
      </div>
    </div>
  );
}

/** Một tin nhắn: bong bóng (của tôi bên phải), tệp / ảnh, cảm xúc, trạng thái gửi, menu (cảm xúc, sửa, thu hồi). */
export function MessageItem({ m, mine, meId, showHeader, onRecall, onEdit, onReact, onRetry, onDiscard, onPreview }: {
  m: IMessage;
  mine: boolean;
  meId: string | undefined;
  showHeader: boolean;
  onRecall: (m: IMessage) => void;
  onEdit: (m: IMessage, text: string) => Promise<boolean>;
  onReact: (m: IMessage, emoji: string) => void;
  onRetry: (m: IMessage) => void;
  onDiscard: (m: IMessage) => void;
  onPreview: (a: IAttachment) => void;
}) {
  const local = m.local;
  const [editing, setEditing] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const mentionsMe = !mine && !m.deleted && mentionsUser(m, meId);
  // Tin hệ thống (mở / kết thúc họp với AI — người gửi OfficeHub, senderId rỗng): dòng giữa khung, không bong bóng, không menu
  if (isSystemMessage(m)) return (
    <div className="my-2 flex justify-center" data-testid="chat-system-message">
      <div className="max-w-[90%] rounded-full bg-info/10 px-3 py-1 text-center text-xs text-muted-foreground">
        <span className="font-medium text-info">{m.senderName}</span> · {formatTime(m.createdAt)} · {m.text}
      </div>
    </div>
  );
  return (
    <div className={cn('group flex gap-2', mine ? 'justify-end' : 'justify-start', showHeader ? 'mt-3' : 'mt-0.5')} data-testid="chat-message" data-mentions-me={mentionsMe || undefined}>
      {!mine && (showHeader ? <PersonAvatar name={m.senderName} className="mt-0.5 size-8 shrink-0" /> : <div className="w-8 shrink-0" />)}
      <div className={cn('flex max-w-[min(80%,48rem)] flex-col sm:max-w-[min(70%,48rem)]', mine ? 'items-end' : 'items-start')}>
        {showHeader && (
          <div className="mb-0.5 flex items-baseline gap-2 px-1 text-[11px] text-muted-foreground">
            {!mine && <span className="font-medium text-foreground/80">{m.senderName}</span>}
            {!mine && m.byBot && <BotBadge />}
            <span>{formatTime(m.createdAt)}</span>
          </div>
        )}
        {editing ? (
          <EditBox m={m} onSave={(t) => onEdit(m, t)} onCancel={() => setEditing(false)} />
        ) : (
        <div className={cn('flex items-center gap-1', mine && 'flex-row-reverse')}>
          <div
            className={cn(
              'min-w-0 rounded-2xl px-3 py-2 text-sm leading-relaxed',
              mine ? 'bg-primary text-primary-foreground' : 'bg-muted',
              mentionsMe && 'bg-warning/15 ring-1 ring-warning/60',
              m.deleted && 'bg-transparent text-muted-foreground italic ring-1 ring-border',
              local?.status === 'sending' && 'opacity-70',
              local?.status === 'failed' && 'ring-1 ring-destructive',
            )}
          >
            {m.deleted ? (
              'Tin nhắn đã thu hồi'
            ) : (
              <>
                {m.text && <p className="break-words whitespace-pre-wrap"><MessageText text={m.text} mentions={m.mentions} mine={mine} /></p>}
                {m.editedAt && <span className="text-[10px] opacity-70" title={`Sửa lúc ${formatTime(m.editedAt)}`} data-testid="chat-edited">(đã sửa)</span>}
                <Attachments items={m.attachments} local={!!local} onPreview={onPreview} />
              </>
            )}
          </div>
          {!m.deleted && !local && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7 shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 max-md:opacity-60" aria-label="Tuỳ chọn tin nhắn" data-testid="chat-message-menu">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align={mine ? 'end' : 'start'}>
                <div className="flex gap-0.5 p-1">
                  {QUICK_EMOJIS.map((e) => (
                    <DropdownMenuItem key={e} className="px-1.5 text-lg" onSelect={() => onReact(m, e)} aria-label={`Thả ${e}`} data-testid="chat-quick-emoji">{e}</DropdownMenuItem>
                  ))}
                </div>
                <DropdownMenuItem onSelect={() => setEmojiOpen(true)}><SmilePlus /> Emoji khác…</DropdownMenuItem>
                {mine && (
                  <>
                    <DropdownMenuSeparator />
                    {canEdit(m) && <DropdownMenuItem onSelect={() => setEditing(true)} data-testid="chat-edit"><Pencil /> Sửa</DropdownMenuItem>}
                    <DropdownMenuItem onSelect={() => onRecall(m)} data-testid="chat-recall"><Undo2 /> Thu hồi</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        )}
        {!m.deleted && <ReactionBar reactions={m.reactions ?? []} meId={meId} mine={mine} onToggle={(e) => onReact(m, e)} />}
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
      <EmojiDialog open={emojiOpen} onOpenChange={setEmojiOpen} onPick={(e) => onReact(m, e)} />
    </div>
  );
}
