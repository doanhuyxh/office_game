import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { useCheck, useToday } from '@/features/attendance';
import { useMe } from '@/features/auth';
import { useRoomsNow } from '@/features/meetings';
import { errorMessage } from '@/utils/errors';
import { formatTime } from '@/utils/date';
import { useOffice } from '../store/office.store';
import { PATHS } from '@/config/paths';
import { OfficeScene } from '../engine/OfficeScene';
import { OfficeConnection } from '../api/officeHub';
import type { Seat } from '../engine/mapTypes';
import { Minimap } from './Minimap';
import { VOICE_INITIAL, VoiceClient, type VoiceView } from '../api/voiceClient';
import { ScreenView, VoicePanel } from './VoicePanel';
import './office.css';

/** Văn phòng 3D. Route /_protected/office đã kiểm tra đăng nhập trước khi tải trang này. */
export function OfficeView() {
  const { data: account } = useMe();
  const hostRef = useRef<HTMLDivElement>(null);
  const connRef = useRef<OfficeConnection | null>(null);
  const { me, conn, online, zone, chat, kickReason } = useOffice();
  const [text, setText] = useState('');
  const [nearAction, setNearAction] = useState<string | null>(null);
  const [seatInfo, setSeatInfo] = useState<{ seat: Seat; sitting: boolean } | null>(null);
  const [scene, setScene] = useState<OfficeScene | null>(null);
  const roomsNow = useRoomsNow();

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
  const [voice, setVoice] = useState<VoiceClient | null>(null);
  const [voiceView, setVoiceView] = useState<VoiceView>(VOICE_INITIAL);
  const { data: today, noProfile } = useToday();
  const check = useCheck();

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

  // Phím E: gần máy chấm công → chấm công; không thì ngồi / đứng ở ghế gần nhất
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'e' || e.repeat || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (nearAction === 'attendance.checkin' && !seatInfo?.sitting) doCheckRef.current();
      else scene?.toggleSit();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [nearAction, seatInfo, scene]);

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
      if (e.key.toLowerCase() !== 'm' || e.repeat || (e.target as HTMLElement)?.tagName === 'INPUT') return;
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
          if (p.id === w.selfId) scene.spawnMe(p.id, p.name, p.x, p.z);
          else scene.upsertOther(p.id, p.name, p.x, p.z, p.r, p.anim);
        }
        s.setOnline(players.size);
        void voice.enable(); // vào văn phòng = vào voice để nghe (micro mặc định tắt)
      },
      playerJoined: (p) => {
        if (p.id === me.id) return;
        players.set(p.id, p.name);
        scene.upsertOther(p.id, p.name, p.x, p.z, p.r, p.anim);
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
      kicked: (reason) => { s.kick(reason); void voice.disable(); },
      state: (st) => s.setConn(st),
    });
    scene.onMove = (x, z, r, a) => c.move(x, z, r, a);
    scene.onZone = (z) => s.setZone(z);
    scene.onNearAction = setNearAction;
    scene.onSeat = setSeatInfo;
    scene.onHint = (t) => toast.info(t);
    scene.onVoiceChannel = (ch) => voice.setChannel(ch);
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
    await connRef.current?.chat(t).catch(() => {});
  };

  return (
    <div className="office-root">
      <div ref={hostRef} className="scene" />
      <div className="hud">
        <div className="card me">
          <b>{me?.fullName ?? '…'}</b>
          <small>{me?.roles.join(', ')}</small>
          <Link to={PATHS.dashboard}>Cổng nhân sự →</Link>
        </div>
        <div className="card status">
          <span className={`dot ${conn}`} /> {conn === 'online' ? `${online} người online` : STATUS[conn]}
        </div>
        {zone && <div className="card zone">{zone}</div>}
        <form className="chat" onSubmit={send}>
          <div className="log">
            {chat.map((l, i) => (
              <div key={i}><b>{l.name}:</b> {l.text}</div>
            ))}
          </div>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Nhập tin nhắn, Enter để gửi" maxLength={200} />
        </form>
        {nearAction === 'attendance.checkin' && !seatInfo?.sitting ? (
          <div className="card prompt">Máy chấm công · bấm <kbd>E</kbd> để {today?.checkedIn ? 'chấm công ra' : 'chấm công vào'}</div>
        ) : seatInfo && (
          <div className="card prompt" data-testid="office-seat-prompt">
            {seatInfo.sitting ? <>Đang ngồi ở bàn <b>{seatInfo.seat.id}</b> · <kbd>E</kbd> hoặc di chuyển để đứng dậy</> : <>Bàn <b>{seatInfo.seat.id}</b> · bấm <kbd>E</kbd> để ngồi</>}
          </div>
        )}
        <Minimap scene={scene} />
        <div className="card camera">
          <button type="button" onClick={() => scene?.rotateCamera(-1)} title="Xoay trái (Q)">⟲</button>
          <button type="button" onClick={() => scene?.rotateCamera(1)} title="Xoay phải (R)">⟳</button>
          <button type="button" onClick={() => setHelp((h) => !h)} title="Hướng dẫn">?</button>
        </div>
        {help && (
          <div className="card help" data-testid="office-help">
            <b>Điều khiển</b>
            <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / mũi tên · đi</span>
            <span>Bấm chuột lên sàn / bản đồ nhỏ · tự đi tới</span>
            <span><kbd>E</kbd> · ngồi / đứng, chấm công ở máy</span>
            <span><kbd>Q</kbd> <kbd>R</kbd> · xoay góc nhìn · cuộn chuột · zoom</span>
            <span><kbd>M</kbd> · bật / tắt micro (voice tự kết nối, micro mặc định tắt)</span>
            <button type="button" onClick={() => setHelp(false)}>Đã hiểu</button>
          </div>
        )}
        <VoicePanel voice={voice} view={voiceView} />
        <ScreenView screen={voiceView.screen} />
        <button className={`card checkin ${today?.checkedIn ? 'on' : ''}`} onClick={doCheck} disabled={check.isPending || noProfile}
          title={noProfile ? 'Tài khoản chưa gắn hồ sơ nhân viên' : undefined} data-testid="office-check">
          🕘 {noProfile ? 'Không chấm công' : today?.checkedIn ? 'Chấm công ra' : 'Chấm công vào'}
          {today?.day.firstIn && <small>Vào {formatTime(today.day.firstIn)}</small>}
        </button>
      </div>
      {conn === 'kicked' && (
        <div className="overlay">
          {kickReason ?? 'Bạn đã bị ngắt khỏi văn phòng.'}
          <button onClick={() => location.reload()}>Vào lại</button>
        </div>
      )}
    </div>
  );
}

const STATUS = { connecting: 'Đang kết nối…', reconnecting: 'Mất kết nối, đang thử lại…', offline: 'Mất kết nối', kicked: 'Đã đăng nhập nơi khác', online: '' };
