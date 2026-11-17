import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Maximize2, MessageSquare, Minimize2, Navigation, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import {
  ConversationList, MessagePane, NewChatDialog, useChat, useChatPeer, useConversations,
  type IChatMessage, type IConversation,
} from '@/features/chat';
import { cn } from '@/utils/cn';
import { useOffice } from '../../store/office.store';
import { useFloatingPanel, type PanelRect } from '../../hooks/use-floating-panel';
import type { OfficeScene } from '../../engine/OfficeScene';
import type { VoiceChannelInfo } from '../../engine/voiceChannel';

/** Vừa vào phòng mà danh sách hội thoại chưa có kênh phòng (Realtime cấp thành viên chạy nền) → tải lại danh sách sau chừng này. */
const ROOM_LIST_RETRY_MS = 1500;
/** Khung rộng hơn mức này → danh sách + hội thoại cạnh nhau; hẹp hơn → hai màn hình (danh sách ↔ hội thoại) như /chat trên điện thoại. */
const SPLIT_MIN_W = 600;
const COMPACT_KEY = 'officehub.office.chat-list-compact';
const MIN = { w: 300, h: 320 };

/**
 * Khung nổi mặc định (TEST-126, mockup `design/mockups/office-chat/`): máy tính ~780 × 760 (TEST-146: cao hơn,
 * vừa màn hình) giữa màn hình; điện thoại ~92% rộng, chừa ~200 px dưới cùng cho joystick + nút zoom, xoay ngang thì chừa hai bên.
 * `fit` trong hook giữ không vượt màn hình. Kích thước người dùng đã kéo (localStorage) giữ nguyên.
 */
const initialRect = (touch: boolean) => ({ w: vw, h: vh }: { w: number; h: number }): PanelRect => {
  if (!touch && vw > 640) {
    const w = Math.min(780, vw - 24), h = Math.min(760, vh - 24);
    return { w, h, x: (vw - w) / 2, y: (vh - h) / 2 };
  }
  const landscape = vw > vh;
  const w = landscape ? Math.max(MIN.w, vw - 320) : vw * 0.92;
  const bottom = landscape ? 12 : 200;
  const h = Math.max(MIN.h, vh - bottom - 24);
  return { w, h, x: (vw - w) / 2, y: 12 };
};

const readCompact = () => { try { return localStorage.getItem(COMPACT_KEY) === '1'; } catch { return false; } };

/** Dòng xem trước của tin trong toast: chữ (một dòng) hoặc "[Ảnh] tên tệp". */
const previewOf = (m: IChatMessage) => {
  const text = (m.text ?? '').replace(/\s+/g, ' ').trim();
  if (text) return text.length > 90 ? `${text.slice(0, 90)}…` : text;
  const a = m.attachments[0];
  return a ? `[${a.isImage ? 'Ảnh' : 'Tệp'}] ${a.fileName}` : '';
};

type Props = {
  /** Phòng có tường đang đứng (kênh phòng tự mở); null = ngoài phòng. */
  roomCh: VoiceChannelInfo | null;
  /** Màn hình cảm ứng: khung mặc định theo điện thoại, tay nắm to hơn. */
  touch: boolean;
  /** Cảnh 3D — vị trí người kia ("cách bạn N m") + nút Đi tới. */
  scene: OfficeScene | null;
};

/**
 * Khung chat HUD văn phòng 3D (TEST-126): dùng lại `ConversationList` / `MessagePane` / `NewChatDialog` của `features/chat` — đủ tính năng
 * như /chat (1-1, nhóm, kênh phòng, tệp, sửa, thu hồi, cảm xúc, tìm, @nhắc, "Họp với AI" ở kênh phòng). Màu theo theme app (sáng / tối).
 * Ghim góc dưới trái (mặc định) hoặc nổi — kéo bằng đầu khung, đổi cỡ góc dưới phải, nhớ ở localStorage (`useFloatingPanel`).
 * Bước vào phòng có tường → tự mở kênh phòng (dòng báo "Quay lại …"); ra khỏi phòng → về hội thoại trước nếu chưa tự chọn hội thoại khác.
 * Tin 1-1 / nhóm mới khi khung đóng hoặc đang mở hội thoại khác → toast "X nhắn bạn" + Trả lời / Để sau (âm báo do ChatProvider phát).
 */
export function OfficeChat({ roomCh, touch, scene }: Props) {
  const qc = useQueryClient();
  const chat = useChat();
  const open = useOffice((s) => s.chatOpen);
  const setOpen = useOffice((s) => s.setChatOpen);
  const openChat = useOffice((s) => s.openChat);
  const request = useOffice((s) => s.chatRequest);
  const panel = useFloatingPanel({ storageKey: 'officehub.office.chat-panel-v2', min: MIN, initial: initialRect(touch) });
  const { data: conversations, isLoading } = useConversations();

  const [selId, setSelId] = useState<string | null>(null);
  const selRef = useRef(selId);
  selRef.current = selId;
  /** Hội thoại vừa mở từ "Tin nhắn mới" khi danh sách chưa kịp tải lại. */
  const [opened, setOpened] = useState<IConversation | null>(null);
  /** Khung hẹp: đang xem danh sách hay hội thoại. */
  const [view, setView] = useState<'list' | 'thread'>(touch ? 'list' : 'thread');
  const [compact, setCompact] = useState(readCompact);
  const [newOpen, setNewOpen] = useState(false);
  /** Lần chọn gần nhất do người dùng bấm (focus ô soạn) hay tự động (vào phòng — không cướp focus khi đang đi bằng phím). */
  const [byUser, setByUser] = useState(false);

  const officeConv = conversations?.find((c) => c.type === 'Office');
  const roomId = roomCh?.id ?? null;
  const roomConv = roomId ? conversations?.find((c) => c.type === 'Room' && c.roomId === roomId) : undefined;
  const selected = (selId && (conversations?.find((c) => c.id === selId) ?? (opened?.id === selId ? opened : undefined))) || officeConv || null;

  const pick = useCallback((id: string | null, user = true) => {
    setSelId(id);
    setByUser(user);
    if (id) setView('thread');
  }, []);

  // Vừa vào phòng: kênh phòng chưa có trong danh sách (chưa là thành viên lúc tải) → tải lại danh sách khi Realtime đã kịp cấp
  const roomKnown = !!roomConv;
  useEffect(() => {
    if (!roomId || roomKnown) return;
    const t = setTimeout(() => void qc.invalidateQueries({ queryKey: ['chat', 'conversations'] }), ROOM_LIST_RETRY_MS);
    return () => clearTimeout(t);
  }, [roomId, roomKnown, qc]);

  // Kênh phòng tự mở / tự trả: `auto` = phòng đã tự mở kênh + hội thoại trước đó (để "Quay lại" và để trả về khi ra khỏi phòng)
  const auto = useRef<{ roomId: string; convId: string; prev: string | null } | null>(null);
  const [notice, setNotice] = useState<{ convId: string; roomName: string; prev: string | null } | null>(null);
  const roomConvId = roomConv?.id;
  const roomName = roomCh?.name;
  useEffect(() => {
    let cur = selRef.current;
    const a = auto.current;
    if (a && a.roomId !== roomId) {
      // Ra khỏi phòng (hoặc sang phòng khác): còn đang xem kênh phòng cũ → về hội thoại trước; đã tự chọn hội thoại khác → giữ nguyên
      auto.current = null;
      setNotice(null);
      if (cur === a.convId) cur = a.prev;
    }
    if (roomId && roomConvId && !auto.current) {
      auto.current = { roomId, convId: roomConvId, prev: cur };
      setNotice({ convId: roomConvId, roomName: roomName ?? 'phòng', prev: cur });
      cur = roomConvId;
    }
    if (cur !== selRef.current) {
      setSelId(cur);
      setByUser(false);
    }
  }, [roomId, roomConvId, roomName]);

  // Yêu cầu mở một hội thoại (toast "Trả lời"…): chưa có trong danh sách → tải lại danh sách
  const reqSeq = request?.seq;
  useEffect(() => {
    if (!request) return;
    pick(request.conversationId);
    if (!qc.getQueryData<IConversation[]>(['chat', 'conversations'])?.some((c) => c.id === request.conversationId)) {
      void qc.invalidateQueries({ queryKey: ['chat', 'conversations'] });
    }
  }, [reqSeq]); // chỉ khi có yêu cầu mới (seq tăng)

  // Tin 1-1 / nhóm mới không đang xem → toast "X nhắn bạn" (kênh văn phòng / phòng chỉ cộng số chưa đọc như trước)
  const { subscribe } = chat;
  useEffect(() => subscribe((m, viewing) => {
    if (viewing) return;
    const conv = qc.getQueryData<IConversation[]>(['chat', 'conversations'])?.find((c) => c.id === m.conversationId);
    const type = m.conversationType ?? conv?.type;
    if (type !== 'Direct' && type !== 'Group') return;
    const title = type === 'Group' ? `${m.senderName} nhắn trong ${conv?.title ?? 'nhóm'}` : `${m.senderName} nhắn bạn`;
    toast(title, {
      id: `office-chat-${m.conversationId}`,
      description: previewOf(m),
      duration: 8000,
      action: { label: 'Trả lời', onClick: () => openChat(m.conversationId) },
      cancel: { label: 'Để sau', onClick: () => undefined },
    });
  }), [subscribe, qc, openChat]);

  const setCompactSaved = (v: boolean) => {
    setCompact(v);
    try { localStorage.setItem(COMPACT_KEY, v ? '1' : '0'); } catch { /* bỏ qua */ }
  };

  if (!open) return <ChatLauncher conversations={conversations} onOpen={() => setOpen(true)} />;

  const { x, y, w, h } = panel.rect;
  // Ghim góc: kích thước do CSS (.chat-panel.docked) — khung hẹp; nổi: theo rect của hook
  const width = panel.floating ? w : touch && innerWidth > innerHeight ? innerWidth - 320 : Math.min(400, innerWidth - 24);
  const split = width >= SPLIT_MIN_W;
  const showList = split || view === 'list' || !selected;
  const showThread = !!selected && (split || view === 'thread');
  const shownNotice = notice && selected?.id === notice.convId ? notice : null;
  const prevConv = shownNotice?.prev ? conversations?.find((c) => c.id === shownNotice.prev) ?? null : officeConv ?? null;

  return (
    <section className={cn('chat-panel', panel.floating ? 'floating' : 'docked')} data-testid="office-chat" data-mode={panel.floating ? 'floating' : 'docked'}
      data-conversation={selected?.id} aria-label="Tin nhắn" style={panel.floating ? { left: x, top: y, width: w, height: h } : undefined}>
      <header className="chat-panel-head" {...(panel.floating ? panel.dragProps : {})}>
        <MessageSquare className="size-4 shrink-0 text-primary" aria-hidden />
        <b className="flex-1 truncate">Tin nhắn</b>
        {panel.floating
          ? <Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => panel.setFloating(false)} title="Thu về góc" aria-label="Thu về góc" data-testid="office-chat-dock"><Minimize2 /></Button>
          : <Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => panel.setFloating(true)} title="Mở rộng" aria-label="Mở rộng" data-testid="office-chat-float"><Maximize2 /></Button>}
        <Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => setOpen(false)} title="Đóng" aria-label="Đóng chat" data-testid="office-chat-close"><X /></Button>
      </header>
      <div className="chat-panel-body">
        {showList && (
          <aside className={cn('min-h-0 border-e', split ? (compact ? 'w-[60px] shrink-0' : 'w-64 shrink-0') : 'w-full')}>
            <ConversationList conversations={conversations} loading={isLoading} selectedId={selected?.id ?? null} onSelect={(id) => pick(id)}
              onNew={() => setNewOpen(true)} pinnedId={roomConv?.id} pinnedLabel="ĐANG Ở ĐÂY"
              compact={split && compact} onToggleCompact={split ? () => setCompactSaved(!compact) : undefined} />
          </aside>
        )}
        {showThread && selected && (
          <div className="min-h-0 min-w-0 flex-1">
            <ThreadPane key={selected.id} conversation={selected} scene={scene} split={split} autoFocus={byUser}
              roomName={selected.type === 'Room' && selected.roomId === roomId ? roomName ?? null : null}
              notice={shownNotice && (
                <div className="flex flex-wrap items-center gap-x-2 border-b bg-primary/10 px-3 py-1.5 text-xs" data-testid="office-chat-room-notice">
                  <span>Bạn vừa vào <b>{shownNotice.roomName}</b> — đã mở kênh của phòng</span>
                  {prevConv && prevConv.id !== selected.id && (
                    <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => { setNotice(null); pick(prevConv.id); }}
                      data-testid="office-chat-room-back">
                      · Quay lại {prevConv.title}
                    </button>
                  )}
                </div>
              )}
              onBack={() => setView('list')} onLeft={() => { setOpened(null); pick(null); setView('list'); }} />
          </div>
        )}
      </div>
      {panel.floating && <span className="resize" {...panel.resizeProps} aria-hidden data-testid="office-chat-resize" />}
      <NewChatDialog open={newOpen} onOpenChange={setNewOpen} onOpened={(c) => { setOpened(c); pick(c.id); }} />
    </section>
  );
}

/**
 * `MessagePane` trong 3D: kênh phòng ghi "Chỉ người trong <phòng> thấy…"; 1-1 với người đang trong văn phòng → phòng ban +
 * "đang trong văn phòng · cách bạn N m" (vị trí từ `OfficeScene`, cập nhật mỗi giây) + nút Đi tới.
 */
function ThreadPane({ conversation, scene, split, autoFocus, roomName, notice, onBack, onLeft }: {
  conversation: IConversation; scene: OfficeScene | null; split: boolean; autoFocus: boolean; roomName: string | null;
  notice: React.ReactNode; onBack: () => void; onLeft: () => void;
}) {
  const peer = useChatPeer(conversation);
  const peerId = conversation.type === 'Direct' ? conversation.peerUserId : null;
  const [dist, setDist] = useState<number | null>(null);
  useEffect(() => {
    if (!peerId || !scene) { setDist(null); return; }
    const tick = () => {
      const p = scene.positionOf(peerId), me = scene.myPosition();
      setDist(p && me ? Math.hypot(p.x - me.x, p.z - me.z) : null);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [peerId, scene]);

  const walk = () => {
    if (!peerId || !scene?.walkNear(peerId)) toast.info(`${conversation.title} không còn trong văn phòng`);
  };

  const subtitle = conversation.type === 'Direct' && (peer?.departmentName || dist !== null)
    ? [peer?.departmentName, dist !== null ? `đang trong văn phòng · cách bạn ${Math.max(1, Math.round(dist))} m` : null].filter(Boolean).join(' · ')
    : undefined;

  return (
    <MessagePane conversation={conversation} onBack={onBack} onLeft={onLeft} back={split ? 'none' : 'always'} autoFocus={autoFocus}
      subtitle={subtitle} notice={notice}
      placeholder={roomName ? `Chỉ người trong ${roomName} thấy…` : split ? undefined : 'Nhập tin nhắn…'}
      headerActions={dist !== null && (
        <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" onClick={walk} title={`Đi bộ tới cạnh ${conversation.title}`} data-testid="office-chat-walk">
          <Navigation /> Đi tới
        </Button>
      )} />
  );
}

/** Chat đóng: nút "Tin nhắn" góc dưới trái — số tin chưa đọc + "N hội thoại chưa đọc" (mockup 03). */
function ChatLauncher({ conversations, onOpen }: { conversations: IConversation[] | undefined; onOpen: () => void }) {
  const unreadConvs = conversations?.filter((c) => c.unread > 0) ?? [];
  const total = unreadConvs.reduce((n, c) => n + c.unread, 0);
  return (
    <button type="button" className="card chat-toggle" onClick={onOpen} aria-label={`Mở chat${total ? ` (${total} tin chưa đọc)` : ''}`} data-testid="office-chat-open">
      <span className="chat-toggle-icon"><MessageSquare className="size-5" />{total > 0 && <span className="chat-badge" data-testid="office-chat-unread">{total > 99 ? '99+' : total}</span>}</span>
      <span className="chat-toggle-text">
        <b>Tin nhắn</b>
        {unreadConvs.length > 0 && <small>{unreadConvs.length} hội thoại chưa đọc</small>}
      </span>
    </button>
  );
}
