// E2E voice văn phòng 3D: 2 Chrome headless có micro giả (tiếng bíp), tài khoản thử kythuat.nhanvien1 (A) + kythuat.truongphong (B).
// Cần FE (dev) + Api + Realtime + LiveKit dev (docker compose … up -d livekit) đang chạy.
//   TEST_PASSWORD=… [BASE_URL=http://localhost:5173] bun scripts/dev/voice-e2e.ts <thư-mục-ảnh> <tiền-tố-profile-chrome>
import { BASE, launch } from './cdp';
const PW = process.env.TEST_PASSWORD ?? (() => { throw new Error('Đặt TEST_PASSWORD (mật khẩu chung trong account.txt)'); })();
const [shots = '/tmp/office-shots', prof = '/tmp/voice-e2e-profile'] = process.argv.slice(2);
let pass = 0, total = 0;
const check = (n: string, ok: boolean, d?: unknown) => { total++; if (ok) pass++; console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : JSON.stringify(d)); };
const MEDIA = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
  '--auto-select-desktop-capture-source=Entire screen'];
const A = await launch(9411, `${prof}-a`, 1440, 900, MEDIA), B = await launch(9412, `${prof}-b`, 1100, 700, MEDIA);
type P = typeof A;
const waitFor = async (p: P, expr: string, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await p.evalJs(expr).catch(() => false)) return true; await p.sleep(250); } return false; };
const walk = async (p: P, x: number, z: number) => {
  await p.evalJs(`window.__officeScene.walkTo(${x}, ${z})`);
  return waitFor(p, `(()=>{const m=window.__officeScene.snapshot().me;return Math.hypot(m.x-${x},m.z-${z})<0.3 && !window.__officeScene.snapshot().target})()`, 20000);
};
const voice = (p: P) => p.evalJs(`(()=>{const v=window.__officeVoice; const r=v.room; return { ...v.state, screen: !!v.state.screen, room: r?.name ?? null,
  remotes: r ? [...r.remoteParticipants.values()].map(x=>({ id: x.identity, name: x.name, mic: [...x.trackPublications.values()].filter(t=>t.source==='microphone').map(t=>t.isSubscribed) })) : [] } })()`);
const click = (p: P, testid: string) => p.evalJs(`document.querySelector('[data-testid=${testid}]').click()`);
const NAME_A = 'Đỗ Hải Nam', NAME_B = 'Ngô Thanh Tùng';

try {
  check('login A', (await A.login('kythuat.nhanvien1', PW)) === 200);
  check('login B', (await B.login('kythuat.truongphong', PW)) === 200);
  await A.go(`${BASE}/office`, 1000); await B.go(`${BASE}/office`, 1000);
  check('scenes ready', await waitFor(A, `!!window.__officeScene?.snapshot().me`) && await waitFor(B, `!!window.__officeScene?.snapshot().me`));
  await waitFor(A, `window.__officeScene.snapshot().others.some(o=>o.name===${JSON.stringify(NAME_B)})`);

  // 1) Vào văn phòng là tự vào voice để nghe, micro mặc định tắt
  check('A auto-joined voice, mic off', await waitFor(A, `window.__officeVoice.state.status==='on' && !window.__officeVoice.state.micOn`), await voice(A));
  check('no voice toggle button anymore', !(await A.evalJs(`!!document.querySelector('[data-testid=office-voice-toggle]')`)));
  await Promise.all([walk(A, 23, 19), walk(B, 24, 19)]);
  await click(A, 'office-voice-mic'); await click(B, 'office-voice-mic');
  check('mic turns on when clicked', await waitFor(B, `document.querySelector('[data-testid=office-voice-mic]').dataset.on==='true'`, 5000), await voice(B));
  check('A voice on, channel open', await waitFor(A, `document.querySelector('[data-testid=office-voice]')?.dataset.status==='on' && document.querySelector('[data-testid=office-voice]').dataset.channel==='open'`), await voice(A));
  check('B voice on', await waitFor(B, `document.querySelector('[data-testid=office-voice]')?.dataset.status==='on'`), await voice(B));
  check('A subscribed to B mic (near)', await waitFor(A, `[...(window.__officeVoice.room?.remoteParticipants.values() ?? [])].some(p=>[...p.trackPublications.values()].some(t=>t.source==='microphone' && t.isSubscribed))`), await voice(A));
  check('A HUD: 1 người nghe được', await waitFor(A, `document.querySelector('[data-testid=office-voice-peers]')?.textContent.includes('1 người trong tầm nghe')`), await voice(A));
  check('B speaking ring visible to A (fake mic beeps)', await waitFor(A, `(()=>{const s=window.__officeScene; return [...s['others'].values()].some(o=>o.avatar.speaking)})()`, 12000));
  await A.sleep(600);
  await A.shot(`${shots}/60-voice-open.png`);

  // 2) Micro: phím M tắt / bật
  await A.key('m', 60);
  check('M mutes mic', await waitFor(A, `document.querySelector('[data-testid=office-voice-mic]').dataset.on==='false'`, 4000));
  await A.key('m', 60);
  check('M unmutes mic', await waitFor(A, `document.querySelector('[data-testid=office-voice-mic]').dataset.on==='true'`, 4000));

  // 3) B đi xa (> 6 m) → A thôi nhận âm của B
  await walk(B, 5, 19);
  check('A unsubscribes far B', await waitFor(A, `[...window.__officeVoice.room.remoteParticipants.values()].every(p=>[...p.trackPublications.values()].every(t=>t.source!=='microphone' || !t.isSubscribed))`, 6000), await voice(A));
  check('A HUD: chưa có ai nghe', await waitFor(A, `document.querySelector('[data-testid=office-voice-peers]')?.textContent.includes('chưa có ai nghe')`, 3000));

  // 4) A vào phòng họp lớn → kênh riêng; B ở ngoài không cùng room
  await walk(A, 25, 6.5);
  check('A switched to meeting-large', await waitFor(A, `window.__officeVoice.room?.name==='officehub-meeting-large' && window.__officeVoice.state.status==='on'`, 8000), await voice(A));
  check('A alone in meeting room (B not there)', (await voice(A)).remotes.length === 0, await voice(A));
  check('B still in open, A gone from B room', await waitFor(B, `window.__officeVoice.room?.name==='officehub-open' && ![...window.__officeVoice.room.remoteParticipants.values()].some(p=>p.name===${JSON.stringify(NAME_A)})`, 6000), await voice(B));
  // Server không cho xin token phòng họp khi đang đứng ngoài
  const tokB = await B.evalJs(`fetch('/rt/voice/token?room=officehub-meeting-large',{method:'POST'}).then(r=>r.json())`);
  check('server issues token for position, not requested room', tokB.channel === 'open' && tokB.room === 'officehub-open', tokB);
  check('screen share button in walled room, not in open area', await A.evalJs(`!!document.querySelector('[data-testid=office-voice-share]')`) && !(await B.evalJs(`!!document.querySelector('[data-testid=office-voice-share]')`)));

  // 5) B vào phòng họp → nghe cả phòng; A chia sẻ màn hình → B thấy
  await walk(B, 27, 6.5);
  check('B joined meeting-large', await waitFor(B, `window.__officeVoice.room?.name==='officehub-meeting-large' && window.__officeVoice.state.status==='on'`, 8000), await voice(B));
  check('A and B hear each other in meeting', await waitFor(A, `document.querySelector('[data-testid=office-voice-peers]')?.textContent.includes('1 người trong tầm nghe')`, 6000), await voice(A));
  await A.evalJs(`window.__officeVoice.toggleScreen()`);
  const sharing = await waitFor(A, `window.__officeVoice.state.sharing`, 5000);
  check('A screen share started', sharing, await voice(A));
  if (sharing) {
    check('B sees shared screen', await waitFor(B, `!!document.querySelector('.office-root .screen video') && document.querySelector('.office-root .screen video').videoWidth>0`, 10000), await voice(B));
    await B.sleep(800);
    await B.shot(`${shots}/61-voice-screen.png`);
    await A.evalJs(`window.__officeVoice.toggleScreen()`);
    check('B screen view closes when A stops', await waitFor(B, `!document.querySelector('.office-root .screen')`, 6000));
  }

  // 6) Client "sửa code" không đổi kênh khi ra khỏi phòng → server đẩy khỏi room sau ~3 giây
  await A.evalJs(`window.__officeVoice.setChannel = () => {}`);
  await walk(A, 10, 9);
  check('server kicks A out of meeting room after leaving', await waitFor(B, `![...window.__officeVoice.room.remoteParticipants.values()].some(p=>p.name===${JSON.stringify(NAME_A)})`, 9000), await voice(B));

  // 7) Tắt loa: vẫn ở trong kênh, chỉ không phát âm thanh người khác
  await click(B, 'office-voice-speaker');
  check('speaker off keeps voice connected', await waitFor(B, `document.querySelector('[data-testid=office-voice-speaker]').dataset.on==='false' && !!window.__officeVoice.room && window.__officeVoice.state.status==='on'`, 4000), await voice(B));
  await click(B, 'office-voice-speaker');
  check('speaker back on', await waitFor(B, `document.querySelector('[data-testid=office-voice-speaker]').dataset.on==='true'`, 4000));

  // LiveKit tự log khi kết nối bị chủ động đóng (đổi kênh, server đẩy khỏi phòng) — không phải lỗi app
  const ignore = (e: string) => /Permissions policy|DevTools|could not playback audio|User-Initiated Abort|data channel '\w+' closed unexpectedly/i.test(e);
  check('no console errors A', A.errors.filter((e) => !ignore(e)).length === 0, A.errors.slice(0, 5));
  check('no console errors B', B.errors.filter((e) => !ignore(e)).length === 0, B.errors.slice(0, 5));
} finally {
  A.close(); B.close();
}
console.log(`\n${pass}/${total} passed`);
