import { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/utils/cn';
import { useConversations } from '../../hooks/useChatData';
import type { IConversation } from '../../types/chat.types';
import { ConversationList } from '../conversation-list';
import { MessagePane } from '../message-pane';
import { NewChatDialog } from '../new-chat-dialog';

/** Trang /chat: trái danh sách hội thoại (kênh văn phòng, kênh phòng, tin 1-1), phải khung chat. Điện thoại: hai màn hình có nút quay lại. */
export function ChatPage() {
  const isMobile = useIsMobile();
  const { data: conversations, isLoading } = useConversations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [opened, setOpened] = useState<IConversation | null>(null); // hội thoại vừa mở từ "Tin nhắn mới" khi danh sách chưa kịp tải lại
  const [newOpen, setNewOpen] = useState(false);

  // Màn hình rộng: tự mở hội thoại đầu tiên (kênh toàn văn phòng).
  useEffect(() => {
    if (!isMobile && !selectedId && conversations?.length) setSelectedId(conversations[0].id);
  }, [isMobile, selectedId, conversations]);

  const selected = conversations?.find((c) => c.id === selectedId) ?? (opened?.id === selectedId ? opened : null);

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Tin nhắn" />
      <div className="flex h-[calc(100dvh-8.5rem)] min-h-[28rem] overflow-hidden rounded-xl border bg-card" data-testid="chat-page">
        <aside className={cn('w-full shrink-0 border-e md:block md:w-80', selected && 'hidden')}>
          <ConversationList conversations={conversations} loading={isLoading} selectedId={selectedId} onSelect={setSelectedId} onNew={() => setNewOpen(true)} />
        </aside>
        <section className={cn('min-w-0 flex-1', !selected && 'hidden md:block')}>
          {selected ? (
            <MessagePane key={selected.id} conversation={selected} onBack={() => setSelectedId(null)} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <MessageSquare className="size-10" />
              Chọn một cuộc trò chuyện hoặc bấm + để nhắn cho đồng nghiệp.
            </div>
          )}
        </section>
      </div>
      <NewChatDialog open={newOpen} onOpenChange={setNewOpen} onOpened={(c) => { setOpened(c); setSelectedId(c.id); }} />
    </div>
  );
}
