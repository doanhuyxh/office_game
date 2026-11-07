import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { useCheck, useToday } from '@/features/attendance';
import { useMe } from '@/features/auth';
import { useRoomsNow } from '@/features/meetings';
import { errorMessage } from '@/utils/errors';
import { formatTime } from '@/utils/date';
import { useOffice } from '../../store/office.store';
import { PATHS } from '@/config/paths';
import { OfficeScene } from '../../engine/OfficeScene';
import { OfficeConnection } from '../../api/officeHub';
import type { SitSpot } from '../../engine/sitSpots';
import { Minimap } from '../minimap';
import { VOICE_INITIAL, VoiceClient, type VoiceView } from '../../api/voiceClient';
import { ScreenView, VoicePanel } from '../voice-panel';
import { Joystick } from '../joystick';
import type { VoiceChannelInfo } from '../../engine/voiceChannel';
import { DEFAULT_LOOK, parseLook, validLook } from '../../engine/avatarLook';
import { AvatarEditorDialog } from '../avatar-editor-dialog';
import { filesFromDrop, UploadPanel, useSpaces, useUploadQueue, type ISpaceRef } from '@/features/documents';
import { OFFICE_MAP } from '../../engine/officeMap';
import type { MapObject } from '../../engine/mapTypes';
import type { ScreenDto } from '../../types/office.types';
import { OfficeDocsDialog, ScreenDocPanel, useCabinetDepartment, type DocsMode } from '../office-docs';

const OBJECT_BY_ID = new Map(OFFICE_MAP.objects.map((o) => [o.id, o]));
/** Đang gõ / thao tác trong hộp thoại → phím E, M không dành cho văn phòng. */
const typingTarget = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(t?.tagName ?? '') || !!t?.isContentEditable || !!t?.closest?.('[role="dialog"]');
};

/** Màn hình cảm ứng (điện thoại / máy tính bảng): hiện joystick, nút zoom, chat thu gọn. */
const IS_TOUCH = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
/** Đã bấm "Để sau" ở gợi ý tạo nhân vật (chỉ là tiện ích trên trình duyệt này). */
const PROMPT_KEY = 'officehub.avatar.prompt-dismissed';
const promptDismissed = () => { try { return localStorage.getItem(PROMPT_KEY) === '1'; } catch { return true; } };
import './office.css';

/** Văn phòng 3D. Route /_protected/office đã kiểm tra đăng nhập trước khi tải trang này. */
export function OfficeView() {
  const { data: account } = useMe();
  const hostRef = useRef<HTMLDivElement>(null);
  const connRef = useRef<OfficeConnection | null>(null);
  const { me, conn, online, zone, chat, kickReason } = useOffice();
  const [text, setText] = useState('');
  const [nearAction, setNearAction] = useState<string | null>(null);
  const [seatInfo, setSeatInfo] = useState<{ seat: SitSpot; sitting: boolean } | null>(null);
  const [scene, setScene] = useState<OfficeScene | null>(null);
  const roomsNow = useRoomsNow();
  const [editorOpen, setEditorOpen] = useState(false);
  const [avatarPrompt, setAvatarPrompt] = useState(() => !promptDismissed());
  const hasLook = validLook(account?.avatar) !== null;
  const dismissPrompt = () => { setAvatarPrompt(false); try { localStorage.setItem(PROMPT_KEY, '1'); } catch { /* bỏ qua */ } };

  // Bảng "Đang họp" trên phòng họp (lịch đặt phòng — module Meetings), làm mới mỗi phút.
  useEffect(() => {
    if (!scene) return;
    for (const r of roomsNow.data ?? []) {
      const text = r.current ? `Đang họp · ${r.current.title} · đến ${formatTime(r.current.endAt)}`
        : r.next ? `Trống · ${formatTime(r.next.startAt)} ${r.next.title}` : null;
      scene.setRoomStatus(r.roomId, text, !!r.current);
    }
  }, [scene, roomsNow.data]);
  const [help, setHelp] = useState(true);
  // Chat: kênh toàn văn phòng + kênh phòng có tường đang đứng (đổi tự động theo vị trí)
  const [roomCh, setRoomCh] = useState<VoiceChannelInfo | null>(null);
  const [chatTab, setChatTab] = useState<'office' | 'room'>('office');
  const [chatOpen, setChatOpen] = useState(!IS_TOUCH);
  const tab = roomCh ? chatTab : 'office';
  const [voice, setVoice] = useState<VoiceClient | null>(null);
  const [voiceView, setVoiceView] = useState<VoiceView>(VOICE_INITIAL);
  const { data: today, noProfile } = useToday();
  const check = useCheck();
  // Tài liệu: hộp thoại kho / bảng tin, kéo thả tải lên, màn hình phòng đang chiếu
  const spaces = useSpaces();
  const uploads = useUploadQueue();
  const cabinetDept = useCabinetDepartment();
  const [docs, setDocs] = useState<DocsMode | null>(null);
  const [screen, setScreen] = useState<ScreenDto | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const roomRef = useRef<string | null>(null);
  roomRef.current = roomCh?.id ?? null;
  const interactObj = nearAction?.startsWith('interact:') ? OBJECT_BY_ID.get(nearAction.slice('interact:'.length)) : undefined;
  /** Kho mặc định để tải lên / mở từ nút HUD: kho phòng ban đầu tiên mình vào được (thường là phòng mình), không có thì kho công ty. */
  const defaultSpace = (): ISpaceRef => {
    const d = spaces.data?.find((s) => s.kind === 'Department' && s.canWrite);
    return d ? { kind: 'Department', id: d.id } : { kind: 'Company', id: null };
  };
  const openInteract = (o: MapObject) => {
    switch (o.interact) {
      case 'library': return setDocs({ kind: 'browse', space: { kind: 'Company', id: null }, title: '📚 Thư viện · Kho chung công ty' });
      case 'notices': return setDocs({ kind: 'notices', title: '📌 Bảng tin' });
      case 'screen':
        if (!roomRef.current) return toast.info('Màn hình này chỉ để xem — vào phòng họp để chiếu tài liệu');
        return setDocs({ kind: 'browse', space: null, title: `📺 Chiếu tài liệu · ${roomCh?.name ?? ''}`, present: true });
      case 'documents': {
        const dep = cabinetDept(o);
        if (dep && !spaces.data?.some((s) => s.kind === 'Department' && s.id === dep.id)) return toast.error(`Bạn không có quyền mở tủ hồ sơ của ${dep.name}`);
        return setDocs({ kind: 'browse', space: dep ? { kind: 'Department', id: dep.id } : defaultSpace(), title: `🗄 Tủ hồ sơ${dep ? ` · ${dep.name}` : ''}` });
      }
    }
  };
  const present = (assetId: string) =>
    connRef.current?.pinScreen(assetId).then(() => { setDocs(null); toast.success('Đã chiếu lên màn hình phòng'); })
      .catch((err: unknown) => toast.error(errorMessage(err)));
  const clearScreen = () => void connRef.current?.clearScreen().catch((err: unknown) => toast.error(errorMessage(err)));
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = await filesFromDrop(e.dataTransfer.items);
    if (!files.length) return;
    const space = defaultSpace();
    const name = spaces.data?.find((s) => s.kind === space.kind && s.id === space.id)?.name ?? 'Công ty';
    toast.info(`Đang tải ${files.length} file lên kho ${name}…`);
    void uploads.start(files, space, null);
  };
  // Đổi phòng → bỏ khung chiếu cũ. Server tự gửi ScreenChanged khi thấy mình bước vào phòng đang chiếu; hỏi thêm GetScreen (sau khi
  // vị trí kịp tới server) để chắc chắn sau khi kết nối lại — chỉ nhận kết quả có tài liệu, không ghi đè bằng null.
  useEffect(() => {
    setScreen(null);
    if (!roomCh || conn !== 'online') return;
    let alive = true;
    const timer = setTimeout(() => connRef.current?.getScreen().then((s) => { if (alive && s && s.roomId === roomRef.current) setScreen(s); }).catch(() => {}), 600);
    return () => { alive = false; clearTimeout(timer); };
  }, [roomCh?.id, conn]);

  // Chấm công trong văn phòng 3D (nguồn "office3d")
  const doCheck = () => {
    if (noProfile) return toast.error('Tài khoản chưa gắn hồ sơ nhân viên nên chưa chấm công được');
    if (check.isPending) return;
    check.mutate('office3d', {
      onSuccess: (t) => toast.success(t.checkedIn ? `Đã chấm công vào lúc ${formatTime(t.serverTime)}` : `Đã chấm công ra lúc ${formatTime(t.serverTime)}`),
      onError: (err) => toast.error(errorMessage(err)),
    });
  };
  const doCheckRef = useRef(doCheck);
  doCheckRef.current = doCheck;

  // Phím E (hoặc chạm vào khung gợi ý trên điện thoại): gần máy chấm công → chấm công; không thì ngồi / đứng ở ghế gần nhất
  // Gần tủ hồ sơ / kệ thư viện / màn hình / bảng tin (đang đứng) → mở tài liệu
  const doAction = () => {
    if (nearAction === 'attendance.checkin' && !seatInfo?.sitting) doCheckRef.current();
    else if (interactObj && !seatInfo?.sitting) openInteract(interactObj);
    else scene?.toggleSit();
  };
  const doActionRef = useRef(doAction);
  doActionRef.current = doAction;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'e' || e.repeat || typingTarget(e)) return;
      doActionRef.current();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  // Trình duyệt chặn phát âm thanh tới khi người dùng thao tác → lần bấm / gõ phím đầu tiên (đi lại, chat…) mở âm thanh luôn
  useEffect(() => {
    if (!voice || !voiceView.needsAudioClick) return;
    const resume = () => void voice.resumeAudio();
    addEventListener('pointerdown', resume, { once: true });
    addEventListener('keydown', resume, { once: true });
    return () => { removeEventListener('pointerdown', resume); removeEventListener('keydown', resume); };
  }, [voice, voiceView.needsAudioClick]);

  // Phím M: bật / tắt micro khi đang trong voice
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'm' || e.repeat || typingTarget(e)) return;
      if (voice?.state.status === 'on') void voice.toggleMic();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [voice]);

  // 1) Đưa tài khoản vào store của văn phòng
  useEffect(() => {
    if (account) useOffice.getState().setMe(account);
  }, [account]);

  // 2) Dựng scene + kết nối realtime (chỉ chạy lại khi đổi tài khoản)
  const meId = me?.id;
  useEffect(() => {
    const s = useOffice.getState();
    const me = s.me;
    if (!me || !hostRef.current) return;
    const scene = new OfficeScene(hostRef.current);
    const players = new Map<string, string>();
    const voice = new VoiceClient({ me: () => scene.myPosition(), of: (id) => scene.positionOf(id) });
    voice.onChange = setVoiceView;
    voice.onSpeaking = (ids) => scene.setSpeaking(ids);
    voice.onError = (t) => toast.error(t);
    const c = new OfficeConnection({
      welcome: (w) => {
        s.setConn('online');
        for (const p of w.players) {
          players.set(p.id, p.name);
          if (p.id === w.selfId) scene.spawnMe(p.id, p.name, p.x, p.z, parseLook(p.look));
          else scene.upsertOther(p.id, p.name, p.x, p.z, p.r, p.anim, parseLook(p.look));
        }
        s.setOnline(players.size);
        void voice.enable(); // vào văn phòng = vào voice để nghe (micro mặc định tắt)
      },
      playerJoined: (p) => {
        if (p.id === me.id) return;
        players.set(p.id, p.name);
        scene.upsertOther(p.id, p.name, p.x, p.z, p.r, p.anim, parseLook(p.look));
        s.setOnline(players.size);
      },
      playerLeft: (id) => {
        players.delete(id);
        scene.removeOther(id);
        s.setOnline(players.size);
      },
      positions: (list) => list.forEach((p) => p.id !== me.id && scene.moveOther(p.id, p.x, p.z, p.r, p.anim)),
      chat: (m) => s.pushChat(m),
      teleport: (x, z) => scene.teleportMe(x, z),
      lookChanged: (id, look) => scene.setLook(id, parseLook(look)),
      screenChanged: (roomId, sc) => { if (roomId === roomRef.current) setScreen(sc); },
      kicked: (reason) => { s.kick(reason); void voice.disable(); },
      state: (st) => s.setConn(st),
    });
    scene.onMove = (x, z, r, a) => c.move(x, z, r, a);
    scene.onZone = (z) => s.setZone(z);
    scene.onNearAction = setNearAction;
    scene.onSeat = setSeatInfo;
    scene.onHint = (t) => toast.info(t);
    scene.onVoiceChannel = (ch) => { voice.setChannel(ch); setRoomCh(ch.id === 'open' ? null : ch); };
    setScene(scene);
    setVoice(voice);
    if (import.meta.env.DEV) Object.assign(window, { __officeScene: scene, __officeVoice: voice }); // chỉ để test e2e khi dev
    connRef.current = c;
    // Hoãn 1 tick: React StrictMode (dev) gọi effect → cleanup → effect ngay lập tức; tránh mở rồi huỷ kết nối giữa chừng.
    const startTimer = setTimeout(() => c.start().catch(() => s.setConn('offline')), 0);
    return () => {
      clearTimeout(startTimer);
      void c.stop();
      voice.dispose();
      setVoice(null);
      setVoiceView(VOICE_INITIAL);
      setScene(null);
      scene.dispose();
    };
  }, [meId]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    const c = connRef.current;
    await (tab === 'room' ? c?.roomChat(t) : c?.chat(t))?.catch((err: unknown) => toast.error(errorMessage(err)));
  };

  return (
    <div className={`office-root ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files') && !docs) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false); }}
      onDrop={(e) => void onDrop(e)}>
      <div ref={hostRef} className="scene" />
      <div className="hud">
        <div className="card me">
          <b>{me?.fullName ?? '…'}</b>
          <small>{me?.roles.join(', ')}</small>
          <Link to={PATHS.dashboard}>Cổng nhân sự →</Link>
          <button type="button" className="link" onClick={() => setEditorOpen(true)} data-testid="office-avatar">👤 Nhân vật</button>
          <button type="button" className="link" onClick={() => setDocs({ kind: 'browse', space: defaultSpace(), title: '📁 Tài liệu', present: !!roomCh })} data-testid="office-docs-open">📁 Tài liệu</button>
        </div>
        {account && !hasLook && avatarPrompt && conn === 'online' && (
          <div className="card avatar-prompt" data-testid="office-avatar-prompt">
            <span>Bạn đang dùng <b>nhân vật mặc định</b>. Tạo nhân vật riêng để đồng nghiệp dễ nhận ra?</span>
            <div>
              <button type="button" className="primary" onClick={() => { dismissPrompt(); setEditorOpen(true); }}>Tạo nhân vật</button>
              <button type="button" onClick={dismissPrompt}>Để sau</button>
            </div>
          </div>
        )}
        <div className="card status">
          <span className={`dot ${conn}`} /> {conn === 'online' ? `${online} người online` : STATUS[conn]}
        </div>
        {zone && <div className="card zone">{zone}</div>}
        {chatOpen ? (
          <form className="chat" onSubmit={send} data-testid="office-chat">
            <div className="tabs">
              <button type="button" className={tab === 'office' ? 'on' : ''} onClick={() => setChatTab('office')}>Toàn văn phòng</button>
              {roomCh && (
                <button type="button" className={tab === 'room' ? 'on' : ''} onClick={() => setChatTab('room')} data-testid="office-chat-room-tab">
                  🔒 {roomCh.name}
                  {tab !== 'room' && chat.some((l) => l.channel === 'room' && l.roomId === roomCh.id) && <span className="dot-new" />}
                </button>
              )}
              {IS_TOUCH && <button type="button" className="close" onClick={() => setChatOpen(false)} aria-label="Thu gọn chat">✕</button>}
            </div>
            <div className="log">
              {chat.filter((l) => (tab === 'room' ? l.channel === 'room' && l.roomId === roomCh?.id : l.channel !== 'room')).map((l, i) => (
                <div key={i}><b>{l.name}:</b> {l.text}</div>
              ))}
            </div>
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200}
              placeholder={tab === 'room' ? `Chỉ người trong ${roomCh?.name} thấy…` : 'Nhập tin nhắn, Enter để gửi'} />
          </form>
        ) : (
          <button type="button" className="card chat-toggle" onClick={() => setChatOpen(true)} aria-label="Mở chat">💬</button>
        )}
        {IS_TOUCH && <Joystick onChange={(x, y) => scene?.setStick(x, y)} />}
        {nearAction === 'attendance.checkin' && !seatInfo?.sitting ? (
          <button type="button" className="card prompt" onClick={doAction}>Máy chấm công · {IS_TOUCH ? 'chạm' : <>bấm <kbd>E</kbd></>} để {today?.checkedIn ? 'chấm công ra' : 'chấm công vào'}</button>
        ) : interactObj && !seatInfo?.sitting ? (
          <button type="button" className="card prompt" data-testid="office-interact-prompt" onClick={doAction}>
            {INTERACT_LABEL[interactObj.interact ?? ''] ?? 'Đồ vật'} · {IS_TOUCH ? 'chạm' : <>bấm <kbd>E</kbd></>} để {INTERACT_VERB[interactObj.interact ?? ''] ?? 'xem'}
          </button>
        ) : seatInfo && (
          <button type="button" className="card prompt" data-testid="office-seat-prompt" onClick={doAction}>
            {seatInfo.sitting
              ? <>Đang ngồi ở <b>{seatInfo.seat.label}</b> · {IS_TOUCH ? 'chạm' : <kbd>E</kbd>} hoặc di chuyển để đứng dậy</>
              : <><b>{seatInfo.seat.label.charAt(0).toUpperCase() + seatInfo.seat.label.slice(1)}</b> · {IS_TOUCH ? 'chạm' : <>bấm <kbd>E</kbd></>} để ngồi</>}
          </button>
        )}
        <Minimap scene={scene} />
        <div className="card camera">
          <button type="button" onClick={() => scene?.rotateCamera(-1)} title="Xoay trái (Q)">⟲</button>
          <button type="button" onClick={() => scene?.rotateCamera(1)} title="Xoay phải (R)">⟳</button>
          {IS_TOUCH && <>
            <button type="button" onClick={() => scene?.zoom(-1)} title="Phóng to">＋</button>
            <button type="button" onClick={() => scene?.zoom(1)} title="Thu nhỏ">－</button>
          </>}
          <button type="button" onClick={() => setHelp((h) => !h)} title="Hướng dẫn">?</button>
        </div>
        {help && (
          <div className="card help" data-testid="office-help">
            <b>Điều khiển</b>
            {IS_TOUCH ? <>
              <span>Kéo joystick góc dưới trái · đi</span>
              <span>Chạm lên sàn / bản đồ nhỏ · tự đi tới</span>
              <span>Chạm khung gợi ý · ngồi / đứng, chấm công ở máy</span>
              <span>⟲ ⟳ xoay góc nhìn · ＋ － zoom · 💬 chat</span>
            </> : <>
              <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / mũi tên · đi</span>
              <span>Bấm chuột lên sàn / bản đồ nhỏ · tự đi tới</span>
              <span><kbd>E</kbd> · ngồi / đứng, chấm công ở máy</span>
              <span><kbd>Q</kbd> <kbd>R</kbd> · xoay góc nhìn · cuộn chuột · zoom</span>
              <span><kbd>M</kbd> · bật / tắt micro (voice tự kết nối, micro mặc định tắt)</span>
            </>}
            <span>Vào phòng có tường (phòng họp…) → chat có thêm tab riêng của phòng</span>
            <span>📁 Tài liệu · tủ hồ sơ / kệ thư viện / bảng tin · <kbd>E</kbd> mở kho; màn hình phòng họp · chiếu tài liệu; kéo thả file vào để tải lên</span>
            <button type="button" onClick={() => setHelp(false)}>Đã hiểu</button>
          </div>
        )}
        <VoicePanel voice={voice} view={voiceView} />
        <ScreenView screen={voiceView.screen} />
        <ScreenDocPanel screen={screen} onClear={clearScreen} />
        {uploads.items.length > 0 && <div className="docs-uploads"><UploadPanel items={uploads.items} onClear={uploads.clear} /></div>}
        {dragOver && <div className="drop-hint">Thả file / thư mục để tải lên kho tài liệu</div>}
        <button className={`card checkin ${today?.checkedIn ? 'on' : ''}`} onClick={doCheck} disabled={check.isPending || noProfile}
          title={noProfile ? 'Tài khoản chưa gắn hồ sơ nhân viên' : undefined} data-testid="office-check">
          🕘 {noProfile ? 'Không chấm công' : today?.checkedIn ? 'Chấm công ra' : 'Chấm công vào'}
          {today?.day.firstIn && <small>Vào {formatTime(today.day.firstIn)}</small>}
        </button>
      </div>
      <OfficeDocsDialog mode={docs} onClose={() => setDocs(null)} onPresent={roomCh ? present : undefined} />
      <AvatarEditorDialog open={editorOpen} onOpenChange={setEditorOpen}
        onSaved={(look) => {
          if (me) scene?.setLook(me.id, look ?? DEFAULT_LOOK);
          void connRef.current?.refreshLook().catch((err: unknown) => toast.error(errorMessage(err)));
        }} />
      {conn === 'kicked' && (
        <div className="overlay">
          {kickReason ?? 'Bạn đã bị ngắt khỏi văn phòng.'}
          <button onClick={() => location.reload()}>Vào lại</button>
        </div>
      )}
    </div>
  );
}

const INTERACT_LABEL: Record<string, string> = { documents: '🗄 Tủ hồ sơ', library: '📚 Thư viện', screen: '📺 Màn hình', notices: '📌 Bảng tin' };
const INTERACT_VERB: Record<string, string> = { documents: 'mở kho phòng ban', library: 'mở kho chung', screen: 'chiếu tài liệu', notices: 'xem tin & tài liệu mới' };
const STATUS = { connecting: 'Đang kết nối…', reconnecting: 'Mất kết nối, đang thử lại…', offline: 'Mất kết nối', kicked: 'Đã đăng nhập nơi khác', online: '' };
