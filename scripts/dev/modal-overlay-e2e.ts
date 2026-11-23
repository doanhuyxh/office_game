// E2E TEST-226 lớp phủ modal dùng chung (components/common/modal-overlay.ts + `.modal-overlay` trong global.css):
// Dialog (Thêm nhân viên, chi tiết việc), Sheet (chi tiết thiết bị), confirmDialog (xoá chức vụ), confirmDialog mở trên Dialog (Xoá việc — lồng nhau);
// sáng + tối: nền --overlay theo theme + blur 4px; lớp phủ lồng nhau chỉ --overlay-nested, không blur; bấm được ô nhập trong modal, Esc / Huỷ đóng;
// toast (sonner) z-index trên lớp phủ; điện thoại 375px (hộp xác nhận); văn phòng 3D: modal "Tạo nhân vật" không blur + đo fps rAF / ms mỗi khung
// (không modal · modal không blur · modal ép blur). Ảnh vào SHOTS_DIR.
// TẠO DỮ LIỆU THẬT → CHỈ DB tạm. Dựng (Git Bash, từ gốc repo), không cần Mcp:
//   docker run -d --name e2e226-pg -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=e2e -p 127.0.0.1:15526:5432 postgres:17-alpine
//   Api như đầu task-column-guide-e2e.ts (ASPNETCORE_URLS=http://localhost:5426, DB cổng 15526, Seed__AdminEmail / Seed__AdminPassword = ADMIN_LOGIN / ADMIN_PASSWORD)
//   Realtime (backend/): env ASPNETCORE_URLS=http://localhost:5427 Realtime__ApiBaseUrl=http://localhost:5426 Chat__InternalKey=<cùng Api>
//     dotnet run --project src/OfficeHub.Realtime --no-launch-profile
//   VITE_API_TARGET=http://localhost:5426 VITE_RT_TARGET=http://localhost:5427 bunx vite --port 5226   (trong frontend/)
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5426 BASE_URL=http://localhost:5226 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/modal-overlay-e2e.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BASE, launch } from './cdp';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5426';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const SHOTS = process.env.SHOTS_DIR ?? `${tmpdir()}/modal-overlay`;
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
const stamp = Date.now().toString(36).slice(-5);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

// ── Dữ liệu: chức vụ (để xoá → confirmDialog), dự án + việc (Dialog chi tiết + xoá lồng nhau), thiết bị (Sheet) ──
const root = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
ok('đăng nhập admin', !!root);
// Tài khoản HR có hồ sơ nhân viên (admin seed không có hồ sơ → không tạo được dự án / vào văn phòng 3D)
const PW = 'E2e-Local-2026';
const posId = (await json(root, 'POST', '/api/org/positions', { name: `NV MO ${stamp}`, level: 5, financePermissions: 0 })).body;
const deptId = (await json(root, 'POST', '/api/org/departments', { name: `Lớp phủ ${stamp}`, code: `MO${stamp}` })).body;
const user = `e2e.mo.hr.${stamp}`;
const emp = (await json(root, 'POST', '/api/org/employees', { code: `MO${stamp}`.toUpperCase(), fullName: 'Kiểm Thử Lớp Phủ', email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
  departmentId: deptId, positionId: posId, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
const acc = (await json(root, 'POST', `/api/org/employees/${emp.id}/account`, { mode: 'password', roles: ['employee', 'hr', 'manager'], userName: user })).body;
await json(await login(user, acc.tempPassword), 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
const admin = await login(user, PW);
ok('tài khoản HR có hồ sơ', !!admin);
await json(admin, 'POST', '/api/org/positions', { name: `Chức vụ thử ${stamp}`, level: 7, financePermissions: 0 });
const proj = await json(admin, 'POST', '/api/projects', { code: `MO${stamp}`, name: 'Thử lớp phủ modal', kind: 'Internal', startOn: today, memberIds: [emp.id], departmentIds: [], sequential: false });
if (proj.status >= 300) throw new Error(`Tạo dự án lỗi ${proj.status}: ${JSON.stringify(proj.body)}`);
const P = proj.body as string;
const cols: any[] = (await json(admin, 'GET', `/api/projects/${P}`)).body.columns;
const T = (await json(admin, 'POST', `/api/projects/${P}/tasks`, { title: 'Việc thử lớp phủ', columnId: cols[0].id })).body as string;
ok('dữ liệu: dự án + việc', typeof P === 'string' && typeof T === 'string', { P, T });
const cats = (await json(admin, 'GET', '/api/assets/categories')).body as any[];
const dev = await json(admin, 'POST', '/api/assets/devices', { categoryId: cats[0].id, name: 'MacBook thử lớp phủ', brand: 'Apple', model: 'M3', serialNumber: `SN-MO-${stamp}`, purchaseDate: '2026-01-10', purchasePrice: 30000000, note: null });
ok('dữ liệu: thiết bị', dev.status === 200, dev);

const br = await launch(9226, `${tmpdir()}/modal-overlay-${stamp}`);
// Dùng đúng cookie của API (đăng nhập lại trên UI sẽ thu hồi phiên này)
await br.send('Network.enable');
await br.send('Network.setCookie', { name: 'officehub.auth', value: admin.split('=').slice(1).join('='), url: BASE, httpOnly: true });
const q = (sel: string) => `document.querySelector(${JSON.stringify(sel)})`;
const clickAt = async (expr: string) => {
  const r = await br.evalJs(`(() => { const e = ${expr}; if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  if (!r) throw new Error(`Không thấy phần tử: ${expr}`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'] as const)
    await br.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  await br.sleep(500);
};
const byText = (sel: string, text: string, scope = 'document') => `[...${scope}.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.innerText.trim().includes(${JSON.stringify(text)}))`;
const esc = async () => {
  await br.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await br.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await br.sleep(500);
};
/** Kiểu tính toán của các lớp phủ đang mở: [{ bg, blur }] theo thứ tự DOM. */
const overlays = () => br.evalJs(`[...document.querySelectorAll('.modal-overlay[data-state="open"]')].map((o) => { const s = getComputedStyle(o); return { bg: s.backgroundColor, blur: s.backdropFilter }; })`) as Promise<{ bg: string; blur: string }[]>;
const setTheme = async (t: 'light' | 'dark') => {
  await br.evalJs(`localStorage.setItem('officehub:theme', '${t}')`);
};
const open = (n: number) => br.evalJs(`document.querySelectorAll('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]').length`).then((x) => x === n);

try {
  let ov: { bg: string; blur: string }[] = [];
  await br.go(`${BASE}/`, 2500);
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(theme);
    const tag = theme === 'light' ? 'sang' : 'toi';
    // 1. Dialog thường: Thêm nhân viên
    await br.go(`${BASE}/employees`, 3500);
    ok(`${theme}: html.dark đúng theme`, (await br.evalJs(`document.documentElement.classList.contains('dark')`)) === (theme === 'dark'));
    await clickAt(byText('button', 'Thêm nhân viên'));
    ov = await overlays();
    ok(`${theme}: Dialog Thêm nhân viên — 1 lớp phủ, có màu, blur 4px`, ov.length === 1 && ov[0].bg !== 'rgba(0, 0, 0, 0)' && ov[0].blur.includes('blur(4px)'), ov);
    await br.shot(`${SHOTS}/1-dialog-${tag}.png`);
    // Lớp phủ không chặn thao tác trong modal: bấm vào ô nhập đầu tiên → focus
    await clickAt(`document.querySelector('[role="dialog"] input')`);
    ok(`${theme}: bấm được ô nhập trong Dialog`, await br.evalJs(`document.activeElement?.tagName === 'INPUT' && !!document.activeElement.closest('[role="dialog"]')`));
    await esc();
    ok(`${theme}: Esc đóng Dialog`, await open(0));

    // 2. confirmDialog trên trang: xoá chức vụ
    await br.go(`${BASE}/employees?tab=positions`, 3500);
    await clickAt(`${byText('tr', `Chức vụ thử ${stamp}`)}?.querySelector('[aria-label="Xoá"]')`);
    ov = await overlays();
    ok(`${theme}: confirmDialog — 1 lớp phủ blur`, ov.length === 1 && ov[0].blur.includes('blur(4px)'), ov);
    await br.shot(`${SHOTS}/2-confirm-${tag}.png`);
    await clickAt(byText('[role="alertdialog"] button', 'Huỷ'));
    ok(`${theme}: Huỷ đóng hộp xác nhận`, await open(0));

    // 3. Dialog chi tiết việc + 4. confirmDialog lồng nhau (Xoá việc)
    await br.go(`${BASE}/projects/${P}?tab=tasks&task=${T}`, 4000);
    ok(`${theme}: mở Dialog chi tiết việc`, await open(1));
    await clickAt(byText('[role="dialog"] button', 'Xoá'));
    ov = await overlays();
    ok(`${theme}: lồng nhau — 2 lớp phủ, lớp sau nhạt hơn + không blur`, ov.length === 2 && ov[0].blur.includes('blur(4px)') && ov[1].blur === 'none' && ov[0].bg !== ov[1].bg, ov);
    await br.shot(`${SHOTS}/3-nested-${tag}.png`);
    await esc();
    ok(`${theme}: Esc đóng hộp xác nhận, Dialog chi tiết vẫn mở`, await open(1));
    await esc();

    // 5. Sheet: chi tiết thiết bị
    await br.go(`${BASE}/assets?tab=devices`, 3500);
    await clickAt(q('[data-testid="device-row"]'));
    ov = await overlays();
    ok(`${theme}: Sheet thiết bị — 1 lớp phủ blur`, ov.length === 1 && ov[0].blur.includes('blur(4px)'), ov);
    await br.shot(`${SHOTS}/4-sheet-${tag}.png`);
    await esc();
  }

  // Toast (sonner) nằm trên lớp phủ: xác nhận Xoá việc (hộp giữ mở + loading) → toast "Đã xoá"; z-index của toaster > 50 của lớp phủ
  await br.go(`${BASE}/projects/${P}?tab=tasks&task=${T}`, 4000);
  await clickAt(byText('[role="dialog"] button', 'Xoá'));
  await clickAt(byText('[role="alertdialog"] button', 'Xoá'));
  await br.sleep(300);
  const z = await br.evalJs(`(() => { const t = document.querySelector('[data-sonner-toaster]'); return t ? Number(getComputedStyle(t).zIndex) : null; })()`);
  ok('toast (sonner) nằm trên lớp phủ: z-index > 50', z !== null && z > 50, z);

  // 6. Điện thoại 375px: menu (Sheet) + Dialog, sáng + tối
  await br.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 760, deviceScaleFactor: 2, mobile: true });
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(theme);
    await br.go(`${BASE}/employees?tab=positions`, 3500);
    await clickAt(`${byText('tr', `Chức vụ thử ${stamp}`)}?.querySelector('[aria-label="Xoá"]')`);
    await br.shot(`${SHOTS}/5-mobile-confirm-${theme === 'light' ? 'sang' : 'toi'}.png`);
    ok(`375px ${theme}: hộp xác nhận có lớp phủ blur`, (await overlays())[0]?.blur.includes('blur(4px)') === true);
    await esc();
  }
  await br.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // 7. Văn phòng 3D: modal không blur + số khung hình
  await setTheme('dark');
  await br.go(`${BASE}/office`, 8000);
  // Số khung hình: rAF đếm trong 3 s + ms / khung của ô FPS trong HUD (TEST-176, engine tự đo) — lấy trung bình 6 lần đọc
  const meter = async () => {
    const fps = br.evalJs(`new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 3000 ? requestAnimationFrame(f) : r(Math.round(n / ((performance.now() - t0) / 1000))); }; requestAnimationFrame(f); })`) as Promise<number>;
    const ms: number[] = [];
    for (let i = 0; i < 6; i++) {
      await br.sleep(500);
      const t = await br.evalJs(`[...document.querySelectorAll('.office-root [title*="ms / khung"]')].map((e) => e.getAttribute('title'))[0] ?? ''`) as string;
      const m = /([\d.]+) ms/.exec(t); if (m) ms.push(+m[1]);
    }
    return { fps: await fps, ms: ms.length ? +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(1) : null };
  };
  const base = await meter();
  await clickAt(`${byText('button', 'Tạo nhân vật')} ?? ${q('[data-testid="office-avatar"]')}`);
  await br.sleep(1000);
  ov = await overlays();
  ok('/office: modal có lớp phủ, không blur', ov.length === 1 && ov[0].blur === 'none', ov);
  const noBlur = await meter();
  await br.shot(`${SHOTS}/6-office.png`);
  await br.evalJs(`(() => { const s = document.createElement('style'); s.id = 'force-blur'; s.textContent = '.modal-overlay { backdrop-filter: blur(4px) !important; }'; document.head.append(s); })()`);
  const blur = await meter();
  await br.shot(`${SHOTS}/6-office-ep-blur.png`);
  await br.evalJs(`document.getElementById('force-blur')?.remove()`);
  console.log(`Khung hình /office (fps rAF · ms / khung): không modal ${base.fps} · ${base.ms} | modal không blur ${noBlur.fps} · ${noBlur.ms} | modal ép blur ${blur.fps} · ${blur.ms}`);
  ok('/office: đo được khung hình', base.fps > 0 && noBlur.fps > 0 && blur.fps > 0);
  const realErrors = br.errors.filter((e) => !/livekit|voice|negotiation|connection/i.test(e));
  ok('không lỗi console (trừ voice LiveKit không có ở môi trường tạm)', realErrors.length === 0, realErrors);
} catch (e) {
  fail++;
  console.log('✘ lỗi:', e);
  await br.shot(`${SHOTS}/error.png`).catch(() => {});
} finally {
  br.close();
}
console.log(`\n${pass} pass, ${fail} fail — ảnh: ${SHOTS}`);
process.exit(fail ? 1 : 0);
