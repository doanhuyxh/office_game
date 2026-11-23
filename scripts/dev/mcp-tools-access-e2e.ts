// E2E TEST-219: trang "Công cụ AI (MCP)" (/mcp-tools) mở cho mọi nhân viên (Chrome headless).
// Nhân viên thường: menu nhóm "Chung" có mục ngay dưới "Kết nối AI", mở /mcp-tools được (không "Không có quyền"), tìm kiếm chạy,
// link "Xem các công cụ AI đang có" ở tab Của tôi của /ai-access dẫn đúng trang; admin: mục không còn ở nhóm "Quản trị", trang vẫn như cũ;
// 375px không tràn ngang. Không cần Realtime (lỗi SignalR negotiation 502 được bỏ qua).
// TẠO TÀI KHOẢN THẬT → CHỈ DB tạm. Api như đầu project-wiki-e2e.ts (cổng 5219, DB 15419), Vite trỏ Api:
//   docker run -d --name e2e219-pg -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=e2e -p 127.0.0.1:15419:5432 postgres:17-alpine
//   VITE_API_TARGET=http://localhost:5219 bunx vite --port 5319 --strictPort   (trong frontend/)
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5219 BASE_URL=http://localhost:5319 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/mcp-tools-access-e2e.ts
// Ảnh chụp vào SHOTS_DIR (mặc định %TEMP%/mcp-tools-access).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BASE, launch } from './cdp';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5219';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const SHOTS = process.env.SHOTS_DIR ?? `${tmpdir()}/mcp-tools-access`;
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
const PW = 'E2e219-Staff-2026';
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV MT ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `MCP tools ${stamp}`, code: `MT${stamp}` })).body;
const code = `MT1${stamp}`.toUpperCase(), user = `e2e.mt.${stamp}`;
const emp = (await json(admin, 'POST', '/api/org/employees', { code, fullName: 'Nhân Viên Thường', email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
  departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
const acc = (await json(admin, 'POST', `/api/org/employees/${emp.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
await json(await login(user, acc.tempPassword), 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
const staff = await login(user, PW);
ok('tạo nhân viên thường', !!staff);

/** Mở Chrome với cookie sẵn (không đăng nhập lại qua UI để không huỷ cookie của script). */
const browser = async (port: number, cookie: string) => {
  const br = await launch(port, `${tmpdir()}/mcp-tools-${port}-${stamp}`);
  const [name, value] = [cookie.slice(0, cookie.indexOf('=')), cookie.slice(cookie.indexOf('=') + 1)];
  await br.send('Network.enable');
  await br.send('Network.setCookie', { name, value, url: BASE, httpOnly: true });
  return br;
};
/** Nhóm sidebar → danh sách nhãn mục. */
const sidebarGroups = `JSON.stringify([...document.querySelectorAll('[data-sidebar="group"]')].map((g) => ({
  title: g.querySelector('[data-sidebar="group-label"]')?.textContent?.trim(),
  items: [...g.querySelectorAll('a')].map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') })) })))`;
const waitFor = async (br: Awaited<ReturnType<typeof launch>>, expr: string, ms = 8000) => {
  for (let t = 0; t < ms; t += 250) { if (await br.evalJs(expr).catch(() => false)) return true; await br.sleep(250); }
  return false;
};
const noHScroll = `document.documentElement.scrollWidth <= window.innerWidth + 1`;

// ── Nhân viên thường ──
const s = await browser(9519, staff);
await s.go(`${BASE}/ai-access`, 3000);
ok('nhân viên: sidebar đã hiện', await waitFor(s, `document.querySelectorAll('[data-sidebar="group"]').length > 0`));
const sg = JSON.parse(await s.evalJs(sidebarGroups)) as { title: string; items: { text: string; href: string }[] }[];
const chung = sg.find((g) => g.title === 'Chung');
const iAi = chung?.items.findIndex((i) => i.href === '/ai-access') ?? -1;
ok('nhân viên: nhóm Chung có "Công cụ AI (MCP)" ngay dưới "Kết nối AI"', iAi >= 0 && chung!.items[iAi + 1]?.href === '/mcp-tools' && chung!.items[iAi + 1]?.text.includes('Công cụ AI (MCP)'), chung);
ok('nhân viên: không có nhóm Quản trị', !sg.some((g) => g.title === 'Quản trị'), sg.map((g) => g.title));
ok('nhân viên: link "Xem các công cụ AI đang có" ở tab Của tôi', await waitFor(s, `!!document.querySelector('[data-testid="ai-access-mcp-tools-link"]')`));
ok('nhân viên: link trỏ /mcp-tools', (await s.evalJs(`document.querySelector('[data-testid="ai-access-mcp-tools-link"]')?.getAttribute('href')`)) === '/mcp-tools');
await s.evalJs(`document.querySelector('[data-testid="ai-access-mcp-tools-link"]').scrollIntoView({ block: 'center' })`);
await s.sleep(400);
await s.shot(`${SHOTS}/1-ai-access-link.png`);
await s.evalJs(`document.querySelector('[data-testid="ai-access-mcp-tools-link"]').click()`);
ok('nhân viên: bấm link → /mcp-tools', await waitFor(s, `location.pathname === '/mcp-tools' && !!document.querySelector('[data-testid="mcp-search"]')`));
const body = await s.evalJs(`document.body.innerText`) as string;
ok('nhân viên: trang hiện danh mục (Máy chủ, Không mở cho AI, có thẻ tool)', body.includes('Không mở cho AI') && body.includes('get_my_role'));
ok('nhân viên: không hiện "Không có quyền"', !/không có quyền/i.test(body));
await s.evalJs(`window.scrollTo(0, 0)`);
await s.shot(`${SHOTS}/2-mcp-tools-staff.png`);
// Tìm kiếm (ô có kiểm soát → dùng setter gốc + sự kiện input)
await s.evalJs(`(() => { const el = document.querySelector('[data-testid="mcp-search"]'); el.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'wiki'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await s.sleep(500);
const after = await s.evalJs(`document.body.innerText`) as string;
ok('nhân viên: tìm "wiki" → còn tool sổ tay, mất tool không khớp', after.includes('search_wiki') && !after.includes('get_my_role'));
await s.shot(`${SHOTS}/3-mcp-tools-search.png`);
// Mở thẳng URL + 375px
await s.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
await s.go(`${BASE}/mcp-tools`, 3000);
ok('nhân viên: mở thẳng /mcp-tools được', await waitFor(s, `!!document.querySelector('[data-testid="mcp-search"]')`));
ok('nhân viên 375px: /mcp-tools không tràn ngang', await s.evalJs(noHScroll));
await s.shot(`${SHOTS}/4-mcp-tools-375.png`);
await s.go(`${BASE}/ai-access`, 3000);
await waitFor(s, `!!document.querySelector('[data-testid="ai-access-mcp-tools-link"]')`);
ok('nhân viên 375px: /ai-access không tràn ngang', await s.evalJs(noHScroll));
ok('nhân viên: không lỗi console', s.errors.filter((e) => !/favicon|WebSocket|realtime|hub|negotiation|Status code '502'/i.test(e)).length === 0, s.errors);
s.close();

// ── Admin ──
const a = await browser(9520, admin);
await a.go(`${BASE}/mcp-tools`, 3000);
ok('admin: trang /mcp-tools vẫn mở', await waitFor(a, `!!document.querySelector('[data-testid="mcp-search"]')`));
const ag = JSON.parse(await a.evalJs(sidebarGroups)) as { title: string; items: { text: string; href: string }[] }[];
const qt = ag.find((g) => g.title === 'Quản trị');
ok('admin: nhóm Quản trị không còn "Công cụ AI (MCP)", còn "Hệ thống"', !!qt && !qt.items.some((i) => i.href === '/mcp-tools') && qt.items.some((i) => i.href === '/system'), qt);
ok('admin: "Công cụ AI (MCP)" ở nhóm Chung', !!ag.find((g) => g.title === 'Chung')?.items.some((i) => i.href === '/mcp-tools'));
ok('admin: chỉ một mục /mcp-tools trong menu', ag.flatMap((g) => g.items).filter((i) => i.href === '/mcp-tools').length === 1);
await a.shot(`${SHOTS}/5-mcp-tools-admin.png`);
a.close();

console.log(`\n${pass} pass, ${fail} fail — ảnh: ${SHOTS}`);
process.exit(fail ? 1 : 0);
