// E2E: tài liệu trong văn phòng 3D — nút "📁 Tài liệu" trên HUD, bấm E ở tủ hồ sơ (kho phòng ban theo khu bản đồ) / kệ thư viện / bảng tin,
// chiếu tài liệu lên màn hình phòng họp: người chiếu (A) chọn tài liệu → người cùng phòng (B, phòng ban khác, không có quyền kho của A)
// thấy qua link tạm của A; người ngoài phòng không nhận; ai trong phòng cũng tắt được; ra khỏi phòng thì khung chiếu biến mất.
// TẠO NHÂN VIÊN THẬT → CHỈ chạy trên DB tạm. Cần Api + Realtime (Realtime__ApiBaseUrl trỏ Api tạm) + Vite (proxy /api, /rt):
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 BASE_URL=http://localhost:5174 bun scripts/dev/office-docs-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BASE, launch } from './cdp';
import { totp } from './totp';
if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5180';
const env = Object.fromEntries((await Bun.file(new URL('../../.env', import.meta.url)).text()).split('\n')
  .filter((l) => /^[A-Za-z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 400) : ''}`);
};
const loginApi = async (login: string, password: string) =>
  ((await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password }) }))
    .headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => c.startsWith('officehub.auth=')).at(-1) ?? '');
const json = async (cookie: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const PW = 'E2e-Local-2026';
// Admin bắt buộc 2FA (auth-2fa.md): lần đầu tự bật, lần sau nhập mã; khoá lưu theo cổng Api. ADMIN_LOGIN / ADMIN_PASSWORD ưu tiên hơn .env.
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
const loginAdmin = async (login: string, password: string): Promise<string> => {
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password }) });
  const pick = (x: Response, n: string) => x.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => c.startsWith(n + '=')).at(-1) ?? '';
  const body = await r.json().catch(() => null) as any;
  if (r.status === 403 && body?.title === '2fa_required') {
    const r2 = await fetch(`${API}/api/auth/login/2fa`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: pick(r, 'officehub.2fa') },
      body: JSON.stringify({ code: totp(keys[login]), isRecoveryCode: false, rememberMe: true }) });
    return pick(r2, 'officehub.auth');
  }
  let cookie = pick(r, 'officehub.auth');
  if (r.ok && body?.mustSetupTwoFactor) {
    const post = async (path: string, b: unknown) => {
      const x = await fetch(API + path, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(b) });
      cookie = pick(x, 'officehub.auth') || cookie;
      return (await x.json().catch(() => null)) as any;
    };
    const s2 = await post('/api/auth/2fa/setup', {});
    await post('/api/auth/2fa/enable', { code: totp(s2.sharedKey) });
    keys[login] = s2.sharedKey;
    writeFileSync(KEYS_FILE, JSON.stringify(keys));
  }
  return cookie;
};
const admin = await loginAdmin(process.env.ADMIN_LOGIN ?? env.Seed__AdminEmail, process.env.ADMIN_PASSWORD ?? env.Seed__AdminPassword);
if (!admin) throw new Error('Không đăng nhập được admin seed');

// ---------- Dữ liệu: phòng "Công nghệ ODE" gắn khu dept-kt (tủ hồ sơ kt-cabinet-*), A là trưởng phòng; B ở phòng khác ----------
const pos = (await json(admin, 'GET', '/api/org/positions')).body[0].id;
const mkUser = async (code: string, name: string, dept: string, user: string) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, departmentId: dept, positionId: pos,
    managerId: null, status: 'Active', joinedAt: '2026-01-05' })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await loginApi(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, user, cookie: await loginApi(user, PW) };
};
const deptA = (await json(admin, 'POST', '/api/org/departments', { name: 'Công nghệ ODE', code: 'CNO', mapZone: 'dept-kt' })).body;
const deptB = (await json(admin, 'POST', '/api/org/departments', { name: 'Kinh doanh ODE', code: 'KDO' })).body;
const A = await mkUser('NV990', 'Người Chiếu', deptA, 'e2e.ode.a');
await json(admin, 'PUT', `/api/org/departments/${deptA}`, { name: 'Công nghệ ODE', code: 'CNO', parentId: null, headEmployeeId: A.e.id, mapZone: 'dept-kt' });
const B = await mkUser('NV991', 'Người Xem', deptB, 'e2e.ode.b');
const png = new Uint8Array(await Bun.file(new URL('../../frontend/public/icons/apple-touch-icon.png', import.meta.url)).arrayBuffer());
const t = (await json(A.cookie, 'POST', '/api/documents/uploads', { fileName: 'So do he thong.png', contentType: 'image/png', size: png.byteLength })).body;
await fetch(t.url, { method: 'PUT', headers: { 'Content-Type': t.contentType }, body: png });
const asset = (await json(A.cookie, 'POST', '/api/documents/assets', { ticketId: t.ticketId, spaceKind: 'Department', spaceId: deptA, title: 'Sơ đồ hệ thống ODE' })).body.asset;
ok('chuẩn bị: A có tài liệu ảnh trong kho phòng mình; B không xem được', !!asset?.id && (await json(B.cookie, 'GET', `/api/documents/assets/${asset.id}`)).status === 404);

// ---------- 2 trình duyệt vào văn phòng ----------
const a = await launch(9361, `/tmp/officehub-ode-a-${Date.now()}`, 1440, 900);
const b = await launch(9362, `/tmp/officehub-ode-b-${Date.now()}`, 1440, 900);
const shotDir = process.env.SHOTS;
try {
  for (const [br, u] of [[a, A], [b, B]] as const) {
    await br.login(u.user, PW);
    await br.go(`${BASE}/office`, 4000);
  }
  const online = async (br: typeof a) => br.evalJs(`document.querySelector('.status')?.textContent?.includes('online') ?? false`);
  ok('A, B vào văn phòng', (await online(a)) && (await online(b)));
  const walk = async (br: typeof a, x: number, z: number, check: (p: { x: number; z: number }) => boolean, ms = 30000) => {
    await br.evalJs(`window.__officeScene.walkTo(${x}, ${z})`);
    for (let i = 0; i < ms / 300; i++) {
      const p = await br.evalJs(`(() => { const p = window.__officeScene.myPosition(); return { x: p.x, z: p.z } })()`);
      if (check(p)) { await br.sleep(800); return true; }
      await br.sleep(300);
    }
    return false;
  };
  const text = (br: typeof a, sel: string) => br.evalJs(`document.querySelector('${sel}')?.textContent ?? null`);
  const click = (br: typeof a, sel: string) => br.evalJs(`(() => { const e = document.querySelector('${sel}'); e?.click(); return !!e })()`);
  const pressE = async (br: typeof a) => {
    await br.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'e', code: 'KeyE', text: 'e' });
    await br.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'e', code: 'KeyE' });
    await br.sleep(1500);
  };
  const closeDialog = async (br: typeof a) => { await br.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' }); await br.sleep(600); };

  // ---------- Tủ hồ sơ khu Kế toán cũ (dept-kt) → kho phòng "Công nghệ ODE" ----------
  ok('A đi tới tủ hồ sơ kt-cabinet-2', await walk(a, 36.6, 1.4, (p) => Math.hypot(p.x - 36.6, p.z - 0.35) < 1.7));
  ok('gợi ý "Tủ hồ sơ · bấm E"', String(await text(a, '[data-testid=office-interact-prompt]')).includes('Tủ hồ sơ'), await text(a, '[data-testid=office-interact-prompt]'));
  await pressE(a);
  const cabTitle = await a.evalJs(`document.querySelector('[data-testid=office-docs] h2')?.textContent ?? null`);
  ok('E mở kho phòng ban sở hữu khu đó', String(cabTitle).includes('Công nghệ ODE') && !!(await a.evalJs(`[...document.querySelectorAll('[data-testid=asset-row]')].some(r => r.textContent.includes('Sơ đồ hệ thống ODE'))`)), cabTitle);
  ok('WASD không di chuyển nhân vật khi đang ở hộp thoại', await (async () => {
    const p0 = await a.evalJs(`window.__officeScene.myPosition().x`);
    await a.key('a', 600);
    return Math.abs((await a.evalJs(`window.__officeScene.myPosition().x`)) - p0) < 0.05;
  })());
  await closeDialog(a);
  ok('B (phòng khác) bấm E ở tủ đó → báo không có quyền', await (async () => {
    await walk(b, 36.6, 1.4, (p) => Math.hypot(p.x - 36.6, p.z - 0.35) < 1.7);
    await pressE(b);
    return !(await b.evalJs(`!!document.querySelector('[data-testid=office-docs]')`)) && String(await b.evalJs(`document.body.innerText`)).includes('không có quyền mở tủ hồ sơ');
  })());

  // ---------- Chiếu lên màn hình phòng họp lớn ----------
  const inLarge = (p: { x: number; z: number }) => p.x > 22.3 && p.x < 29.7 && p.z > 0.3 && p.z < 7.7;
  ok('A, B vào phòng họp lớn', (await walk(a, 26, 2, inLarge)) && (await walk(b, 27, 4, inLarge)));
  await a.evalJs(`window.__officeScene.walkTo(26, 1.2)`); await a.sleep(2500);
  ok('gợi ý "Màn hình · bấm E để chiếu"', String(await text(a, '[data-testid=office-interact-prompt]')).includes('Màn hình'));
  await pressE(a);
  ok('E mở hộp thoại chọn tài liệu để chiếu', String(await a.evalJs(`document.querySelector('[data-testid=office-docs] h2')?.textContent`)).includes('Chiếu tài liệu'));
  // chọn kho phòng mình (mặc định), mở tài liệu, bấm "Chiếu lên màn hình phòng"
  await a.sleep(1500);
  await a.evalJs(`[...document.querySelectorAll('[data-testid=asset-row]')].find(r => r.textContent.includes('Sơ đồ hệ thống ODE'))?.click()`);
  await a.sleep(2500);
  ok('nút "Chiếu lên màn hình phòng" trong chi tiết', await click(a, '[data-testid=asset-present]'));
  await a.sleep(2500);
  const bPanel = await text(b, '[data-testid=office-screen-doc]');
  ok('B (cùng phòng, không có quyền kho) thấy tài liệu đang chiếu', String(bPanel).includes('Sơ đồ hệ thống ODE') && String(bPanel).includes('Người Chiếu'), bPanel);
  const src = await b.evalJs(`document.querySelector('[data-testid=office-screen-doc] img')?.getAttribute('src') ?? ''`);
  ok('TEST-30: link chiếu đi qua Realtime (/rt/screens/doc/…), không phát thẳng link S3', String(src).startsWith('/rt/screens/doc/'), src);
  ok('TEST-30: mở link không đăng nhập → 401', (await fetch(`${BASE}${src}`, { redirect: 'manual' })).status === 401);
  ok('TEST-30: đăng nhập nhưng không ở trong phòng (admin) → 404', (await fetch(`${BASE}${src}`, { headers: { cookie: admin }, redirect: 'manual' })).status === 404);
  ok('ảnh chiếu tải được ở máy B', await b.evalJs(`(() => { const i = document.querySelector('[data-testid=office-screen-doc] img'); return !!i && i.complete && i.naturalWidth > 0 })()`));
  ok('A cũng thấy khung chiếu', String(await text(a, '[data-testid=office-screen-doc]')).includes('Sơ đồ hệ thống ODE'));
  if (shotDir) { await b.shot(`${shotDir}/office-screen-b.png`); }

  // B ra ngoài → không còn khung; quay lại → hỏi server, thấy lại
  ok('B ra khỏi phòng → khung chiếu biến mất', (await walk(b, 26, 9.5, (p) => p.z > 8.6)) && !(await b.evalJs(`!!document.querySelector('[data-testid=office-screen-doc]')`)));
  ok('B vào lại → thấy tài liệu đang chiếu (GetScreen)', (await walk(b, 27, 4, inLarge)) && String(await text(b, '[data-testid=office-screen-doc]')).includes('Sơ đồ hệ thống ODE'));
  ok('B tắt chiếu → cả A mất khung', (await click(b, '[data-testid=office-screen-clear]')) && (await a.sleep(1500), !(await a.evalJs(`!!document.querySelector('[data-testid=office-screen-doc]')`))));

  // ---------- Bảng tin + kệ thư viện + nút HUD ----------
  ok('A tới bảng tin (pantry)', await walk(a, 32.2, 24, (p) => Math.hypot(p.x - 32.85, p.z - 24) < 1.7, 45000));
  ok('gợi ý "Bảng tin"', String(await text(a, '[data-testid=office-interact-prompt]')).includes('Bảng tin'));
  await pressE(a);
  ok('E mở bảng tin tài liệu mới ban hành', String(await a.evalJs(`document.querySelector('[data-testid=office-docs] h2')?.textContent`)).includes('Bảng tin'));
  await closeDialog(a);
  ok('A tới kệ thư viện', await walk(a, 35, 21, (p) => Math.hypot(p.x - 35, p.z - 21.75) < 1.7, 30000));
  ok('gợi ý "Thư viện"', String(await text(a, '[data-testid=office-interact-prompt]')).includes('Thư viện'));
  await pressE(a);
  ok('E mở kho chung công ty', String(await a.evalJs(`document.querySelector('[data-testid=office-docs] h2')?.textContent`)).includes('Kho chung'));
  await closeDialog(a);
  ok('nút "📁 Tài liệu" trên HUD mở kho', (await click(a, '[data-testid=office-docs-open]')) && (await a.sleep(1200), !!(await a.evalJs(`!!document.querySelector('[data-testid=office-docs]')`))));
  if (shotDir) await a.shot(`${shotDir}/office-docs-dialog.png`);
  ok('không lỗi console', ![...a.errors, ...b.errors].some((e) => !/livekit|voice|WebSocket|getUserMedia|AudioContext|net::ERR/i.test(String(e))), [...a.errors, ...b.errors]);
} finally {
  a.close();
  b.close();
  await json(admin, 'POST', `/api/documents/admin/assets/${asset?.id}/destroy`, { reason: 'Dọn E2E' }); // xoá file S3
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
