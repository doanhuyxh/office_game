import { useMemo, useState } from 'react';
import { Building2, DoorOpen, PanelLeftClose, PanelLeftOpen, Plus, Search, Users } from 'lucide-react';
import { BotBadge } from '@/components/common/bot-badge';
import { Button } from '@/components/common/button';
import { Input } from '@/components/common/input';
import { PersonAvatar } from '@/components/common/PersonAvatar';
import { Skeleton } from '@/components/common/skeleton';
import { formatDate, formatTime, todayVn, toVnDate } from '@/utils/date';
import { cn } from '@/utils/cn';
import type { IConversation } from '../../types/chat.types';
import { fold } from '../../utils/labels';

export function ConversationIcon({ c, className }: { c: IConversation; className?: string }) {
  if (c.type === 'Direct') return <PersonAvatar name={c.title} className={cn('size-10', className)} />;
  const Icon = c.type === 'Office' ? Building2 : c.type === 'Group' ? Users : DoorOpen;
  return (
    <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary', className)}>
      <Icon className="size-5" />
    </div>
  );
}

const when = (iso: string | null) => (!iso ? '' : toVnDate(iso) === todayVn() ? formatTime(iso) : formatDate(iso));

const UnreadBadge = ({ c, className }: { c: IConversation; className?: string }) => (
  <span className={cn('flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white', className)} data-testid="chat-conversation-unread">
    {c.unread > 99 ? '99+' : c.unread}
  </span>
);

/**
 * Cột trái trang chat: ô tìm, nút "Tin nhắn mới", danh sách hội thoại (Office ghim đầu). Dùng chung cho khung chat văn phòng 3D (TEST-126):
 * `pinnedId` = hội thoại xếp lên đầu kèm nhãn `pinnedLabel` (kênh phòng đang đứng); `compact` = cột biểu tượng 60 px (tên ở tooltip,
 * số chưa đọc trên biểu tượng); `onToggleCompact` có → hiện nút thu gọn / mở rộng.
 */
export function ConversationList({ conversations, loading, selectedId, onSelect, onNew, pinnedId, pinnedLabel, compact, onToggleCompact }: {
  conversations: IConversation[] | undefined;
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  pinnedId?: string | null;
  pinnedLabel?: string;
  compact?: boolean;
  onToggleCompact?: () => void;
}) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const kw = compact ? '' : fold(q.trim());
    const list = (conversations ?? []).filter((c) => !kw || fold(c.title).includes(kw));
    const pin = pinnedId ? list.find((c) => c.id === pinnedId) : undefined;
    return pin ? [pin, ...list.filter((c) => c !== pin)] : list;
  }, [conversations, q, pinnedId, compact]);

  const toggle = onToggleCompact && (
    <Button size="icon" variant="ghost" className="shrink-0" onClick={onToggleCompact} data-testid="chat-list-toggle"
      aria-label={compact ? 'Mở rộng danh sách' : 'Thu gọn danh sách'} title={compact ? 'Mở rộng danh sách' : 'Thu gọn danh sách'}>
      {compact ? <PanelLeftOpen /> : <PanelLeftClose />}
    </Button>
  );

  if (compact) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center gap-1 py-2" data-testid="chat-conversations-compact">
        {toggle}
        <Button size="icon" variant="outline" aria-label="Tin nhắn mới" title="Tin nhắn mới" onClick={onNew} data-testid="chat-new"><Plus /></Button>
        <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto pt-1" data-testid="chat-conversations">
          {shown.map((c) => (
            <button key={c.id} type="button" onClick={() => onSelect(c.id)} title={c.title} aria-label={c.title} aria-current={selectedId === c.id || undefined}
              className={cn('relative shrink-0 rounded-full p-0.5 ring-2 ring-transparent transition-colors hover:bg-accent', selectedId === c.id && 'ring-primary')}
              data-testid="chat-conversation" data-pinned={c.id === pinnedId || undefined}>
              <ConversationIcon c={c} />
              {c.unread > 0 && <UnreadBadge c={c} className="absolute -top-0.5 -right-1" />}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b p-3">
        {toggle}
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Tìm cuộc trò chuyện…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="chat-search" />
        </div>
        <Button size="icon" variant="outline" aria-label="Tin nhắn mới" title="Tin nhắn mới" onClick={onNew} data-testid="chat-new">
          <Plus />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5" data-testid="chat-conversations">
        {loading && (
          <div className="grid gap-2 p-2">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        )}
        {!loading && shown.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {q ? 'Không có cuộc trò chuyện nào khớp.' : 'Chưa có cuộc trò chuyện nào. Bấm + để nhắn cho đồng nghiệp.'}
          </p>
        )}
        {shown.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            className={cn('flex min-h-11 w-full items-center gap-3 rounded-lg p-2.5 text-start transition-colors hover:bg-accent', selectedId === c.id && 'bg-accent')}
            data-testid="chat-conversation"
            data-pinned={c.id === pinnedId || undefined}
          >
            <ConversationIcon c={c} />
            <div className="grid min-w-0 flex-1 gap-0.5">
              {c.id === pinnedId && pinnedLabel && (
                <span className="text-[10px] font-bold tracking-wide text-primary" data-testid="chat-conversation-here">{pinnedLabel}</span>
              )}
              <div className="flex items-baseline gap-2">
                <span className={cn('truncate text-sm', c.unread > 0 ? 'font-semibold' : 'font-medium')}>{c.title}</span>
                {c.peerIsBot && <BotBadge className="shrink-0" />}
                <span className="ms-auto shrink-0 text-[11px] text-muted-foreground">{when(c.lastMessageAt)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn('truncate text-xs', c.unread > 0 ? 'text-foreground' : 'text-muted-foreground')}>{c.lastPreview ?? 'Chưa có tin nhắn'}</span>
                {c.unread > 0 && (
                  <span className="ms-auto flex shrink-0 items-center gap-1">
                    {(c.mentionedUnread ?? 0) > 0 && (
                      <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground"
                        title="Có tin nhắc tới bạn" aria-label="Có tin nhắc tới bạn" data-testid="chat-conversation-mention">@</span>
                    )}
                    <UnreadBadge c={c} />
                  </span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
