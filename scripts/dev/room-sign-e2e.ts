// E2E TEST-87: bảng trạng thái phòng họp trong văn phòng 3D — nằm ngay trên cửa, chữ ngắn ≤ 24 ký tự, đỏ = bận / xám = trống,
// không vẽ đè lên avatar / nhãn tên / bong bóng bot. TEST-89: bong bóng bot nhỏ ("👥 Đang họp" không chủ đề), không che nhãn tên — đo chồng nhau giữa 2 bot. Dựng 3 trạng thái: Phòng họp nhỏ đang họp với AI (2 bot đi vào phòng),
// Phòng họp lớn có lịch đang diễn ra, Hội trường trống có lịch kế tiếp hôm nay. Chrome headless (máy tính 1440×900 + điện thoại 390×844)
// đứng ngoài hành lang / trong phòng, xoay camera 0 / 90 / 180 / 270°, phóng to / thu nhỏ → kiểm tra số đo trên màn hình + chụp ảnh vào SHOTS_DIR.
// Dùng hook dev `window.__officeScene` (chỉ có khi chạy Vite dev).
// TẠO TÀI KHOẢN THẬT → CHỈ chạy trên DB tạm:
//   docker run -d --name e2e-sign-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:55497:5432 postgres:18-alpine
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5281
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=55497;Database=e2e;Username=e2e;Password=e2e'
//        Chat__InternalKey=<≥32 ký tự> Chat__RealtimeToApiKey=<cùng> Chat__McpToRealtimeKey=<cùng>
//        Telegram__ApiUrl=http://127.0.0.1:9 Smtp__Host=127.0.0.1 Smtp__Port=1   (không gửi gì ra ngoài)
//        Seed__AdminEmail=sign-admin@officehub-e2e.vn Seed__AdminPassword=Sign-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   Realtime: env ASPNETCORE_URLS=http://localhost:5291 Realtime__ApiBaseUrl=http://localhost:5281 LiveKit__Enabled=false + cùng khoá Chat__*
//        dotnet run --project src/OfficeHub.Realtime --no-launch-profile
//   Vite (từ frontend/): VITE_API_TARGET=http://localhost:5281 VITE_RT_TARGET=http://localhost:5291 bunx vite --port 5177 --strictPort
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5281 BASE_URL=http://localhost:5177 ADMIN_LOGIN=sign-admin@officehub-e2e.vn \
//     ADMIN_PASSWORD=Sign-Admin-2026 SHOTS_DIR=/tmp/room-sign bun scripts/dev/room-sign-e2e.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BASE, launch } from './cdp';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5281';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const SHOTS = process.env.SHOTS_DIR ?? `${tmpdir()}/room-sign`;
mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith(name + '=')).at(-1) ?? '';
const login = async (login: string, password: string): Promise<string> => {
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password }) });
  const body = await r.json().catch(() => null) as any;
  if (r.status === 403 && body?.title === '2fa_required') {
    if (!keys[login]) throw new Error(`${login} đã bật 2FA nhưng không có khoá trong ${KEYS_FILE}`);
    const r2 = await fetch(`${API}/api/auth/login/2fa`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookieOf(r, 'officehub.2fa') },
      body: JSON.stringify({ code: totp(keys[login]), isRecoveryCode: false, rememberMe: true }) });
    return cookieOf(r2, 'officehub.auth');
  }
  let cookie = cookieOf(r, 'officehub.auth');
  if (r.ok && body?.mustSetupTwoFactor) {
    const post = async (path: string, b: unknown) => {
      const x = await fetch(API + path, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(b) });
      cookie = cookieOf(x, 'officehub.auth') || cookie;
      return { status: x.status, body: await x.json().catch(() => null) as any };
    };
    const s = await post('/api/auth/2fa/setup', {});
    const e = await post('/api/auth/2fa/enable', { code: totp(s.body?.sharedKey ?? '') });
    if (e.status !== 200) throw new Error(`Không bật được 2FA cho ${login}: ${s.status} ${e.status}`);
    keys[login] = s.body.sharedKey;
    writeFileSync(KEYS_FILE, JSON.stringify(keys));
  }
  return cookie;
};
const json = async (cookie: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const PW = 'E2e-Local-2026';
const stamp = Date.now().toString(36).slice(-5);
const map = JSON.parse(readFileSync(new URL('../../shared/office-map.json', import.meta.url), 'utf8'));
const roomOf = (id: string) => map.rooms.find((r: any) => r.id === id);

// ---------- Dữ liệu: 1 người + 2 bot, 3 trạng thái phòng ----------
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
for (const s of (await json(admin, 'GET', '/api/meetings/sessions?active=true')).body ?? []) await json(admin, 'POST', `/api/meetings/sessions/${s.id}/stop`);
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const pos = positions.find((p: any) => p.name === 'Chuyên viên') ?? positions[0];
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `Bảng phòng ${stamp}`, code: `RS${stamp}`.slice(0, 10) })).body;
let seq = 700 + Math.floor(Math.random() * 90);
const mkEmp = async (name: string, user: string) => {
  const code = `NV${seq++}${stamp}`.slice(0, 20);
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: dep, positionId: pos.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, user, cookie: await login(user, PW) };
};
const H = await mkEmp('Người Xem Bảng', `e2e.rs.h.${stamp}`);
const B1 = await mkEmp('Bot Chủ Trì', `e2e.rs.b1.${stamp}`);
const B2 = await mkEmp('Bot Thành Viên', `e2e.rs.b2.${stamp}`);
for (const b of [B1, B2]) await json(admin, 'PUT', `/api/org/employees/${b.e.id}/account/bot`, { isBot: true });

const iso = (ms: number) => new Date(ms).toISOString();
// Chạy lại: admin (HR) huỷ lịch hôm nay còn lại ở 2 phòng bài dùng (lịch của lần chạy trước)
for (const r of (await json(admin, 'GET', '/api/meetings/bookings/now')).body ?? [])
  if (['meeting-large', 'meeting-hall'].includes(r.roomId)) for (const b of [r.current, r.next]) if (b) await json(admin, 'DELETE', `/api/meetings/bookings/${b.id}`);
const now = Date.now();
const cur = await json(H.cookie, 'POST', '/api/meetings/bookings', { roomId: 'meeting-large', title: 'Họp giao ban tuần này rất dài tiêu đề',
  startAt: iso(now - 60_000), endAt: iso(now + 60 * 60_000), attendeeIds: [] });
ok('lịch đang diễn ra ở Phòng họp lớn', cur.status === 200, cur);
const created: string[] = [cur.body?.booking?.id];
// Lịch kế tiếp phải trong hôm nay (giờ VN) — chạy sát nửa đêm thì bỏ trạng thái này
const vnMinutes = (new Date(now).getUTCHours() + 7) % 24 * 60 + new Date(now).getUTCMinutes();
const hasNext = vnMinutes < 23 * 60 + 20;
if (hasNext) {
  const nx = await json(H.cookie, 'POST', '/api/meetings/bookings', { roomId: 'meeting-hall', title: 'Đào tạo nội bộ tiêu đề dài',
    startAt: iso(now + 20 * 60_000), endAt: iso(now + 50 * 60_000), attendeeIds: [] });
  ok('lịch kế tiếp hôm nay ở Hội trường', nx.status === 200, nx);
  created.push(nx.body?.booking?.id);
} else console.log('… sau 23:20 giờ VN: bỏ trạng thái "Trống · kế tiếp" (lịch phải trong hôm nay)');
const open = await json(H.cookie, 'POST', '/api/meetings/sessions', { roomId: 'meeting-small', topic: 'Báo cáo tiến độ dự án gần đây rất dài',
  chairEmployeeId: B1.e.id, botIds: [B1.e.id, B2.e.id] });
ok('mở họp với AI ở Phòng họp nhỏ (2 bot)', open.status === 200 && open.body?.status === 'Active', open);

// ---------- Trình duyệt ----------
const EXPECT: Record<string, { text: RegExp; busy: boolean }> = {
  'meeting-small': { text: /^Đang họp với AI$/, busy: true },
  'meeting-large': { text: /^Đang họp · đến \d\d:\d\d$/, busy: true },
  ...(hasNext ? { 'meeting-hall': { text: /^Trống · \d\d:\d\d kế tiếp$/, busy: false } } : {}),
};
/** Số đo bảng phòng + nhãn / bong bóng avatar trên màn hình (toạ độ px). */
const MEASURE = `(() => {
  const sc = window.__officeScene, cam = sc.camera, W = innerWidth, Hh = innerHeight;
  const toPx = (v) => { const p = v.clone().project(cam); return { x: (p.x + 1) / 2 * W, y: (1 - p.y) / 2 * Hh, z: p.z }; };
  const pxH = (obj) => { const wp = obj.getWorldPosition(obj.position.clone()); const d = wp.distanceTo(cam.position);
    return obj.scale.y / (2 * Math.tan(cam.fov * Math.PI / 360) * d) * Hh; };
  const rect = (obj) => { const wp = obj.getWorldPosition(obj.position.clone()); const c = toPx(wp); const h = pxH(obj), w = h * obj.scale.x / obj.scale.y;
    const cx = obj.center?.x ?? 0.5, cy = obj.center?.y ?? 0.5; // sprite.center: điểm neo trong sprite (bong bóng bot neo dưới đáy, TEST-89)
    return { x0: c.x - w * cx, x1: c.x + w * (1 - cx), y0: c.y - h * (1 - cy), y1: c.y + h * cy, z: c.z, dist: wp.distanceTo(cam.position) }; };
  const signs = [...sc.roomSigns].map(([id, s]) => {
    const img = s.material.map.image, px = img.getContext('2d').getImageData(10, Math.floor(img.height / 2), 1, 1).data; // mép trái giữa chiều cao: nền, không phải chữ / góc bo
    return { id, text: s.name, x: s.position.x, y: s.position.y, z: s.position.z, depthTest: s.material.depthTest, renderOrder: s.renderOrder,
      rgb: [px[0], px[1], px[2], px[3]], rect: rect(s) };
  });
  const people = [...sc.others.values()].map((o) => o.avatar).concat(sc.me ? [sc.me] : []).flatMap((a) =>
    [a.label, a.status].filter(Boolean).filter((l) => l.visible).map((l) => ({ renderOrder: l.renderOrder, depthTest: l.material.depthTest, rect: rect(l) })));
  const bots = [...sc.others.values()].map((o) => o.avatar).filter((a) => a.status && a.label.visible)
    .map((a) => ({ label: rect(a.label), status: rect(a.status), statusH: a.status.scale.y, labelH: a.label.scale.y }));
  return { signs, people, bots, me: sc.snapshot().me, others: sc.snapshot().others.length, W, H: Hh };
})()`;
const onScreen = (r: any, W: number, H: number) => r.z < 1 && r.x1 > 0 && r.x0 < W && r.y1 > 0 && r.y0 < H;
const overlap = (a: any, b: any) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const table: string[] = [];

const view = async (label: string, width: number, height: number, mobile: boolean, port: number) => {
  const p = await launch(port, `${tmpdir()}/room-sign-${label}-${stamp}`, width, height);
  if (mobile) await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
  const st = await p.login(H.user, PW);
  ok(`${label}: đăng nhập trình duyệt`, st === 200, st);
  await p.evalJs(`localStorage.setItem('officehub.avatar.prompt-dismissed', '1')`); // bỏ lời nhắc tạo nhân vật (che giữa màn hình)
  await p.go(`${BASE}/office`, 6000);
  for (let i = 0; i < 40 && !(await p.evalJs(`!!window.__officeScene?.snapshot().me`)); i++) await p.sleep(500);
  // đợi đủ bảng + 2 bot đi tới phòng họp nhỏ
  const small = roomOf('meeting-small');
  for (let i = 0; i < 60; i++) {
    const m = await p.evalJs(MEASURE);
    const inRoom = (await p.evalJs(`window.__officeScene.snapshot().others`) as any[]).filter((o) => o.x > small.x0 && o.x < small.x1 && o.z > small.z0 && o.z < small.z1).length;
    if (m.signs.length >= Object.keys(EXPECT).length && inRoom >= 2) break;
    await p.sleep(1000);
  }
  // đóng bảng hướng dẫn (che góc trái trên)
  await p.evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Đã hiểu')?.click()`);
  const m0 = await p.evalJs(MEASURE);
  for (const [id, exp] of Object.entries(EXPECT)) {
    const s = m0.signs.find((x: any) => x.id === id), r = roomOf(id), d = r.doors[0];
    ok(`${label}: ${id} chữ "${s?.text}" đúng mẫu, ≤ 24 ký tự`, !!s && exp.text.test(s.text) && s.text.length <= 24, s);
    const red = s && s.rgb[3] > 150 && s.rgb[0] > 150 && s.rgb[1] < 90, gray = s && s.rgb[3] > 150 && Math.abs(s.rgb[0] - s.rgb[2]) < 40 && s.rgb[0] > 40 && s.rgb[0] < 160;
    ok(`${label}: ${id} màu ${exp.busy ? 'đỏ' : 'xám'}`, exp.busy ? !!red : !!gray, s?.rgb);
    const doorX = r.x0 + d.at + d.w / 2;
    ok(`${label}: ${id} treo ngay trên cửa (tâm cửa x=${doorX}, ngoài cạnh nam, cao 2,5)`, !!s && Math.abs(s.x - doorX) < 0.01 && s.z > r.z1 && s.z - r.z1 < 0.3 && s.y === 2.5, s);
    ok(`${label}: ${id} vẽ có depthTest, renderOrder < nhãn tên / bong bóng`, !!s && s.depthTest === true && m0.people.every((l: any) => s.renderOrder < l.renderOrder), s);
  }
  // bot đi vào phòng hiện "🚶 …" — đợi tới ghế, bong bóng đổi sang bong bóng họp
  for (let i = 0; i < 30 && !(await p.evalJs(`[...window.__officeScene.others.values()].filter(o=>/^(🎤|👥)/.test(o.avatar.statusText ?? '')).length >= 2`)); i++) await p.sleep(1000);
  const bubbles: string[] = await p.evalJs(`[...window.__officeScene.others.values()].filter(o=>o.avatar.status).map(o=>o.avatar.statusText)`);
  ok(`${label}: 2 bot trong Phòng họp nhỏ có bong bóng họp`, bubbles.length >= 2, bubbles);
  // TEST-89: bong bóng họp ngắn, không ghi chủ đề (chủ đề ở thanh "Họp với AI")
  // (bot của lần chạy trước có thể đang "🚶 bàn …" về chỗ — chỉ xét bong bóng họp)
  const inMeeting = bubbles.filter((t) => /^(🎤|👥)/.test(t));
  ok(`${label}: bong bóng họp chỉ "🎤 Đang phát biểu" / "👥 Đang họp"`, inMeeting.length >= 2 && inMeeting.includes('👥 Đang họp')
    && inMeeting.every((t) => /^(🎤 Đang phát biểu|👥 Đang họp)$/.test(t)), bubbles);

  const spots: [string, number, number][] = [['ngoai', 32.5, 10], ['trong', 32.5, 3.5]];
  for (const [where, x, z] of spots) {
    await p.evalJs(`window.__officeScene.walkTo(${x}, ${z})`);
    for (let i = 0; i < 30; i++) {
      const me = await p.evalJs(`window.__officeScene.snapshot().me`);
      if (Math.hypot(me.x - x, me.z - z) < 0.3) break;
      await p.sleep(500);
    }
    for (const [zoomName, dist] of [['thuong', 17], ['gan', 8], ['xa', 40]] as const) {
      await p.evalJs(`window.__officeScene.distance = ${dist}`);
      for (let step = 0; step < 4; step++) {
        await p.sleep(1600);
        const m = await p.evalJs(MEASURE);
        const tag = `${label}-${where}-${zoomName}-${step * 90}`;
        await p.shot(`${SHOTS}/${tag}.png`);
        const parts: string[] = [];
        for (const s of m.signs.filter((s: any) => s.id in EXPECT)) {
          const vis = onScreen(s.rect, m.W, m.H);
          const hits = m.people.filter((l: any) => onScreen(l.rect, m.W, m.H) && overlap(l.rect, s.rect));
          parts.push(`${s.id}:${vis ? Math.round(s.rect.y1 - s.rect.y0) + 'px' : 'ngoài khung'}${hits.length ? ` chồng ${hits.length} nhãn` : ''}`);
        }
        // TEST-89: bong bóng bot (cao 0,17) không chồng lên bong bóng bot khác, không che nhãn tên của chính bot (sai số 1 px)
        const shrink = (r: any) => ({ ...r, x0: r.x0 + 1, x1: r.x1 - 1, y0: r.y0 + 1, y1: r.y1 - 1 });
        const vb = m.bots.filter((b: any) => onScreen(b.status, m.W, m.H));
        let bb = 0, bl = 0, own = 0;
        for (const [i, a] of vb.entries()) {
          if (overlap(shrink(a.status), shrink(a.label))) own++;
          for (const b of vb.slice(i + 1)) {
            if (overlap(shrink(a.status), shrink(b.status))) bb++;
            if (overlap(shrink(a.status), shrink(b.label)) || overlap(shrink(b.status), shrink(a.label))) bl++;
          }
        }
        parts.push(`bot: ${vb.length} bóng ${vb.length ? Math.round(vb[0].status.y1 - vb[0].status.y0) + 'px' : ''}${bb ? ` · ${bb} cặp bóng chồng` : ''}${bl ? ` · ${bl} bóng che nhãn bot khác` : ''}${own ? ` · ${own} bóng che nhãn mình` : ''}`);
        if (vb.length) ok(`${tag}: bong bóng bot không che nhãn tên của chính bot, không chồng bong bóng bot khác`, own === 0 && bb === 0, m.bots);
        table.push(`${tag}: ${parts.join(' · ')}`);
        // Bảng phòng họp nhỏ (phòng đang đứng / cạnh đó) khi thấy được phải đọc được: cao ≥ 9 px
        const s = m.signs.find((x: any) => x.id === 'meeting-small');
        if (s && onScreen(s.rect, m.W, m.H) && zoomName !== 'xa') ok(`${tag}: bảng Phòng họp nhỏ cao ≥ 9 px`, s.rect.y1 - s.rect.y0 >= 9, s.rect);
        await p.evalJs(`window.__officeScene.rotateCamera(1)`);
      }
    }
  }
  await p.evalJs(`window.__officeScene.distance = 17`);
  ok(`${label}: không lỗi console`, p.errors.filter((e) => !/livekit|voice|WebSocket|favicon|ERR_CONNECTION/i.test(e)).length === 0, p.errors);
  p.close();
};
await view('maytinh', 1440, 900, false, 9361);
await view('dienthoai', 390, 844, true, 9362);

await json(H.cookie, 'POST', `/api/meetings/sessions/${open.body?.id}/stop`);
for (const id of created.filter(Boolean)) await json(H.cookie, 'DELETE', `/api/meetings/bookings/${id}`);
console.log('\nSố đo bảng (chiều cao trên màn hình; "chồng N nhãn" = khung bảng giao khung nhãn / bong bóng — nhãn vẽ đè lên bảng):');
for (const l of table) console.log('  ' + l);
console.log(`\nẢnh: ${SHOTS}\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
