import { useState } from 'react';
import { AgentMeetingBar } from '@/features/meetings';
import { splitMentions } from '@/utils/mention';
import { useOffice, type ChatLine } from '../../store/office.store';
import { useFloatingPanel, type PanelRect } from '../../hooks/use-floating-panel';
import type { VoiceChannelInfo } from '../../engine/voiceChannel';

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
  onSend: (channel: 'office' | 'room', text: string) => void;
  onOpenAgentMeeting: (roomId: string) => void;
};

/**
 * Ô chat HUD văn phòng 3D: tab Toàn văn phòng / phòng đang đứng, thanh "Họp với AI". Hai chế độ: ghim góc dưới trái (mặc định)
 * hoặc nổi (nút ⤢) — kéo bằng hàng tab, đổi cỡ bằng tay nắm góc dưới phải; nhớ chế độ / vị trí / kích thước theo trình duyệt (TEST-90).
 */
export function OfficeChat({ accountId, roomCh, touch, onSend, onOpenAgentMeeting }: Props) {
  const chat = useOffice((s) => s.chat);
  const [text, setText] = useState('');
  const [chatTab, setChatTab] = useState<'office' | 'room'>('office');
  const [open, setOpen] = useState(!touch);
  const tab = roomCh ? chatTab : 'office';
  const panel = useFloatingPanel({ storageKey: 'officehub.office.chat-panel', min: MIN, initial: initialRect(touch) });

  if (!open) return <button type="button" className="card chat-toggle" onClick={() => setOpen(true)} aria-label="Mở chat">💬</button>;

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    onSend(tab, t);
  };
  const { x, y, w, h } = panel.rect;
  return (
    <form className={`chat ${panel.floating ? 'floating card' : ''}`} onSubmit={send} data-testid="office-chat" data-mode={panel.floating ? 'floating' : 'docked'}
      style={panel.floating ? { left: x, top: y, width: w, height: h } : undefined}>
      <div className="tabs" {...(panel.floating ? panel.dragProps : {})}>
        <button type="button" className={tab === 'office' ? 'on' : ''} onClick={() => setChatTab('office')}>Toàn văn phòng</button>
        {roomCh && (
          <button type="button" className={tab === 'room' ? 'on' : ''} onClick={() => setChatTab('room')} data-testid="office-chat-room-tab">
            🔒 {roomCh.name}
            {tab !== 'room' && chat.some((l) => l.channel === 'room' && l.roomId === roomCh.id) && <span className="dot-new" />}
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
      <div className="log">
        {chat.filter((l) => (tab === 'room' ? l.channel === 'room' && l.roomId === roomCh?.id : l.channel !== 'room')).map((l, i) => {
          const mentionsMe = !!accountId && l.id !== accountId && !!l.mentions?.some((m) => m.userId === accountId);
          return <div key={i} className={mentionsMe ? 'mention-me' : undefined} data-mentions-me={mentionsMe || undefined}><b>{l.name}:</b> <HudText line={l} /></div>;
        })}
      </div>
      <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200}
        placeholder={tab === 'room' ? `Chỉ người trong ${roomCh?.name} thấy…` : 'Nhập tin nhắn, Enter để gửi'} />
      {panel.floating && <span className="resize" {...panel.resizeProps} aria-hidden data-testid="office-chat-resize" />}
    </form>
  );
}

/** Chữ dòng chat HUD: "@mã" của người được nhắc → "@Họ tên" tô nổi (hover: mã). */
function HudText({ line }: { line: ChatLine }) {
  if (!line.mentions?.length) return <>{line.text}</>;
  const names = new Map(line.mentions.map((x) => [x.code.toUpperCase(), x.name]));
  return <>{splitMentions(line.text, names).map((p, i) => (typeof p === 'string' ? p : <span key={i} className="mention" title={p.code}>@{p.name}</span>))}</>;
}
