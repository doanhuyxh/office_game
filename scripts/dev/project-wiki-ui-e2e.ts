// E2E TEST-217: tab "Sổ tay" của dự án (Chrome headless) — trạng thái rỗng, tạo trang gốc + trang con, Viết / Xem trước, sửa (phiên bản tăng),
// tìm theo chữ trong nội dung (đoạn trích, bấm mở trang), link ?tab=wiki&page=<id>, dòng "Sổ tay: N trang" ở Tổng quan, hai phiên sửa cùng trang
// (phiên lưu sau thấy cảnh báo xung đột, chữ đang soạn còn nguyên, xem bản mới nhất, lấy làm gốc rồi lưu), rời trang khi còn chữ chưa lưu → hỏi,
// trang do bot (token AI) sửa có nhãn BOT ở trang + lịch sử, quản lý dự án khoá trang → thành viên mất nút Sửa, lịch sử + khôi phục, xoá trang
// (còn trang con → báo lý do), người xem nhờ phòng ban chỉ đọc + tìm, dự án đã đóng (thành viên chỉ đọc, quản lý vẫn sửa), máy tính + 375px, sáng + tối.
// TẠO DỮ LIỆU THẬT → CHỈ DB tạm (không cần S3 / Realtime / Mcp). Api như đầu project-wiki-e2e.ts, Vite trỏ Api:
//   docker run -d --name e2e217-pg -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=e2e -p 127.0.0.1:15417:5432 postgres:17-alpine
//   VITE_API_TARGET=http://localhost:5217 bunx vite --port 5317 --strictPort   (trong frontend/)
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5217 BASE_URL=http://localhost:5317 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/project-wiki-ui-e2e.ts
// Ảnh chụp vào SHOTS_DIR (mặc định %TEMP%/project-wiki-ui).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BASE, launch } from './cdp';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5217';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const SHOTS = process.env.SHOTS_DIR ?? `${tmpdir()}/project-wiki-ui`;
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
const bearer = async (token: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const PW = 'E2e-Local-2026';
const stamp = Date.now().toString(36).slice(-5);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

// ── Dữ liệu: quản lý dự án PM, thành viên M + M2, người xem nhờ phòng ban V ──
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV WU ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Wiki UI ${stamp}`, code: `WU${stamp}` })).body;
const deptV = (await json(admin, 'POST', '/api/org/departments', { name: `Wiki xem ${stamp}`, code: `WX${stamp}` })).body;
const mkEmp = async (rawCode: string, name: string, user: string, roles: string[], department = dept) => {
  const code = rawCode.toUpperCase();
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: department, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, code, name, user, cookie: await login(user, PW) };
};
const PM = await mkEmp(`UM${stamp}`, 'Quản Lý Sổ Tay', `e2e.wu.pm.${stamp}`, ['employee', 'manager']);
const M = await mkEmp(`U1${stamp}`, 'Thành Viên Một', `e2e.wu.m1.${stamp}`, ['employee']);
const M2 = await mkEmp(`U2${stamp}`, 'Thành Viên Hai', `e2e.wu.m2.${stamp}`, ['employee']);
const V = await mkEmp(`UV${stamp}`, 'Người Xem Phòng Ban', `e2e.wu.v.${stamp}`, ['employee'], deptV);
const projBody = { code: `WU${stamp}`.toUpperCase(), name: 'Sổ tay (giao diện)', kind: 'Internal', startOn: today, sequential: false, departmentIds: [deptV] };
const created = await json(PM.cookie, 'POST', '/api/projects', { ...projBody, memberIds: [M.e.id, M2.e.id] });
const P = (created.body?.id ?? created.body) as string;
ok('dữ liệu: dự án + 2 thành viên + phòng ban tham gia', created.status < 300, created);
// Token AI của M2 — tạo trước khi M2 đăng nhập trình duyệt (đăng nhập UI làm cookie API cũ hết hạn)
const tok = (await json(M2.cookie, 'POST', '/api/auth/access-tokens', { name: `e2e wiki ui ${stamp}`, expiresInDays: 30 })).body?.token as string;
ok('dữ liệu: token AI của thành viên Hai', !!tok);
const W = `/api/projects/${P}/wiki`;

const q = (id: string) => `document.querySelector('[data-testid="${id}"]')`;
const brA = await launch(9417, `${tmpdir()}/wiki-ui-a-${stamp}`);
const brB = await launch(9418, `${tmpdir()}/wiki-ui-b-${stamp}`);
type Br = typeof brA;
/** Bấm thật (pointer) vào giữa phần tử — Radix DropdownMenu mở theo pointerdown. */
const clickAt = async (br: Br, expr: string) => {
  const r = await br.evalJs(`(() => { const e = ${expr}; if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  if (!r) throw new Error(`Không thấy phần tử: ${expr}`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'] as const)
    await br.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  await br.sleep(400);
};
const click = (br: Br, expr: string, wait = 600) => br.evalJs(`(() => { const e = ${expr}; if (!e) throw new Error('không thấy ' + ${JSON.stringify(expr)}); e.click(); })()`).then(() => br.sleep(wait));
const btn = (text: string, scope = 'document') => `[...${scope}.querySelectorAll('button')].find((b) => b.innerText.trim() === ${JSON.stringify(text)})`;
const setVal = (br: Br, selector: string, v: string) => br.evalJs(`(() => { const i = document.querySelector(${JSON.stringify(selector)});
  const proto = i instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const text = (br: Br, id: string) => br.evalJs(`${q(id)}?.innerText ?? null`) as Promise<string | null>;
const has = (br: Br, id: string) => br.evalJs(`!!${q(id)}`) as Promise<boolean>;
const urlPage = (br: Br) => br.evalJs(`new URL(location.href).searchParams.get('page')`) as Promise<string | null>;
const treeTitles = (br: Br) => br.evalJs(`[...document.querySelectorAll('[data-testid="wiki-tree"] [data-testid="wiki-tree-item"]')].filter((e) => e.offsetParent).map((e) => e.innerText.trim())`) as Promise<string[]>;
const treeItem = (title: string) => `[...document.querySelectorAll('[data-testid="wiki-tree-item"]')].find((e) => e.offsetParent && e.innerText.trim() === ${JSON.stringify(title)})`;
const menuItem = (t: string) => `[...document.querySelectorAll('[role="menuitem"]')].find((e) => e.innerText.trim() === ${JSON.stringify(t)})`;
const noHScroll = (br: Br) => br.evalJs(`document.documentElement.scrollWidth <= window.innerWidth + 1`);
const theme = async (br: Br, t: 'light' | 'dark', url: string) => {
  await br.evalJs(`localStorage.setItem('officehub:theme', '${t}')`);
  await br.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: t }] });
  await br.go(url, 3000);
};
const URL_WIKI = `${BASE}/projects/${P}?tab=wiki`;
const errorsOf = (br: Br) => br.errors.filter((e) => !/negotiation|hub\/|SignalR|WebSocket|409|Conflict|status of 4/i.test(e ?? ''));

try {
  // ── Thành viên Một: trạng thái rỗng, tạo trang gốc ──
  ok('M đăng nhập UI', (await brA.login(M.user, PW)) === 200);
  await brA.go(URL_WIKI, 1000);
  await theme(brA, 'light', URL_WIKI);
  ok('tab Sổ tay mở từ ?tab=wiki, chưa có trang → lời dẫn + "Tạo trang đầu tiên"', (await text(brA, 'wiki-empty'))?.includes('Sổ tay dự án chưa có trang nào') === true && await has(brA, 'wiki-create-first'));
  await click(brA, q('wiki-create-first'));
  ok('bấm Tạo trang đầu tiên → ô soạn', await has(brA, 'wiki-editor'));
  await setVal(brA, '#wiki-title', 'Quy trình triển khai');
  await setVal(brA, '#wiki-summary', 'Cách đưa bản mới lên máy chủ');
  await setVal(brA, '#wiki-content', '## Chuẩn bị\n\nKiểm tra **build** xanh.\n\n## Triển khai\n\n- Chạy `deploy.sh`\n- Theo dõi log');
  await click(brA, btn('Xem trước', q('wiki-editor')));
  ok('Xem trước Markdown: tiêu đề + chữ đậm render', await brA.evalJs(`(() => { const e = ${q('wiki-editor')}; return !!e.querySelector('h2') && e.querySelector('strong')?.innerText === 'build' && !e.querySelector('#wiki-content'); })()`));
  await click(brA, btn('Viết', q('wiki-editor')));
  await click(brA, q('wiki-save'), 1500);
  const rootId = await urlPage(brA);
  ok('Tạo trang → URL ?page=<id>, xem trang mới', !!rootId && (await text(brA, 'wiki-page-title')) === 'Quy trình triển khai', { rootId });
  ok('Trang: tóm tắt + "Sửa lần cuối bởi Thành Viên Một lúc …" + phiên bản 1', (await text(brA, 'wiki-page-summary')) === 'Cách đưa bản mới lên máy chủ'
    && /Sửa lần cuối bởi Thành Viên Một lúc \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} · phiên bản 1/.test((await text(brA, 'wiki-page-updated')) ?? ''), await text(brA, 'wiki-page-updated'));
  ok('Mục lục tiêu đề ## (2 mục) + nội dung render', await brA.evalJs(`document.querySelectorAll('[data-testid="wiki-page"] [data-testid="work-guide-toc"] a').length === 2
    && ${q('wiki-page-content')}.querySelectorAll('h2').length === 2`));

  // ── Trang con ──
  await click(brA, q('wiki-new-child'));
  ok('Trang con: ô soạn ghi "Trang con của Quy trình triển khai"', (await text(brA, 'wiki-editor'))?.includes('Trang con của Quy trình triển khai') === true);
  await setVal(brA, '#wiki-title', 'Máy chủ staging');
  await setVal(brA, '#wiki-content', 'Cụm staging chạy trên kubernetes-xyz, địa chỉ nội bộ 10.0.0.5.');
  await click(brA, q('wiki-save'), 1500);
  const childId = await urlPage(brA);
  ok('Tạo trang con → mở trang con, đường dẫn trang cha', childId !== rootId && await brA.evalJs(`document.querySelector('nav[aria-label="Trang cha"]')?.innerText.includes('Quy trình triển khai')`));
  ok('Cây: 2 trang, con dưới cha', JSON.stringify(await treeTitles(brA)) === JSON.stringify(['Quy trình triển khai', 'Máy chủ staging']) && (await brA.evalJs(`document.querySelector('[data-testid="wiki-tree-toggle"]').textContent`))?.includes('Trang (2)'), await treeTitles(brA));

  // ── Sửa → phiên bản 2 ──
  await click(brA, q('wiki-edit'));
  await setVal(brA, '#wiki-content', 'Cụm staging chạy trên kubernetes-xyz, địa chỉ nội bộ 10.0.0.5.\n\nTài khoản đọc log: hỏi quản lý dự án.');
  await setVal(brA, '#wiki-note', 'Thêm dòng tài khoản log');
  await click(brA, q('wiki-save'), 1500);
  ok('Sửa → lưu, về chế độ xem, phiên bản 2', !(await has(brA, 'wiki-editor')) && (await text(brA, 'wiki-page-updated'))?.includes('phiên bản 2') === true, await text(brA, 'wiki-page-updated'));

  // ── Tìm theo chữ trong nội dung ──
  await click(brA, treeItem('Quy trình triển khai'), 1200);
  await setVal(brA, '[data-testid="wiki-search"]', 'kubernetes-xyz');
  await brA.sleep(1200);
  const hits = await brA.evalJs(`[...document.querySelectorAll('[data-testid="wiki-search-hit"]')].map((h) => h.innerText)`) as string[];
  ok('Tìm "kubernetes-xyz" (trong nội dung) → 1 trang + đoạn trích', hits.length === 1 && hits[0].includes('Máy chủ staging') && hits[0].includes('kubernetes-xyz'), hits);
  await brA.shot(`${SHOTS}/3-tim-kiem.png`);
  await click(brA, `document.querySelector('[data-testid="wiki-search-hit"]')`, 1200);
  ok('Bấm kết quả → mở đúng trang', (await urlPage(brA)) === childId && (await text(brA, 'wiki-page-title')) === 'Máy chủ staging');
  await setVal(brA, '[data-testid="wiki-search"]', 'khongcotutrongsotay');
  await brA.sleep(1200);
  ok('Tìm không thấy → "Không có trang nào khớp"', await brA.evalJs(`document.querySelector('[data-testid="project-wiki"]').innerText.includes('Không có trang nào khớp')`));
  await setVal(brA, '[data-testid="wiki-search"]', '');

  // ── Link ?tab=wiki&page=<id> ──
  await brA.go(`${URL_WIKI}&page=${rootId}`, 3000);
  ok('Mở link ?tab=wiki&page=<gốc> → đúng trang', (await text(brA, 'wiki-page-title')) === 'Quy trình triển khai');
  await brA.go(`${URL_WIKI}&page=${childId}`, 3000);
  ok('Mở link ?tab=wiki&page=<con> → đúng trang', (await text(brA, 'wiki-page-title')) === 'Máy chủ staging');
  await brA.shot(`${SHOTS}/1-may-tinh-sang.png`);
  ok('Tab "Sổ tay" có số trang 2', (await text(brA, 'tab-count-wiki')) === '2');
  await brA.go(`${BASE}/projects/${P}?tab=overview`, 3000);
  ok('Tổng quan: "Sổ tay → 2 trang"', (await text(brA, 'overview-wiki'))?.includes('2 trang') === true, await text(brA, 'overview-wiki'));
  await click(brA, `${q('overview-wiki')}.querySelector('button')`, 1500);
  ok('Bấm "Sổ tay →" → sang tab Sổ tay', await brA.evalJs(`new URL(location.href).searchParams.get('tab') === 'wiki'`) && await has(brA, 'project-wiki'));

  // ── Hai phiên sửa cùng trang ──
  ok('M2 đăng nhập UI', (await brB.login(M2.user, PW)) === 200);
  await brB.go(`${URL_WIKI}&page=${childId}`, 3000);
  await brA.go(`${URL_WIKI}&page=${childId}`, 3000);
  await click(brA, q('wiki-edit'));
  await click(brB, q('wiki-edit'));
  await setVal(brB, '#wiki-content', 'Bản của Thành Viên Hai: staging chuyển sang 10.0.0.9.');
  await click(brB, q('wiki-save'), 1500);
  ok('Phiên B lưu trước → phiên bản 3', (await text(brB, 'wiki-page-updated'))?.includes('phiên bản 3') === true);
  const draft = 'Bản của Thành Viên Một: thêm mục backup hằng ngày.';
  await setVal(brA, '#wiki-content', draft);
  await click(brA, q('wiki-save'), 1500);
  ok('Phiên A lưu sau → cảnh báo "Thành Viên Hai vừa sửa trang này (phiên bản 3 …)"', (await text(brA, 'wiki-conflict'))?.includes('Thành Viên Hai vừa sửa trang này (phiên bản 3') === true, await text(brA, 'wiki-conflict'));
  ok('Chữ đang soạn còn nguyên, vẫn ở ô soạn, nút Lưu khoá tới khi gộp', await brA.evalJs(`document.querySelector('#wiki-content')?.value === ${JSON.stringify(draft)} && ${q('wiki-save')}.disabled`));
  await click(brA, q('wiki-conflict-show'), 1200);
  ok('Xem bản mới nhất → nội dung của Thành Viên Hai', (await text(brA, 'wiki-conflict-latest'))?.includes('staging chuyển sang 10.0.0.9') === true);
  await brA.shot(`${SHOTS}/4-xung-dot.png`);
  await setVal(brA, '#wiki-content', `Bản của Thành Viên Hai: staging chuyển sang 10.0.0.9.\n\n${draft}`);
  await click(brA, q('wiki-conflict-rebase'));
  await click(brA, q('wiki-save'), 1500);
  ok('Gộp + lấy bản 3 làm gốc → lưu được phiên bản 4, có cả hai phần', (await text(brA, 'wiki-page-updated'))?.includes('phiên bản 4') === true
    && (await text(brA, 'wiki-page-content'))?.includes('10.0.0.9') === true && (await text(brA, 'wiki-page-content'))?.includes('backup hằng ngày') === true);

  // ── Rời trang khi còn chữ chưa lưu ──
  await click(brA, q('wiki-edit'));
  await setVal(brA, '#wiki-content', 'chữ chưa lưu');
  await click(brA, treeItem('Quy trình triển khai'), 900);
  ok('Đổi trang khi còn chữ chưa lưu → hỏi "Bỏ nội dung chưa lưu?"', (await text(brA, 'confirm-dialog'))?.includes('Bỏ nội dung chưa lưu?') === true);
  await click(brA, btn('Huỷ', q('confirm-dialog')), 800);
  ok('Bấm Huỷ → ở lại, chữ đang soạn còn nguyên, URL không đổi', await brA.evalJs(`document.querySelector('#wiki-content')?.value === 'chữ chưa lưu'`) && (await urlPage(brA)) === childId);
  await clickAt(brA, `[...document.querySelectorAll('[data-testid="project-tabs"] [role="tab"]')].find((t) => t.innerText.startsWith('Tổng quan'))`);
  await brA.sleep(500);
  ok('Đổi tab khi còn chữ chưa lưu → cũng hỏi', (await text(brA, 'confirm-dialog'))?.includes('Bỏ nội dung chưa lưu?') === true);
  await click(brA, q('confirm-dialog-ok'), 1500);
  ok('Bỏ thay đổi → sang tab Tổng quan', await has(brA, 'project-overview'));
  await brA.go(`${URL_WIKI}&page=${childId}`, 3000);
  ok('Nội dung chưa lưu không được ghi', (await text(brA, 'wiki-page-content'))?.includes('chữ chưa lưu') === false && (await text(brA, 'wiki-page-updated'))?.includes('phiên bản 4') === true);

  // ── Bot (token AI) tạo / sửa trang → nhãn BOT ──
  const bot = await bearer(tok, 'POST', `${W}/pages`, { title: 'Ghi chú của trợ lý', content: 'Bot ghi lại quy ước đặt tên nhánh.', note: 'bot tạo' });
  ok('Token AI tạo trang (API) → 201', bot.status === 201, bot);
  const botId = bot.body?.id as string;
  await bearer(tok, 'PUT', `${W}/pages/${botId}`, { baseVersion: 1, content: 'Bot ghi lại quy ước đặt tên nhánh: feat/…, fix/….', note: 'bot sửa' });
  await brA.go(`${URL_WIKI}&page=${botId}`, 3000);
  ok('Trang bot sửa: nhãn BOT ở "Sửa lần cuối bởi"', await brA.evalJs(`!!${q('wiki-page-updated')}.querySelector('[data-testid="bot-badge"]')`));
  await click(brA, q('wiki-history-open'), 1500);
  ok('Lịch sử: 2 phiên bản, đều có nhãn BOT, ghi chú', await brA.evalJs(`(() => { const it = [...document.querySelectorAll('[data-testid="wiki-version-item"]')];
    return it.length === 2 && it.every((x) => !!x.querySelector('[data-testid="bot-badge"]')) && it[0].innerText.includes('bot sửa'); })()`));
  await click(brA, `document.querySelector('[data-testid="wiki-version-item"]:last-child, [data-testid="wiki-versions"] li:last-child button')`, 1000);
  ok('Thành viên thường: xem được bản cũ, không có nút Khôi phục', await has(brA, 'wiki-version-view') && !(await has(brA, 'wiki-restore')));
  await brA.shot(`${SHOTS}/5-lich-su-bot.png`);
  await brA.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await brA.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  await brA.sleep(500);
  ok('Thành viên thường: menu ⋯ không có Khoá / Xoá', await (async () => {
    await clickAt(brA, q('wiki-menu'));
    const items = await brA.evalJs(`[...document.querySelectorAll('[role="menuitem"]')].map((e) => e.innerText.trim())`) as string[];
    await brA.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await brA.sleep(300);
    return items.includes('Đổi tên') && items.includes('Chuyển trang cha') && !items.includes('Khoá trang') && !items.includes('Xoá trang');
  })());

  // ── Quản lý dự án: khoá, lịch sử + khôi phục, xoá ──
  ok('PM đăng nhập UI (phiên A)', (await brA.login(PM.user, PW)) === 200);
  await brA.go(`${URL_WIKI}&page=${rootId}`, 3000);
  await clickAt(brA, q('wiki-menu'));
  await clickAt(brA, menuItem('Khoá trang'));
  await brA.sleep(1200);
  ok('PM khoá trang → nhãn "Đã khoá bởi Quản Lý Sổ Tay", PM vẫn có nút Sửa', (await text(brA, 'wiki-locked'))?.includes('Đã khoá bởi Quản Lý Sổ Tay') === true && await has(brA, 'wiki-edit'));
  await brB.go(`${URL_WIKI}&page=${rootId}`, 3000);
  ok('Thành viên xem trang đã khoá → mất nút Sửa + Trang con, thấy nhãn khoá', !(await has(brB, 'wiki-edit')) && !(await has(brB, 'wiki-new-child')) && await has(brB, 'wiki-locked'));
  ok('Cây có biểu tượng khoá ở trang đã khoá', await brB.evalJs(`!!${treeItem('Quy trình triển khai')}.parentElement.querySelector('[aria-label="Đã khoá"]')`));
  await brB.shot(`${SHOTS}/6-trang-khoa-thanh-vien.png`);
  await brA.go(`${URL_WIKI}&page=${childId}`, 3000);
  await click(brA, q('wiki-history-open'), 1500);
  ok('PM: lịch sử trang con 4 phiên bản', await brA.evalJs(`document.querySelectorAll('[data-testid="wiki-version-item"]').length === 4`));
  await click(brA, `[...document.querySelectorAll('[data-testid="wiki-version-item"]')].at(-1)`, 1200);
  ok('Xem phiên bản 1 → nội dung cũ', (await text(brA, 'wiki-version-view'))?.includes('kubernetes-xyz') === true && await has(brA, 'wiki-restore'));
  await click(brA, q('wiki-restore'), 700);
  ok('Khôi phục → hộp xác nhận', (await text(brA, 'confirm-dialog'))?.includes('Khôi phục phiên bản 1?') === true);
  await click(brA, q('confirm-dialog-ok'), 2000);
  ok('Khôi phục xong → phiên bản 5 có nội dung bản 1', (await text(brA, 'wiki-page-updated'))?.includes('phiên bản 5') === true
    && (await text(brA, 'wiki-page-content'))?.includes('kubernetes-xyz') === true && (await text(brA, 'wiki-page-content'))?.includes('10.0.0.9') === false);
  await brA.go(`${URL_WIKI}&page=${rootId}`, 3000);
  await clickAt(brA, q('wiki-menu'));
  await clickAt(brA, menuItem('Xoá trang'));
  await click(brA, q('confirm-dialog-ok'), 1500);
  ok('Xoá trang còn trang con → báo lý do server, trang còn', await brA.evalJs(`document.body.innerText.includes('Trang còn trang con')`) && (await treeTitles(brA)).includes('Quy trình triển khai'));
  await click(brA, btn('Huỷ', q('confirm-dialog')), 600);
  await brA.go(`${URL_WIKI}&page=${botId}`, 3000);
  await clickAt(brA, q('wiki-menu'));
  await clickAt(brA, menuItem('Xoá trang'));
  ok('Xoá trang → hộp xác nhận nút đỏ', await brA.evalJs(`${q('confirm-dialog-ok')}.dataset.variant === 'destructive' || ${q('confirm-dialog-ok')}.className.includes('destructive')`));
  await click(brA, q('confirm-dialog-ok'), 2000);
  ok('Xoá xong → trang biến khỏi cây', !(await treeTitles(brA)).includes('Ghi chú của trợ lý'), await treeTitles(brA));

  // ── Người xem nhờ phòng ban ──
  ok('V đăng nhập UI (phiên B)', (await brB.login(V.user, PW)) === 200);
  await brB.go(URL_WIKI, 3000);
  ok('Người xem phòng ban: đọc cây + trang', (await treeTitles(brB)).length === 2 && (await text(brB, 'wiki-page-title')) === 'Quy trình triển khai');
  ok('Người xem phòng ban: không có Trang mới / Sửa / Trang con / menu ⋯', !(await has(brB, 'wiki-new')) && !(await has(brB, 'wiki-edit')) && !(await has(brB, 'wiki-new-child')) && !(await has(brB, 'wiki-menu')));
  await setVal(brB, '[data-testid="wiki-search"]', 'kubernetes');
  await brB.sleep(1200);
  ok('Người xem phòng ban: tìm được', (await brB.evalJs(`document.querySelectorAll('[data-testid="wiki-search-hit"]').length`)) === 1);

  // ── Dự án đã đóng ──
  const pmApi = await login(PM.user, PW); // đăng nhập API làm phiên UI của PM hết hạn → đăng nhập lại UI sau
  ok('Đóng dự án', (await json(pmApi, 'PUT', `/api/projects/${P}`, { ...projBody, status: 'Closed' })).status < 300);
  ok('M2 đăng nhập UI (phiên B)', (await brB.login(M2.user, PW)) === 200);
  await brB.go(`${URL_WIKI}&page=${childId}`, 3000);
  ok('Dự án đóng: thành viên thấy "Dự án đã đóng — chỉ đọc", không Sửa / Trang mới', (await text(brB, 'wiki-closed'))?.includes('Dự án đã đóng — chỉ đọc') === true
    && !(await has(brB, 'wiki-edit')) && !(await has(brB, 'wiki-new')));
  ok('PM đăng nhập lại UI', (await brA.login(PM.user, PW)) === 200);
  await brA.go(`${URL_WIKI}&page=${childId}`, 3000);
  ok('Dự án đóng: quản lý dự án vẫn có Sửa, không có chú thích chỉ đọc', await has(brA, 'wiki-edit') && !(await has(brA, 'wiki-closed')));
  await click(brA, q('wiki-edit'));
  await setVal(brA, '#wiki-summary', 'Sửa khi dự án đã đóng');
  await click(brA, q('wiki-save'), 1500);
  ok('Dự án đóng: quản lý dự án lưu được', (await text(brA, 'wiki-page-summary')) === 'Sửa khi dự án đã đóng');
  const pmApi2 = await login(PM.user, PW);
  ok('Mở lại dự án', (await json(pmApi2, 'PUT', `/api/projects/${P}`, { ...projBody, status: 'Active' })).status < 300);

  // ── Ảnh: máy tính tối, điện thoại 375px sáng + tối ──
  await brB.go(`${URL_WIKI}&page=${rootId}`, 3000);
  await theme(brB, 'dark', `${URL_WIKI}&page=${rootId}`);
  ok('Theme tối: html.dark + trang sổ tay', await brB.evalJs(`document.documentElement.classList.contains('dark') && !!${q('wiki-page')}`));
  await brB.shot(`${SHOTS}/2-may-tinh-toi.png`);
  await brB.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await theme(brB, 'light', `${URL_WIKI}&page=${childId}`);
  ok('375px: cây thu gọn phía trên (ẩn tới khi bấm), trang hiện, không cuộn ngang', !(await brB.evalJs(`!!${q('wiki-tree')}?.offsetParent`)) && await has(brB, 'wiki-page') && await noHScroll(brB));
  await brB.shot(`${SHOTS}/7-dien-thoai-sang.png`);
  await click(brB, q('wiki-tree-toggle'));
  ok('375px: bấm "Trang (2)" → mở cây', await brB.evalJs(`!!${q('wiki-tree')}?.offsetParent`) && await noHScroll(brB));
  await click(brB, treeItem('Quy trình triển khai'), 1500);
  ok('375px: chọn trang → cây thu lại, mở trang', !(await brB.evalJs(`!!${q('wiki-tree')}?.offsetParent`)) && (await text(brB, 'wiki-page-title')) === 'Quy trình triển khai');
  await theme(brB, 'dark', `${URL_WIKI}&page=${childId}`);
  await click(brB, q('wiki-edit'));
  ok('375px tối: ô soạn không cuộn ngang', await has(brB, 'wiki-editor') && await noHScroll(brB));
  await brB.shot(`${SHOTS}/8-dien-thoai-toi-soan.png`);
  await click(brB, btn('Huỷ', q('wiki-editor')));

  ok('không lỗi console (bỏ SignalR / 4xx mong đợi)', errorsOf(brA).length === 0 && errorsOf(brB).length === 0, [...errorsOf(brA), ...errorsOf(brB)]);
} catch (e) {
  fail++;
  console.log('✘ lỗi:', e);
} finally {
  brA.close();
  brB.close();
}
console.log(`\n${pass}/${pass + fail} pass — ảnh: ${SHOTS}`);
process.exit(fail ? 1 : 0);
