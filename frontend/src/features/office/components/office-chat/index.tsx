import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useChat, useConversations, useMessages, type IMessage } from '@/features/chat';
import { AgentMeetingBar } from '@/features/meetings';
import { splitMentions } from '@/utils/mention';
import { useOffice, type ChatLine } from '../../store/office.store';
import { useFloatingPanel, type PanelRect } from '../../hooks/use-floating-panel';
import type { VoiceChannelInfo } from '../../engine/voiceChannel';

/** Giới hạn chữ như trang /chat (ChatRules: ≤ 1000 ký tự). */
const MAX_TEXT = 1000;
/** Vừa vào phòng mà danh sách hội thoại chưa có kênh phòng (Realtime cấp thành viên chạy nền) → tải lại danh sách sau chừng này. */
const ROOM_LIST_RETRY_MS = 1500;

/** Một dòng trong log HUD — từ tin của hub chat (có lịch sử) hoặc, khi chưa biết hội thoại, từ sự kiện `Chat` của hub văn phòng. */
type HudLine = {
  key: string;
  senderId: string;
  name: string;
  text: string;
  mentions: ChatLine['mentions'];
  bot?: boolean;
  sending?: boolean;
  failed?: { clientId: string; error?: string };
};

const fromMessage = (m: IMessage): HudLine => {
  const files = m.attachments.map((a) => `[${a.isImage ? 'Ảnh' : 'Tệp'}] ${a.fileName}`).join(' ');
  return {
    key: m.clientId ?? m.id,
    senderId: m.senderId,
    name: m.senderName,
    text: m.deleted ? 'Tin nhắn đã được thu hồi' : [m.text ?? '', files].filter(Boolean).join(' '),
    mentions: m.deleted ? null : m.mentions,
    bot: m.byBot,
    sending: m.local?.status === 'sending',
    failed: m.local?.status === 'failed' && m.clientId ? { clientId: m.clientId, error: m.local.error } : undefined,
  };
};

const MIN = { w: 280, h: 220 };
/**
 * Bảng nổi mặc định: máy tính ~480 × 440 giữa màn hình; điện thoại ~92% × 55% (chừa joystick + nút zoom ở ~200px dưới cùng),
 * xoay ngang thì hẹp lại để chừa joystick bên trái / nút camera bên phải. `fit` trong hook giữ không vượt màn hình.
 */
const initialRect = (touch: boolean) => ({ w: vw, h: vh }: { w: number; h: number }): PanelRect => {
  if (!touch && vw > 640) {
    const w = Math.min(480, vw - 24), h = Math.min(440, vh - 24);
    return { w, h, x: (vw - w) / 2, y: (vh - h) / 2 };
  }
  const landscape = vw > vh;
  const w = landscape ? Math.max(MIN.w, vw - 320) : vw * 0.92;
  const bottom = landscape ? 12 : 200;
  const h = Math.max(MIN.h, Math.min(vh * 0.55, vh - bottom - 12));
  return { w, h, x: (vw - w) / 2, y: Math.max(12, 12 + (vh - bottom - 12 - h) / 2) };
};

type Props = {
  accountId: string | undefined;
  /** Phòng có tường đang đứng (có thêm tab chat riêng); null = ngoài phòng. */
  roomCh: VoiceChannelInfo | null;
  /** Màn hình cảm ứng: thu gọn / mở bằng nút 💬, tay nắm to hơn. */
  touch: boolean;
  onOpenAgentMeeting: (roomId: string) => void;
};

/**
 * Ô chat HUD văn phòng 3D: tab Toàn văn phòng / phòng đang đứng, thanh "Họp với AI". Hai chế độ: ghim góc dưới trái (mặc định)
 * hoặc nổi (nút ⤢) — kéo bằng hàng tab, đổi cỡ bằng tay nắm góc dưới phải; nhớ chế độ / vị trí / kích thước theo trình duyệt (TEST-90).
 * Gửi + đọc qua hub chat (`useChat` — ChatProvider bọc trang /office, TEST-125): có lịch sử (tải lại trang vẫn thấy), ≤ 1000 ký tự,
 * @nhắc như /chat, tin lỗi có "Thử lại". Tab đang xem = hội thoại đang mở (đánh dấu đã đọc, không cộng chưa đọc / không phát âm).
 */
export function OfficeChat({ accountId, roomCh, touch, onOpenAgentMeeting }: Props) {
  const qc = useQueryClient();
  const chat = useChat();
  const storeChat = useOffice((s) => s.chat);
  const [text, setText] = useState('');
  const [chatTab, setChatTab] = useState<'office' | 'room'>('office');
  const [open, setOpen] = useState(!touch);
  const tab = roomCh ? chatTab : 'office';
  const panel = useFloatingPanel({ storageKey: 'officehub.office.chat-panel', min: MIN, initial: initialRect(touch) });

  // Hội thoại (Guid) của kênh Toàn văn phòng / phòng đang đứng — tin hub + lịch sử nằm ở cache theo Guid
  const conversations = useConversations();
  const officeConv = conversations.data?.find((c) => c.type === 'Office');
  const roomConv = roomCh ? conversations.data?.find((c) => c.type === 'Room' && c.roomId === roomCh.id) : undefined;
  const conv = tab === 'room' ? roomConv : officeConv;
  const thread = useMessages(conv?.id ?? null);

  // Vừa vào phòng: kênh phòng chưa có trong danh sách (chưa là thành viên lúc tải) → tải lại danh sách khi Realtime đã kịp cấp
  const roomId = roomCh?.id;
  const roomKnown = !!roomConv;
  useEffect(() => {
    if (!roomId || roomKnown) return;
    const t = setTimeout(() => void qc.invalidateQueries({ queryKey: ['chat', 'conversations'] }), ROOM_LIST_RETRY_MS);
    return () => clearTimeout(t);
  }, [roomId, roomKnown, qc]);

  // Khung đang mở + tab đang xem = hội thoại đang mở → ChatProvider đánh dấu đã đọc, tin tới không cộng chưa đọc / không phát âm
  const activeId = open ? conv?.id ?? null : null;
  const { setActive } = chat;
  useEffect(() => {
    setActive(activeId);
    return () => setActive(null);
  }, [activeId, setActive]);

  const roomKey = roomCh?.id;
  const lines = useMemo<HudLine[]>(() => {
    if (conv) return (thread.data?.items ?? []).map(fromMessage);
    // Chưa biết hội thoại (danh sách chưa tải / chưa là thành viên phòng) → tạm dùng tin hub văn phòng đẩy tới
    return storeChat
      .filter((l) => (tab === 'room' ? l.channel === 'room' && l.roomId === roomKey : l.channel !== 'room'))
      .map((l, i) => ({ key: `hub-${i}-${l.at}`, senderId: l.id, name: l.name, text: l.text, mentions: l.mentions }));
  }, [conv, thread.data, storeChat, tab, roomKey]);

  const logRef = useRef<HTMLDivElement>(null);
  const lastKey = lines[lines.length - 1]?.key;
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastKey, tab, open]);

  if (!open) return <button type="button" className="card chat-toggle" onClick={() => setOpen(true)} aria-label="Mở chat">💬</button>;

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim().slice(0, MAX_TEXT);
    if (!t) return;
    // Biết Guid → gửi theo Guid (tin lạc quan hiện ngay trong log); chưa biết → bí danh, Api tự tìm hội thoại
    const target = conv?.id ?? (tab === 'room' && roomCh ? `room:${roomCh.id}` : 'office');
    setText('');
    // Lỗi khi gửi theo Guid → dòng tin hiện "Chưa gửi được · Thử lại"; theo bí danh thì tin không nằm trong log đang xem → báo bằng toast
    void chat.send(target, t, []).then((ok) => { if (!ok && !conv) toast.error('Chưa gửi được tin nhắn, thử lại sau'); });
  };
  const officeUnread = (officeConv?.unread ?? 0) > 0;
  const roomUnread = roomConv ? roomConv.unread > 0 : storeChat.some((l) => l.channel === 'room' && l.roomId === roomCh?.id);
  const { x, y, w, h } = panel.rect;
  return (
    <form className={`chat ${panel.floating ? 'floating card' : ''}`} onSubmit={send} data-testid="office-chat" data-mode={panel.floating ? 'floating' : 'docked'}
      data-conversation={conv?.id} style={panel.floating ? { left: x, top: y, width: w, height: h } : undefined}>
      <div className="tabs" {...(panel.floating ? panel.dragProps : {})}>
        <button type="button" className={tab === 'office' ? 'on' : ''} onClick={() => setChatTab('office')}>
          Toàn văn phòng
          {tab !== 'office' && officeUnread && <span className="dot-new" />}
        </button>
        {roomCh && (
          <button type="button" className={tab === 'room' ? 'on' : ''} onClick={() => setChatTab('room')} data-testid="office-chat-room-tab">
            🔒 {roomCh.name}
            {tab !== 'room' && roomUnread && <span className="dot-new" />}
          </button>
        )}
        <span className="tabs-end">
          {panel.floating
            ? <button type="button" onClick={() => panel.setFloating(false)} title="Thu về góc" aria-label="Thu về góc" data-testid="office-chat-dock">⤡</button>
            : <button type="button" onClick={() => panel.setFloating(true)} title="Mở rộng" aria-label="Mở rộng" data-testid="office-chat-float">⤢</button>}
          {touch && <button type="button" onClick={() => setOpen(false)} aria-label="Thu gọn chat">✕</button>}
        </span>
      </div>
      {/* Đang đứng trong phòng họp: họp với AI (TEST-83) — nút mở (điền sẵn phòng) / trạng thái lượt nói, nút Dừng. Phòng khác: không hiện. */}
      {roomCh && <AgentMeetingBar roomId={roomCh.id} variant="hud" className="agent-meeting" onOpen={() => onOpenAgentMeeting(roomCh.id)} />}
      <div className="log" ref={logRef} data-testid="office-chat-log">
        {lines.map((l) => {
          const mentionsMe = !!accountId && l.senderId !== accountId && !!l.mentions?.some((m) => m.userId === accountId);
          const cls = [mentionsMe && 'mention-me', l.sending && 'sending', l.failed && 'failed'].filter(Boolean).join(' ') || undefined;
          return (
            <div key={l.key} className={cls} data-mentions-me={mentionsMe || undefined}>
              <b>{l.name}{l.bot && <span className="bot-chip">BOT</span>}:</b> <HudText text={l.text} mentions={l.mentions} />
              {l.failed && conv && (
                <span className="failed-actions" title={l.failed.error}>
                  {' '}⚠ Chưa gửi được{l.failed.error ? ` (${l.failed.error})` : ''} ·{' '}
                  <button type="button" onClick={() => chat.retry(conv.id, l.failed!.clientId)}>Thử lại</button>
                  {' · '}
                  <button type="button" onClick={() => chat.discard(conv.id, l.failed!.clientId)}>Bỏ</button>
                </span>
              )}
            </div>
          );
        })}
      </div>
      <input value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX_TEXT}
        placeholder={tab === 'room' ? `Chỉ người trong ${roomCh?.name} thấy…` : 'Nhập tin nhắn, Enter để gửi'} />
      {panel.floating && <span className="resize" {...panel.resizeProps} aria-hidden data-testid="office-chat-resize" />}
    </form>
  );
}

/** Chữ dòng chat HUD: "@mã" của người được nhắc → "@Họ tên" tô nổi (hover: mã). */
function HudText({ text, mentions }: { text: string; mentions: ChatLine['mentions'] }) {
  if (!mentions?.length) return <>{text}</>;
  const names = new Map(mentions.map((x) => [x.code.toUpperCase(), x.name]));
  return <>{splitMentions(text, names).map((p, i) => (typeof p === 'string' ? p : <span key={i} className="mention" title={p.code}>@{p.name}</span>))}</>;
}
