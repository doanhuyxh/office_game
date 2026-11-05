import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { useCheck, useToday } from '@/features/attendance';
import { useMe } from '@/features/auth';
import { errorMessage } from '@/utils/errors';
import { formatTime } from '@/utils/date';
import { useOffice } from '../store/office.store';
import { PATHS } from '@/config/paths';
import { OfficeScene } from '../engine/OfficeScene';
import { OfficeConnection } from '../api/officeHub';
import './office.css';

/** Văn phòng 3D. Route /_protected/office đã kiểm tra đăng nhập trước khi tải trang này. */
export function OfficeView() {
  const { data: account } = useMe();
  const hostRef = useRef<HTMLDivElement>(null);
  const connRef = useRef<OfficeConnection | null>(null);
  const { me, conn, online, zone, chat } = useOffice();
  const [text, setText] = useState('');
  const [nearAction, setNearAction] = useState<string | null>(null);
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

  // Phím E khi đứng cạnh máy chấm công
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'e' || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (nearAction === 'attendance.checkin') doCheckRef.current();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [nearAction]);

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
    const c = new OfficeConnection({
      welcome: (w) => {
        s.setConn('online');
        for (const p of w.players) {
          players.set(p.id, p.name);
          if (p.id === w.selfId) scene.spawnMe(p.name, p.x, p.z);
          else scene.upsertOther(p.id, p.name, p.x, p.z, p.r);
        }
        s.setOnline(players.size);
      },
      playerJoined: (p) => {
        if (p.id === me.id) return;
        players.set(p.id, p.name);
        scene.upsertOther(p.id, p.name, p.x, p.z, p.r);
        s.setOnline(players.size);
      },
      playerLeft: (id) => {
        players.delete(id);
        scene.removeOther(id);
        s.setOnline(players.size);
      },
      positions: (list) => list.forEach((p) => p.id !== me.id && scene.moveOther(p.id, p.x, p.z, p.r)),
      chat: (m) => s.pushChat({ ...m, at: String(m.at) }),
      teleport: (x, z) => scene.teleportMe(x, z),
      kicked: () => s.setConn('kicked'),
      state: (st) => s.setConn(st),
    });
    scene.onMove = (x, z, r, a) => c.move(x, z, r, a);
    scene.onZone = (z) => s.setZone(z);
    scene.onNearAction = setNearAction;
    connRef.current = c;
    // Hoãn 1 tick: React StrictMode (dev) gọi effect → cleanup → effect ngay lập tức; tránh mở rồi huỷ kết nối giữa chừng.
    const startTimer = setTimeout(() => c.start().catch(() => s.setConn('offline')), 0);
    return () => {
      clearTimeout(startTimer);
      void c.stop();
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
        {nearAction === 'attendance.checkin' && (
          <div className="card prompt">Máy chấm công · bấm <kbd>E</kbd> để {today?.checkedIn ? 'chấm công ra' : 'chấm công vào'}</div>
        )}
        <button className={`card checkin ${today?.checkedIn ? 'on' : ''}`} onClick={doCheck} disabled={check.isPending || noProfile}
          title={noProfile ? 'Tài khoản chưa gắn hồ sơ nhân viên' : undefined} data-testid="office-check">
          🕘 {noProfile ? 'Không chấm công' : today?.checkedIn ? 'Chấm công ra' : 'Chấm công vào'}
          {today?.day.firstIn && <small>Vào {formatTime(today.day.firstIn)}</small>}
        </button>
      </div>
      {conn === 'kicked' && (
        <div className="overlay">Tài khoản vừa vào văn phòng từ tab/thiết bị khác.<button onClick={() => location.reload()}>Vào lại ở đây</button></div>
      )}
    </div>
  );
}

const STATUS = { connecting: 'Đang kết nối…', reconnecting: 'Mất kết nối, đang thử lại…', offline: 'Mất kết nối', kicked: 'Đã đăng nhập nơi khác', online: '' };
