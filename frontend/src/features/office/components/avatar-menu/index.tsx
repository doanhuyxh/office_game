import { useEffect, useLayoutEffect, useRef } from 'react';
import { MapPin, MessageSquare, Monitor } from 'lucide-react';
import { toast } from 'sonner';
import { useChatPerson, useOpenDirect } from '@/features/chat';
import { errorMessage } from '@/utils/errors';
import { useOffice } from '../../store/office.store';
import type { OfficeScene } from '../../engine/OfficeScene';

/** Khoảng cách menu ↔ avatar và ↔ mép màn hình (px). */
const GAP = 10, EDGE = 8;

export interface AvatarMenuTarget { id: string; bot: boolean }

type Props = {
  scene: OfficeScene;
  target: AvatarMenuTarget;
  onClose: () => void;
  /** "Xem bot đang làm gì" — hành vi bấm bot cũ (TEST-97, kiểm phạm vi nghe ở OfficeView). */
  onWatchBot: (id: string) => void;
};

/** Chữ cái đầu của hai từ cuối họ tên ("Trần Minh Anh" → "MA"). */
const initials = (name: string) => name.trim().split(/\s+/).slice(-2).map((w) => w.charAt(0).toUpperCase()).join('');

/**
 * Menu nhỏ khi bấm vào nhân vật người khác trong văn phòng 3D (TEST-127, mockup `design/mockups/office-chat/03-desktop-bam-nhan-vat.html`).
 * Người: tên, phòng ban · mã NV, **Nhắn tin riêng** (mở / tạo hội thoại 1-1 → khung chat 3D ở hội thoại đó), **Đi tới cạnh**.
 * Bot: chip BOT + bong bóng đang làm gì, **Xem bot đang làm gì** + **Nhắn tin riêng**. Neo cạnh avatar (theo từng khung hình, tự đổi bên
 * khi sát mép); đóng khi bấm ra ngoài, Esc, chọn một mục, hoặc avatar ra khỏi màn hình / rời văn phòng. Focus vào mục đầu → phím
 * (WASD, E, M…) không làm nhân vật đi (`TYPING_SCOPES` gồm `[role="menu"]`); ↑ ↓ chuyển mục.
 */
export function AvatarMenu({ scene, target, onClose, onWatchBot }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const info = scene.avatarInfo(target.id);
  const name = info?.name ?? '';
  const person = useChatPerson(target.id, name);
  const openDirect = useOpenDirect();
  const openChat = useOffice((s) => s.openChat);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Neo cạnh avatar mỗi khung hình: mặc định bên phải, tràn mép phải → bên trái; kẹp trong màn hình. Avatar khuất / rời đi → đóng.
  useLayoutEffect(() => {
    let raf = 0;
    const place = () => {
      const el = ref.current, a = scene.screenAnchor(target.id);
      if (!a) return closeRef.current();
      if (el) {
        const w = el.offsetWidth, h = el.offsetHeight;
        let left = a.x + a.half + GAP;
        if (left + w > innerWidth - EDGE) left = a.x - a.half - GAP - w;
        left = Math.min(Math.max(EDGE, left), innerWidth - w - EDGE);
        const top = Math.min(Math.max(EDGE, a.top), innerHeight - h - EDGE);
        el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
        el.style.visibility = 'visible';
      }
      raf = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [scene, target.id]);

  // Focus mục đầu (phím không điều khiển nhân vật khi focus trong menu); bấm ra ngoài / Esc → đóng
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node | null)) closeRef.current(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) closeRef.current(); };
    addEventListener('pointerdown', onDown, true);
    addEventListener('keydown', onKey);
    return () => { removeEventListener('pointerdown', onDown, true); removeEventListener('keydown', onKey); };
  }, [target.id]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  };

  const chat = () => {
    if (openDirect.isPending) return;
    openDirect.mutate(target.id, {
      onSuccess: (c) => { onClose(); openChat(c.id); },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };
  const walk = () => {
    onClose();
    if (!scene.walkNear(target.id)) toast.info(`${name} không còn trong văn phòng`);
  };

  if (!info) return null;
  const sub = info.bot ? info.status : [person?.departmentName, person?.code].filter(Boolean).join(' · ');
  const chatItem = (
    <button type="button" role="menuitem" className={info.bot ? '' : 'primary'} onClick={chat} disabled={openDirect.isPending} data-testid="avatar-menu-chat">
      <MessageSquare aria-hidden /> Nhắn tin riêng
    </button>
  );

  return (
    <div ref={ref} role="menu" aria-label={name} className="avatar-menu" onKeyDown={onMenuKey} data-testid="avatar-menu"
      data-avatar={target.id} data-bot={info.bot ? '1' : '0'} style={{ visibility: 'hidden' }}>
      <div className="avatar-menu-head">
        <span className={`avatar-menu-ava ${info.bot ? 'bot' : ''}`} aria-hidden>{initials(name)}</span>
        <span className="avatar-menu-who">
          <b>{name}{info.bot && <span className="avatar-menu-chip">BOT</span>}</b>
          {sub && <span data-testid="avatar-menu-sub">{sub}</span>}
        </span>
      </div>
      {info.bot ? <>
        <button type="button" role="menuitem" className="bot" onClick={() => { onClose(); onWatchBot(target.id); }} data-testid="avatar-menu-watch">
          <Monitor aria-hidden /> Xem bot đang làm gì
        </button>
        {chatItem}
      </> : <>
        {chatItem}
        <button type="button" role="menuitem" onClick={walk} data-testid="avatar-menu-walk">
          <MapPin aria-hidden /> Đi tới cạnh
        </button>
      </>}
    </div>
  );
}
