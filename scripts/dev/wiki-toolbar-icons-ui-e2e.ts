// E2E TEST-231: hàng "TRANG (N)" ở cột trang tab Sổ tay — hai nút "Chia sẻ" / "Trang mới" chỉ còn icon (vuông 28px) + tooltip + aria-label, cột trang
// không cuộn ngang khi tiêu đề trang rất dài (tiêu đề cắt truncate), hai nút nằm gọn trong cột; sổ tay đầy (500 trang) → "Trang mới" mờ, tooltip
// "Sổ tay tối đa 500 trang". 1440 + 1280, sáng + tối, điện thoại 390×844. TẠO DỮ LIỆU THẬT (≈ 500 trang) → CHỈ DB tạm (không cần S3 / Realtime / Mcp).
// Api như đầu wiki-share-scope-e2e.ts, Vite trỏ Api:
//   VITE_API_TARGET=http://localhost:5231 bunx vite --port 5331 --strictPort   (trong frontend/)
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5231 BASE_URL=http://localhost:5331 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/wiki-toolbar-icons-ui-e2e.ts
// Ảnh chụp vào SHOTS_DIR (mặc định %TEMP%/wiki-toolbar-icons-ui).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BASE, launch } from './cdp';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5231';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const SHOTS = process.env.SHOTS_DIR ?? `${tmpdir()}/wiki-toolbar-icons-ui`;
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
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

// ── Dữ liệu: PM; dự án P (tiêu đề rất dài, 3 cấp) + dự án F (sổ tay đầy) ──
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV WTI ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Wiki icons UI ${stamp}`, code: `WI${stamp}` })).body;
const user = `e2e.wti.pm.${stamp}`;
const emp = (await json(admin, 'POST', '/api/org/employees', { code: `WT${stamp}`.toUpperCase(), fullName: 'Quản Lý Sổ Tay', email: `${user}@e2e.test`, phone: null,
  dateOfBirth: null, departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
const acc = (await json(admin, 'POST', `/api/org/employees/${emp.id}/account`, { mode: 'password', roles: ['employee', 'manager'], userName: user })).body;
await json(await login(user, acc.tempPassword), 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
const pm = await login(user, PW);
const mkProject = async (code: string, name: string) => {
  const r = await json(pm, 'POST', '/api/projects', { code: code.toUpperCase(), name, kind: 'Internal', startOn: today, sequential: false, memberIds: [] });
  return (r.body?.id ?? r.body) as string;
};
const P = await mkProject(`WT${stamp}`, 'Dự án Sổ Tay Dài');
const F = await mkProject(`WF${stamp}`, 'Dự án Sổ Tay Đầy');
const mk = async (proj: string, title: string, parentId?: string) =>
  (await json(pm, 'POST', `/api/projects/${proj}/wiki/pages`, { title, parentId, content: `Nội dung **${title}**.` })).body?.id as string;
const LONG = 'Quy trình triển khai và vận hành hệ thống chấm công tự động cho toàn bộ chi nhánh miền Bắc giai đoạn hai năm hai nghìn hai mươi bảy';
const R1 = await mk(P, 'Tổng quan');
const R1a = await mk(P, LONG, R1);
const R1a1 = await mk(P, 'Trang_cháu_không_có_dấu_cách_nào_để_xuống_dòng_rất_rất_rất_dài_ABCDEFGHIJKLMNOPQRSTUVWXYZ', R1a);
const R2 = await mk(P, 'Phụ lục');
ok('dữ liệu: dự án có trang tiêu đề rất dài (3 cấp)', [R1, R1a, R1a1, R2].every(Boolean));
const MAX = (await json(pm, 'GET', `/api/projects/${F}/wiki`)).body?.maxPages as number;
let made = 0;
for (let i = 0; i < MAX; i += 25) {
  const ids = await Promise.all(Array.from({ length: Math.min(25, MAX - i) }, (_, k) => mk(F, `Trang ${i + k + 1}`)));
  made += ids.filter(Boolean).length;
}
const over = await json(pm, 'POST', `/api/projects/${F}/wiki/pages`, { title: 'Thừa', content: 'x' });
ok(`dữ liệu: sổ tay đầy ${made}/${MAX} trang, tạo thêm bị chặn`, !!MAX && made === MAX && over.status >= 400, { made, MAX, over: over.status });
// Tạo ~500 trang ăn gần hết trần 600 yêu cầu / phút / người dùng (cookie) → chờ hết cửa sổ rồi mới mở trình duyệt, kẻo UI gặp 429
await new Promise((r) => setTimeout(r, 61_000));

const q = (id: string) => `document.querySelector('[data-testid="${id}"]')`;
const br = await launch(9631, `${tmpdir()}/wiki-icons-${stamp}`);
const waitFor = async (expr: string, ms = 8000) => { for (let t = 0; t < ms; t += 250) { if (await br.evalJs(`!!(${expr})`)) return true; await br.sleep(250); } return false; };
const center = (expr: string) => br.evalJs(`(() => { const e = ${expr}; if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`) as Promise<{ x: number; y: number } | null>;
// Radix Tooltip: chỉ mouseMoved (bấm trigger làm tooltip đóng)
const hover = async (expr: string) => {
  const c = await center(expr);
  if (!c) throw new Error('không thấy ' + expr);
  await br.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, pointerType: 'mouse' });
  await br.sleep(300);
  for (let k = 0; k < 3; k++) await br.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x + k, y: c.y, pointerType: 'mouse' });
  await br.sleep(700);
};
const tipText = () => br.evalJs(`[...document.querySelectorAll('[data-slot="tooltip-content"]')].map((e) => e.textContent.trim()).join('|')`) as Promise<string>;
const setTheme = async (t: 'light' | 'dark', url: string) => {
  await br.evalJs(`localStorage.setItem('officehub:theme', '${t}')`);
  await br.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: t }] });
  await br.go(url, 3000);
};
const size = (w: number, h: number, m = false) => br.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: m ? 2 : 1, mobile: m });
// Đo cột trang: không tràn ngang; hai nút vuông có aria-label, không có chữ, nằm trong cột
const layout = () => br.evalJs(`(() => {
  const a = document.querySelector('[data-testid="project-wiki"] aside'); if (!a) return null;
  const ar = a.getBoundingClientRect();
  const btn = (id) => { const b = document.querySelector('[data-testid="' + id + '"]'); if (!b) return null; const r = b.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), text: b.innerText.trim(), label: b.getAttribute('aria-label'), disabled: b.disabled,
      inside: r.left >= ar.left - 0.5 && r.right <= ar.right + 0.5, visible: r.width > 0 && !!b.offsetParent }; };
  const items = [...a.querySelectorAll('[data-testid="wiki-tree-item"]')].filter((e) => e.offsetParent);
  return { hScroll: a.scrollWidth > a.clientWidth + 1, pageHScroll: document.documentElement.scrollWidth > window.innerWidth + 1, asideW: Math.round(ar.width),
    share: btn('wiki-share-all'), add: btn('wiki-new'), items: items.length, truncated: items.some((e) => e.scrollWidth > e.clientWidth + 1),
    itemsInside: items.every((e) => e.getBoundingClientRect().right <= ar.right + 0.5) };
})()`) as Promise<any>;
const URL_P = `${BASE}/projects/${P}?tab=wiki&page=${R1a1}`;
const URL_F = `${BASE}/projects/${F}?tab=wiki`;
const goodBtn = (b: any, label: string) => !!b && b.visible && b.inside && b.w === 28 && b.h === 28 && b.text === '' && b.label === label;

try {
  ok('PM đăng nhập UI', (await br.login(user, PW)) === 200);
  for (const w of [1440, 1280]) for (const t of ['light', 'dark'] as const) {
    await size(w, 900);
    await setTheme(t, URL_P);
    if (!(await waitFor(q('wiki-new'), 15000))) await br.shot(`${SHOTS}/${w}-${t}-not-loaded.png`);
    const L = await layout();
    ok(`${w} ${t}: cột trang không cuộn ngang, tiêu đề dài bị cắt, cây nằm trong cột`, !!L && !L.hScroll && !L.pageHScroll && L.truncated && L.itemsInside, L);
    ok(`${w} ${t}: hai nút icon 28×28 không chữ, có aria-label, nằm trong cột`, goodBtn(L?.share, 'Chia sẻ sổ tay cho khách') && goodBtn(L?.add, 'Trang mới') && !L.add.disabled, L);
    await hover(q('wiki-share-all'));
    ok(`${w} ${t}: rê "Chia sẻ" → tooltip "Chia sẻ sổ tay cho khách"`, (await tipText()) === 'Chia sẻ sổ tay cho khách', await tipText());
    await hover(q('wiki-new'));
    ok(`${w} ${t}: rê "Trang mới" → tooltip "Trang mới"`, (await tipText()) === 'Trang mới', await tipText());
    await br.shot(`${SHOTS}/${w}-${t}-long-titles-tooltip.png`);
  }
  // Bấm nút icon vẫn chạy như cũ
  await size(1440, 900);
  await setTheme('light', URL_P);
  await waitFor(q('wiki-new'));
  await br.evalJs(`${q('wiki-new')}.click()`); await br.sleep(800);
  ok('bấm icon Trang mới → ô soạn trang mới', await br.evalJs(`!!document.querySelector('[data-testid="project-wiki"] textarea')`));
  await br.go(URL_P, 2500);
  await br.evalJs(`${q('wiki-share-all')}.click()`); await br.sleep(800);
  ok('bấm icon Chia sẻ → hộp thoại chia sẻ', await waitFor(q('wiki-share-form')));

  // Sổ tay đầy
  for (const t of ['light', 'dark'] as const) {
    await setTheme(t, URL_F);
    await waitFor(q('wiki-new'), 15000);
    const L = await layout();
    ok(`đầy ${t}: nút Trang mới mờ (disabled), aria-label nói tối đa ${MAX} trang`, !!L?.add && L.add.disabled && L.add.label === `Trang mới — sổ tay tối đa ${MAX} trang`
      && await br.evalJs(`Number(getComputedStyle(${q('wiki-new')}).opacity) < 1`) && !L.hScroll, L);
    await hover(q('wiki-new-wrap'));
    ok(`đầy ${t}: rê nút → tooltip "Sổ tay tối đa ${MAX} trang"`, (await tipText()) === `Sổ tay tối đa ${MAX} trang`, await tipText());
    await br.shot(`${SHOTS}/full-${t}-tooltip.png`);
  }

  // Điện thoại
  await size(390, 844, true);
  for (const t of ['light', 'dark'] as const) {
    await setTheme(t, URL_P);
    await waitFor(q('wiki-new'));
    const L = await layout();
    ok(`điện thoại ${t}: hàng nút gọn (2 icon 28×28 trong cột), trang không tràn ngang`,
      !!L && !L.hScroll && !L.pageHScroll && goodBtn(L.share, 'Chia sẻ sổ tay cho khách') && goodBtn(L.add, 'Trang mới'), L);
    await br.evalJs(`${q('wiki-tree-toggle')}.click()`); await br.sleep(500);
    const L2 = await layout();
    ok(`điện thoại ${t}: mở cây trang → tiêu đề dài cắt, không tràn`, !!L2 && L2.items > 0 && !L2.hScroll && !L2.pageHScroll && L2.itemsInside && L2.truncated, L2);
    await br.shot(`${SHOTS}/mobile-${t}.png`);
  }
  const errs = br.errors.filter((e) => !/negotiation|hub\/|SignalR|WebSocket|status of 4/i.test(e ?? ''));
  ok('không có lỗi JS', errs.length === 0, errs);
} catch (e) {
  await br.shot(`${SHOTS}/error.png`).catch(() => {});
  ok('lỗi: ' + String(e).slice(0, 400) + ' @ ' + await br.evalJs('location.href + " " + document.body.innerText.slice(0, 200)').catch(() => ''), false);
} finally {
  br.close();
}
console.log(`\n${pass} đạt, ${fail} lỗi — ảnh: ${SHOTS}`);
process.exit(fail ? 1 : 0);
