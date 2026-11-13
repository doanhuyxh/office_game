import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, MessageSquareDashed, Search, Upload, Users, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/common/alert-dialog';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/common/dialog';
import { Spinner } from '@/components/feedback/Spinner';
import { useMe } from '@/features/auth';
import { AgentMeetingBar, AgentMeetingDialog, type AgentMeetingDraft } from '@/features/meetings';
import { cn } from '@/utils/cn';
import { errorMessage } from '@/utils/errors';
import { useChat } from '../../hooks/useChat';
import { loadOlderMessages, useMessages } from '../../hooks/useChatData';
import type { IAttachment, IConversation, IMessage } from '../../types/chat.types';
import { MAX_FILES, dayKey, dayLabel, fileProblem } from '../../utils/labels';
import { Composer } from '../composer';
import { ConversationIcon } from '../conversation-list';
import { GroupMembersDialog } from '../group-members-dialog';
import { MessageItem } from '../message-item';
import { MessageSearch } from '../message-search';

const GROUP_GAP_MS = 5 * 60 * 1000;
const NEAR_BOTTOM_PX = 120;

/** Khung chat bên phải: tiêu đề, danh sách tin (cuộn, tải tin cũ), kéo-thả tệp, ô soạn. Đặt `key={conversation.id}` để đổi hội thoại là làm mới trạng thái. */
export function MessagePane({ conversation, onBack, onLeft }: { conversation: IConversation; onBack: () => void; onLeft: () => void }) {
  const qc = useQueryClient();
  const chat = useChat();
  const { data: me } = useMe();
  const { data, isLoading, isError, refetch } = useMessages(conversation.id);
  const items = data?.items ?? [];
  const hasMore = data?.hasMore ?? false;

  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<IAttachment | null>(null);
  const [recalling, setRecalling] = useState<IMessage | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [searching, setSearching] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [agentDraft, setAgentDraft] = useState<AgentMeetingDraft | null>(null);

  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const snap = useRef<{ height: number; top: number } | null>(null);
  const dragDepth = useRef(0);

  const { setActive } = chat;
  useEffect(() => {
    setActive(conversation.id);
    return () => setActive(null);
  }, [conversation.id, setActive]);

  const scrollToBottom = () => { const el = box.current; if (el) el.scrollTop = el.scrollHeight; };

  // Sau mỗi lần danh sách đổi: vừa tải tin cũ → giữ nguyên vị trí đang đọc; đang ở cuối / tin của mình → trượt xuống cuối.
  const last = items[items.length - 1];
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (snap.current) {
      el.scrollTop = el.scrollHeight - snap.current.height + snap.current.top;
      snap.current = null;
    } else if (stick.current) scrollToBottom();
  }, [items.length, last?.id, last?.local?.status, isLoading]);

  const loadOlder = useCallback(async () => {
    const el = box.current;
    if (!el || loadingOlder) return;
    snap.current = { height: el.scrollHeight, top: el.scrollTop };
    setLoadingOlder(true);
    try {
      await loadOlderMessages(qc, conversation.id);
    } catch (e) {
      snap.current = null;
      toast.error(errorMessage(e, 'Không tải được tin cũ'));
    } finally {
      setLoadingOlder(false);
    }
  }, [qc, conversation.id, loadingOlder]);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (el.scrollTop < 60 && hasMore && !loadingOlder) void loadOlder();
  };

  const addFiles = useCallback((list: File[]) => {
    if (list.length === 0) return;
    const accepted: File[] = [];
    for (const f of list) {
      const problem = fileProblem(f);
      if (problem) toast.error(problem);
      else accepted.push(f);
    }
    setFiles((cur) => {
      const room = MAX_FILES - cur.length;
      if (accepted.length > room) toast.error(`Mỗi tin đính kèm tối đa ${MAX_FILES} tệp`);
      return [...cur, ...accepted.slice(0, Math.max(0, room))];
    });
  }, []);

  const submit = (text: string) => {
    stick.current = true;
    chat.send(conversation.id, text, files);
    setFiles([]);
  };

  const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes('Files');
  const onDragEnter = (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); dragDepth.current++; setDragging(true); } };
  const onDragLeave = () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false); };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    addFiles([...e.dataTransfer.files]);
  };

  const meId = me?.id;
  const rows: ReactNode[] = [];
  items.forEach((m, i) => {
    const prev = items[i - 1];
    const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
    if (newDay) {
      rows.push(
        <div key={`day-${m.id}`} className="my-3 flex items-center gap-3 text-[11px] text-muted-foreground">
          <div className="h-px flex-1 bg-border" /> {dayLabel(m.createdAt)} <div className="h-px flex-1 bg-border" />
        </div>,
      );
    }
    const showHeader = newDay || prev.senderId !== m.senderId || !!prev.local !== !!m.local
      || new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > GROUP_GAP_MS;
    rows.push(
      <MessageItem
        key={m.local ? `local-${m.clientId}` : m.id}
        m={m}
        mine={m.senderId === meId}
        meId={meId}
        showHeader={showHeader}
        onRecall={setRecalling}
        onEdit={chat.edit}
        onReact={chat.react}
        onRetry={(x) => x.clientId && chat.retry(conversation.id, x.clientId)}
        onDiscard={(x) => x.clientId && chat.discard(conversation.id, x.clientId)}
        onPreview={setPreview}
      />,
    );
  });

  return (
    <div className="relative flex h-full min-h-0 flex-col" onDragEnter={onDragEnter} onDragOver={(e) => hasFiles(e) && e.preventDefault()} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div className="flex items-center gap-3 border-b px-3 py-2.5">
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Quay lại danh sách" onClick={onBack}><ArrowLeft /></Button>
        <ConversationIcon c={conversation} className="size-9" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold" data-testid="chat-title">{conversation.title}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {conversation.type === 'Office' ? 'Kênh chung cho cả văn phòng' : conversation.type === 'Room' ? 'Kênh phòng — người từng vào phòng này'
              : conversation.type === 'Group' ? 'Nhóm chat'
              : conversation.peerIsBot ? 'Bot AI — tin nhắn được gửi tới trợ lý AI bên ngoài công ty, đừng gửi thông tin nhạy cảm' : 'Tin nhắn riêng'}
          </div>
        </div>
        <Button variant="ghost" size="icon" aria-label="Tìm trong tin nhắn" aria-pressed={searching} onClick={() => setSearching((v) => !v)} data-testid="chat-search-toggle"><Search /></Button>
        {conversation.type === 'Group' && (
          <Button variant="ghost" size="icon" aria-label="Thành viên nhóm" onClick={() => setMembersOpen(true)} data-testid="chat-group-members"><Users /></Button>
        )}
        {chat.link !== 'online' && (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground" data-testid="chat-link-state">
            <WifiOff className="size-3.5" /> {chat.link === 'connecting' ? 'Đang kết nối…' : 'Mất kết nối, đang thử lại…'}
          </span>
        )}
      </div>

      {conversation.type === 'Room' && (
        // Kênh phòng họp: thanh "Họp với AI" (TEST-83). Mở / kết thúc → tải lại tin để thấy tin hệ thống (chưa phát realtime).
        <AgentMeetingBar roomId={conversation.roomId} onOpen={() => setAgentDraft({ roomId: conversation.roomId })} onChange={() => void refetch()} />
      )}

      {searching && <MessageSearch conversationId={conversation.id} onClose={() => setSearching(false)} />}

      <div ref={box} onScroll={onScroll} className={cn('min-h-0 flex-1 overflow-y-auto px-3 py-2', searching && 'hidden')} data-testid="chat-messages">
        {isLoading && <Spinner />}
        {isError && (
          <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
            Không tải được tin nhắn.
            <Button size="sm" variant="outline" onClick={() => void refetch()}>Thử lại</Button>
          </div>
        )}
        {!isLoading && !isError && (
          <>
            {hasMore && (
              <div className="flex justify-center py-2">
                <Button size="sm" variant="ghost" disabled={loadingOlder} onClick={() => void loadOlder()}>
                  {loadingOlder && <Loader2 className="animate-spin" />} Tải tin cũ
                </Button>
              </div>
            )}
            {items.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 py-16 text-center text-sm text-muted-foreground">
                <MessageSquareDashed className="size-10" />
                {conversation.type === 'Direct' ? `Chưa có tin nhắn nào với ${conversation.title}. Hãy gửi lời chào!` : 'Chưa có tin nhắn nào. Hãy là người đầu tiên!'}
              </div>
            ) : rows}
          </>
        )}
      </div>

      {conversation.type === 'Group' && (
        <GroupMembersDialog conversation={conversation} open={membersOpen} onOpenChange={setMembersOpen} onLeft={onLeft} />
      )}
      {conversation.type === 'Room' && <AgentMeetingDialog draft={agentDraft} onClose={() => setAgentDraft(null)} />}

      <Composer conversationId={conversation.id} canMention={conversation.type !== 'Direct'} draftKey={`chat-draft:${conversation.id}`} files={files} onAddFiles={addFiles} onRemoveFile={(i) => setFiles((cur) => cur.filter((_, j) => j !== i))} onSubmit={submit} />

      <div className={cn('pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-primary bg-background/80 transition-opacity', dragging ? 'opacity-100' : 'opacity-0')}>
        <div className="flex items-center gap-2 text-sm font-medium text-primary"><Upload className="size-5" /> Thả tệp / ảnh để đính kèm</div>
      </div>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-[min(95vw,64rem)] p-2 sm:max-w-5xl">
          <DialogTitle className="sr-only">{preview?.fileName ?? 'Ảnh'}</DialogTitle>
          <DialogDescription className="sr-only">Xem ảnh đã gửi trong cuộc trò chuyện</DialogDescription>
          {preview && <img src={preview.url} alt={preview.fileName} className="max-h-[80vh] w-full rounded object-contain" />}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!recalling} onOpenChange={(o) => !o && setRecalling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Thu hồi tin nhắn?</AlertDialogTitle>
            <AlertDialogDescription>Mọi người sẽ thấy "Tin nhắn đã thu hồi" thay cho nội dung và tệp đính kèm. Không hoàn tác được.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const m = recalling; setRecalling(null); if (m) void chat.recall(m); }} data-testid="chat-recall-confirm">Thu hồi</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
