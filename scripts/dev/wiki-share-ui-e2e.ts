// E2E TEST-229: giao diện chia sẻ sổ tay + trang công khai /s/{token} (Chrome headless, 3 phiên: quản lý dự án PM, thành viên M, khách ẩn danh).
// PM: nút "Chia sẻ" ở trang sổ tay → hộp thoại tạo link (người nhận, hạn, kèm trang con, mật khẩu) → URL /s/{token} + QR + "chỉ hiện một lần",
// danh sách link (lượt xem, mật khẩu), Nhật ký xem (IP + trình duyệt), chuông "Khách đã mở link chia sẻ sổ tay" → mở đúng trang, Thu hồi (xác nhận).
// M (thành viên thường): không thấy nút "Chia sẻ". Khách: mở link không cần đăng nhập — tên dự án, "Hết hạn sau", watermark, cây trang + ?page=,
// link nội bộ mở trong bản chia sẻ, link ngoài hiện chữ thường; mật khẩu sai / đúng / quá số lần (429); thu hồi → hết hạn; token lạ → không tồn tại;
// đếm ngược về 0 → hết hạn; meta robots noindex; máy tính + điện thoại 390×844 (ngăn kéo mục lục), sáng + tối.
// TẠO DỮ LIỆU THẬT + SỬA DB BẰNG SQL → CHỈ DB tạm (không cần S3 / Realtime / Mcp). Api như đầu wiki-share-e2e.ts (cổng 5229, PG 15429), Vite trỏ Api:
//   docker run -d --name e2e229-pg -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=e2e -p 127.0.0.1:15429:5432 postgres:17-alpine
//   VITE_API_TARGET=http://localhost:5229 bunx vite --port 5329 --strictPort   (trong frontend/)
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5229 BASE_URL=http://localhost:5329 PG_CONTAINER=e2e229-pg ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/wiki-share-ui-e2e.ts
// Ảnh chụp vào SHOTS_DIR (mặc định %TEMP%/wiki-share-ui).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BASE, launch } from './cdp';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5229';
const PG = process.env.PG_CONTAINER ?? 'e2e229-pg';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const SHOTS = process.env.SHOTS_DIR ?? `${tmpdir()}/wiki-share-ui`;
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
const sql = (q: string) => {
  const r = Bun.spawnSync(['docker', 'exec', PG, 'psql', '-U', 'e2e', '-d', 'e2e', '-v', 'ON_ERROR_STOP=1', '-c', q]);
  if (r.exitCode !== 0) throw new Error(`psql lỗi: ${r.stderr.toString()}`);
};
const PW = 'E2e-Local-2026';
const stamp = Date.now().toString(36).slice(-5);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

// ── Dữ liệu: quản lý dự án PM, thành viên M; sổ tay: gốc + con + trang ngoài ──
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV WS ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Wiki share UI ${stamp}`, code: `WS${stamp}` })).body;
const mkEmp = async (rawCode: string, name: string, user: string, roles: string[]) => {
  const code = rawCode.toUpperCase();
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, code, name, user, cookie: await login(user, PW) };
};
const PM = await mkEmp(`SM${stamp}`, 'Quản Lý Chia Sẻ', `e2e.ws.pm.${stamp}`, ['employee', 'manager']);
const M = await mkEmp(`S1${stamp}`, 'Thành Viên Thường', `e2e.ws.m1.${stamp}`, ['employee']);
const created = await json(PM.cookie, 'POST', '/api/projects', { code: `WS${stamp}`.toUpperCase(), name: 'Dự án Khách ABC', kind: 'Internal', startOn: today, sequential: false, memberIds: [M.e.id] });
const P = (created.body?.id ?? created.body) as string;
ok('dữ liệu: dự án + thành viên', created.status < 300, created);
const W = `/api/projects/${P}/wiki`;
const root = (await json(PM.cookie, 'POST', `${W}/pages`, { title: 'Đặc tả gửi khách', summary: 'Bản nháp phạm vi dự án', content: 'tạm' })).body;
const child = (await json(PM.cookie, 'POST', `${W}/pages`, { title: 'Phạm vi', parentId: root.id, content: '## Trong phạm vi\n\n- Trang đăng nhập\n- Báo cáo tuần\n\n## Ngoài phạm vi\n\n- Ứng dụng di động' })).body;
const other = (await json(PM.cookie, 'POST', `${W}/pages`, { title: 'Ghi chú nội bộ', content: 'Không gửi khách.' })).body;
const rootContent = `## Giới thiệu\n\nTài liệu đặc tả cho **Khách ABC**. Xem [Phạm vi](/projects/${P}?tab=wiki&page=${child.id}) và [Ghi chú nội bộ](/projects/${P}?tab=wiki&page=${other.id}).\n\n`
  + `## Lịch\n\n| Mốc | Ngày |\n|---|---|\n| Bản nháp | 01/12 |\n| Nghiệm thu | 20/12 |\n\nTham khảo [trang web](https://example.com).`;
const upd = await json(PM.cookie, 'PUT', `${W}/pages/${root.id}`, { baseVersion: root.version, content: rootContent });
ok('dữ liệu: trang gốc + con + trang ngoài', !!root.id && !!child.id && !!other.id && upd.status === 200, upd);
// Link có mật khẩu để thử 429 (tạo trước khi PM đăng nhập trình duyệt — đăng nhập UI làm cookie API cũ hết hạn)
const l429 = await json(PM.cookie, 'POST', `${W}/shares`, { pageId: root.id, days: 1, recipientName: 'Thử khoá', password: 'dung-roi-123' });
const l0 = await json(PM.cookie, 'POST', `${W}/shares`, { pageId: child.id, days: 1, recipientName: 'Sắp hết hạn' });
ok('dữ liệu: 2 link phụ qua API', l429.status === 200 && l0.status === 200, [l429, l0]);

const q = (id: string) => `document.querySelector('[data-testid="${id}"]')`;
const brA = await launch(9429, `${tmpdir()}/wiki-share-a-${stamp}`);
const brB = await launch(9430, `${tmpdir()}/wiki-share-b-${stamp}`);
const brC = await launch(9431, `${tmpdir()}/wiki-share-c-${stamp}`);
type Br = typeof brA;
const clickAt = async (br: Br, expr: string) => {
  const r = await br.evalJs(`(() => { const e = ${expr}; if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  if (!r) throw new Error(`Không thấy phần tử: ${expr}`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'] as const)
    await br.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  await br.sleep(500);
};
const click = (br: Br, expr: string, wait = 700) => br.evalJs(`(() => { const e = ${expr}; if (!e) throw new Error('không thấy ' + ${JSON.stringify(expr)}); e.click(); })()`).then(() => br.sleep(wait));
const btnIn = (text: string, scope = 'document') => `[...${scope}.querySelectorAll('button')].find((b) => b.innerText.trim() === ${JSON.stringify(text)})`;
const setVal = (br: Br, selector: string, v: string) => br.evalJs(`(() => { const i = document.querySelector(${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const text = (br: Br, id: string) => br.evalJs(`${q(id)}?.innerText ?? null`) as Promise<string | null>;
const has = (br: Br, id: string) => br.evalJs(`!!${q(id)}`) as Promise<boolean>;
const visible = (br: Br, id: string) => br.evalJs(`!!${q(id)}?.offsetParent`) as Promise<boolean>;
const noHScroll = (br: Br) => br.evalJs(`document.documentElement.scrollWidth <= window.innerWidth + 1`);
const theme = async (br: Br, t: 'light' | 'dark', url: string) => {
  await br.evalJs(`localStorage.setItem('officehub:theme', '${t}')`);
  await br.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: t }] });
  await br.go(url, 3000);
};
const errorsOf = (br: Br) => br.errors.filter((e) => !/negotiation|hub\/|SignalR|WebSocket|status of 4/i.test(e ?? ''));
const waitFor = async (br: Br, expr: string, ms = 8000) => { for (let t = 0; t < ms; t += 250) { if (await br.evalJs(`!!(${expr})`)) return true; await br.sleep(250); } return false; };
const mobile = (br: Br) => br.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
const desktop = (br: Br) => br.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const URL_ROOT = `${BASE}/projects/${P}?tab=wiki&page=${root.id}`;

try {
  // ── Thành viên thường: không thấy nút Chia sẻ ──
  ok('M đăng nhập UI', (await brB.login(M.user, PW)) === 200);
  await brB.go(URL_ROOT, 3500);
  ok('thành viên thường: trang sổ tay hiện, KHÔNG có nút "Chia sẻ"', await has(brB, 'wiki-page') && !(await has(brB, 'wiki-share-open')));

  // ── PM: tạo link kèm trang con, không mật khẩu ──
  ok('PM đăng nhập UI', (await brA.login(PM.user, PW)) === 200);
  await brA.go(URL_ROOT, 1000);
  await theme(brA, 'light', URL_ROOT);
  ok('quản lý dự án thấy nút "Chia sẻ"', await has(brA, 'wiki-share-open'));
  await clickAt(brA, q('wiki-share-open'));
  ok('hộp thoại chia sẻ mở, "Kèm các trang con" sẵn tích (trang có con)', await has(brA, 'wiki-share-form')
    && await brA.evalJs(`${q('wiki-share-children')}?.getAttribute('data-state') === 'checked'`));
  ok('danh sách link của trang: 1 link tạo qua API ("Thử khoá", có mật khẩu); link của trang con không lẫn vào', await waitFor(brA, `${q('wiki-share-list')}`)
    && await brA.evalJs(`(() => { const it = [...document.querySelectorAll('[data-testid="wiki-share-item"]')]; return it.length === 1 && it[0].innerText.includes('Thử khoá') && it[0].innerText.includes('Mật khẩu'); })()`));
  await setVal(brA, '#wiki-share-recipient', 'Anh Khách');
  await setVal(brA, '#wiki-share-label', 'Bản nháp tuần 48');
  await click(brA, q('wiki-share-ttl-custom'));
  ok('chọn "Chọn ngày" → ô ngày + ghi chú tối đa 90 ngày', (await text(brA, 'wiki-share-expires-on'))?.includes('tối đa 90 ngày') === true);
  await click(brA, q('wiki-share-create'), 800);
  ok('chọn ngày mà chưa chọn → báo "Chọn ngày hết hạn", không gọi API', (await text(brA, 'wiki-share-form'))?.includes('Chọn ngày hết hạn') === true && await has(brA, 'wiki-share-form'));
  await click(brA, q('wiki-share-ttl-7'));
  await setVal(brA, '#wiki-share-password', 'abc');
  await click(brA, q('wiki-share-create'), 1500);
  ok('mật khẩu 3 ký tự → lỗi dưới ô (server)', (await text(brA, 'wiki-share-form'))?.includes('tối thiểu 4') === true);
  await setVal(brA, '#wiki-share-password', '');
  await click(brA, q('wiki-share-create'), 1800);
  const url1 = await brA.evalJs(`${q('wiki-share-url')}?.value ?? ''`) as string;
  ok('tạo xong: URL /s/{token} (43 ký tự) + QR + "chỉ hiện một lần"', /\/s\/[A-Za-z0-9_-]{43}$/.test(url1) && await has(brA, 'wiki-share-qr')
    && (await text(brA, 'wiki-share-created'))?.includes('một lần') === true, url1);
  ok('danh sách link: thêm dòng "Anh Khách" (mới nhất trước) · Còn hạn · kèm trang con', await brA.evalJs(`(() => { const it = [...document.querySelectorAll('[data-testid="wiki-share-item"]')];
    return it.length === 2 && it[0].innerText.includes('Anh Khách') && it[0].innerText.includes('Còn hạn') && it[0].innerText.includes('kèm trang con'); })()`));
  await brA.shot(`${SHOTS}/1-share-dialog-created-light.png`);

  // ── PM: link thứ hai có mật khẩu, không kèm trang con ──
  await click(brA, btnIn('Tạo link khác', q('wiki-share-dialog')));
  ok('"Tạo link khác" → form trống (không mang người nhận / nhãn của link trước)', await brA.evalJs(`document.querySelector('#wiki-share-recipient').value === '' && document.querySelector('#wiki-share-label').value === ''`));
  await setVal(brA, '#wiki-share-recipient', 'Chị Mật Khẩu');
  await clickAt(brA, q('wiki-share-children'));
  await setVal(brA, '#wiki-share-password', 'mat-khau-229');
  await click(brA, q('wiki-share-create'), 1800);
  const url2 = await brA.evalJs(`${q('wiki-share-url')}?.value ?? ''`) as string;
  ok('link 2 tạo được, khác link 1, có "cần mật khẩu"', /\/s\/[A-Za-z0-9_-]{43}$/.test(url2) && url2 !== url1 && (await text(brA, 'wiki-share-created'))?.includes('cần mật khẩu') === true);
  ok('danh sách: 3 link của trang gốc, link 2 có nhãn Mật khẩu', await brA.evalJs(`(() => { const it = [...document.querySelectorAll('[data-testid="wiki-share-item"]')];
    const m = it.find((e) => e.innerText.includes('Chị Mật Khẩu')); return it.length === 3 && !!m && m.innerText.includes('Mật khẩu') && !m.innerText.includes('kèm trang con')
      && !m.innerText.includes('Bản nháp tuần 48'); })()`),
    await brA.evalJs(`[...document.querySelectorAll('[data-testid="wiki-share-item"]')].map((e) => e.innerText)`));
  await brA.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await brA.sleep(500);

  // ── Khách ẩn danh: link 1 (kèm trang con) ──
  await brC.go(url1, 1000);
  await theme(brC, 'light', url1);
  ok('khách: mở link không đăng nhập → trang gốc', (await text(brC, 'wiki-share-title')) === 'Đặc tả gửi khách', await text(brC, 'wiki-share-page'));
  ok('khách: tên dự án + "Hết hạn sau … ngày"', (await text(brC, 'wiki-share-project')) === 'Dự án Khách ABC' && /Hết hạn sau\s+6 ngày/.test((await text(brC, 'wiki-share-countdown')) ?? ''),
    await text(brC, 'wiki-share-countdown'));
  ok('khách: meta robots noindex', await brC.evalJs(`document.querySelector('meta[name="robots"]')?.content.includes('noindex') === true`));
  ok('khách: watermark "Bản xem trước cho Anh Khách"', await brC.evalJs(`${q('wiki-share-watermark')}?.textContent.includes('Bản xem trước cho Anh Khách') === true`));
  ok('khách: cây trang 2 mục (gốc + Phạm vi), không có trang ngoài', JSON.stringify(await brC.evalJs(`[...document.querySelectorAll('[data-testid="wiki-share-tree"] [data-testid="wiki-share-tree-item"]')].map((e) => e.innerText.trim())`))
    === JSON.stringify(['Đặc tả gửi khách', 'Phạm vi']));
  ok('khách: Markdown (bảng, chữ đậm) hiển thị', await brC.evalJs(`(() => { const c = ${q('wiki-share-content')}; return !!c.querySelector('table') && c.querySelector('strong')?.innerText === 'Khách ABC'; })()`));
  ok('khách: link tới trang ngoài → chữ thường + "(không thuộc bản xem trước)", không có thẻ a', await brC.evalJs(`(() => { const c = ${q('wiki-share-content')};
    return c.innerText.includes('Ghi chú nội bộ (không thuộc bản xem trước)') && ![...c.querySelectorAll('a')].some((a) => a.innerText.includes('Ghi chú nội bộ')); })()`));
  ok('khách: link web ngoài giữ nguyên (mở tab mới)', await brC.evalJs(`[...${q('wiki-share-content')}.querySelectorAll('a')].some((a) => a.href === 'https://example.com/' && a.target === '_blank')`));
  await brC.shot(`${SHOTS}/2-public-desktop-light.png`);
  await click(brC, `[...${q('wiki-share-content')}.querySelectorAll('a')].find((a) => a.innerText === 'Phạm vi')`, 1500);
  ok('khách: bấm link "Phạm vi" trong nội dung → mở trang con tại chỗ, ?page=', (await text(brC, 'wiki-share-title')) === 'Phạm vi'
    && await brC.evalJs(`location.pathname.startsWith('/s/') && new URL(location.href).searchParams.get('page') === ${JSON.stringify(child.id)}`));
  ok('khách: đường dẫn trang cha "Đặc tả gửi khách" + mục đang chọn tô sáng', (await brC.evalJs(`document.querySelector('nav[aria-label="Trang cha"]')?.innerText ?? ''`) as string).includes('Đặc tả gửi khách')
    && await brC.evalJs(`document.querySelector('[data-testid="wiki-share-tree"] [aria-current="page"]')?.innerText.trim() === 'Phạm vi'`));
  await click(brC, `[...document.querySelectorAll('[data-testid="wiki-share-tree"] [data-testid="wiki-share-tree-item"]')].find((e) => e.innerText.trim() === 'Đặc tả gửi khách')`, 1500);
  ok('khách: bấm mục lục → về trang gốc, bỏ ?page', (await text(brC, 'wiki-share-title')) === 'Đặc tả gửi khách' && await brC.evalJs(`!new URL(location.href).searchParams.get('page')`));
  await brC.go(`${url1}?page=${child.id}`, 2500);
  ok('khách: mở thẳng ?page=<con> → trang con', (await text(brC, 'wiki-share-title')) === 'Phạm vi');
  await theme(brC, 'dark', `${url1}?page=${child.id}`);
  ok('khách: chế độ tối (html.dark)', await brC.evalJs(`document.documentElement.classList.contains('dark')`));
  await brC.shot(`${SHOTS}/3-public-desktop-dark.png`);
  await click(brC, q('wiki-share-theme'), 600);
  ok('khách: nút sáng / tối đổi về sáng', await brC.evalJs(`!document.documentElement.classList.contains('dark')`));

  // ── Điện thoại 390×844 ──
  await mobile(brC);
  await theme(brC, 'light', url1);
  ok('điện thoại: không cuộn ngang, cây trang ẩn, có nút mục lục', await noHScroll(brC) && !(await visible(brC, 'wiki-share-tree')) && await visible(brC, 'wiki-share-menu'));
  await brC.shot(`${SHOTS}/4-public-mobile-light.png`);
  await clickAt(brC, q('wiki-share-menu'));
  ok('điện thoại: ngăn kéo mục lục mở, 2 trang', await waitFor(brC, `${q('wiki-share-drawer')}`) && await brC.evalJs(`${q('wiki-share-drawer')}.querySelectorAll('[data-testid="wiki-share-tree-item"]').length === 2`));
  await brC.shot(`${SHOTS}/5-public-mobile-drawer.png`);
  await click(brC, `[...${q('wiki-share-drawer')}.querySelectorAll('[data-testid="wiki-share-tree-item"]')].find((e) => e.innerText.trim() === 'Phạm vi')`, 1500);
  ok('điện thoại: chọn trang trong ngăn kéo → đóng ngăn kéo, mở trang con', (await text(brC, 'wiki-share-title')) === 'Phạm vi' && !(await has(brC, 'wiki-share-drawer')));
  await theme(brC, 'dark', `${url1}?page=${child.id}`);
  ok('điện thoại tối: không cuộn ngang', await noHScroll(brC));
  await brC.shot(`${SHOTS}/6-public-mobile-dark.png`);
  await desktop(brC);
  await theme(brC, 'light', url2);

  // ── Khách: link 2 có mật khẩu ──
  ok('mật khẩu: hiện ô nhập trước, chưa có nội dung', await has(brC, 'wiki-share-password') && !(await has(brC, 'wiki-share-article')));
  await setVal(brC, '[data-testid="wiki-share-password-input"]', 'sai-roi');
  await click(brC, q('wiki-share-unlock'), 1500);
  ok('mật khẩu sai → "Mật khẩu không đúng."', (await text(brC, 'wiki-share-password-error')) === 'Mật khẩu không đúng.');
  await brC.shot(`${SHOTS}/7-public-password-wrong.png`);
  await setVal(brC, '[data-testid="wiki-share-password-input"]', 'mat-khau-229');
  await click(brC, q('wiki-share-unlock'), 2500);
  ok('mật khẩu đúng → nội dung trang gốc, không cây (không kèm con)', (await text(brC, 'wiki-share-title')) === 'Đặc tả gửi khách' && !(await has(brC, 'wiki-share-tree')) && !(await has(brC, 'wiki-share-menu')));
  ok('watermark theo người nhận link 2', await brC.evalJs(`${q('wiki-share-watermark')}?.textContent.includes('Bản xem trước cho Chị Mật Khẩu') === true`));
  await brC.go(url2, 2500);
  ok('tải lại sau khi mở khoá → không hỏi lại (cookie riêng của link)', (await text(brC, 'wiki-share-title')) === 'Đặc tả gửi khách');
  await brC.go(`${url2}?page=${child.id}`, 2500);
  ok('?page=<con> ngoài bản chia sẻ → hiện trang gốc (bỏ qua id lạ)', (await text(brC, 'wiki-share-title')) === 'Đặc tả gửi khách');

  // ── Khách: quá số lần nhập sai (429) ──
  const url429 = `${BASE}/s/${l429.body.token}`;
  await brC.go(url429, 2500);
  for (let i = 0; i < 5; i++) {
    await setVal(brC, '[data-testid="wiki-share-password-input"]', `sai-${i}`);
    await click(brC, q('wiki-share-unlock'), 900);
  }
  await setVal(brC, '[data-testid="wiki-share-password-input"]', 'dung-roi-123');
  await click(brC, q('wiki-share-unlock'), 1200);
  ok('sai 5 lần → lần sau báo chờ 15 phút (kể cả mật khẩu đúng)', (await text(brC, 'wiki-share-password-error'))?.includes('chờ 15 phút') === true, await text(brC, 'wiki-share-password-error'));

  // ── Token lạ / đếm ngược về 0 ──
  await brC.go(`${BASE}/s/${'x'.repeat(43)}`, 2500);
  ok('token lạ → "Link không tồn tại"', (await text(brC, 'wiki-share-gone'))?.includes('Link không tồn tại') === true);
  sql(`update projects.wiki_share_links set "ExpiresAt" = now() + interval '6 seconds' where "Id" = '${l0.body.id}'`);
  await brC.go(`${BASE}/s/${l0.body.token}`, 2500);
  ok('link sắp hết hạn: mở được, đếm ngược giây', (await text(brC, 'wiki-share-title')) === 'Phạm vi' && /Hết hạn sau\s+0:0\d/.test((await text(brC, 'wiki-share-countdown')) ?? ''),
    await text(brC, 'wiki-share-countdown'));
  ok('đếm ngược về 0 → "Link đã hết hạn hoặc bị thu hồi" (không cần tải lại)', await waitFor(brC, `${q('wiki-share-gone')}?.innerText.includes('Link đã hết hạn hoặc bị thu hồi')`, 10000));

  // ── PM: chuông + nhật ký xem ──
  await brA.go(URL_ROOT, 3500);
  await clickAt(brA, q('notification-bell'));
  ok('chuông: nhãn "Khách đã mở link chia sẻ sổ tay"', await waitFor(brA, `[...document.querySelectorAll('[data-testid="notification-label"]')].some((e) => e.innerText === 'Khách đã mở link chia sẻ sổ tay')`),
    await brA.evalJs(`[...document.querySelectorAll('[data-testid="notification-item"]')].map((e) => e.innerText)`));
  await brA.shot(`${SHOTS}/8-bell-label.png`);
  await brA.go(`${BASE}/projects/${P}?tab=overview`, 3000);
  await clickAt(brA, q('notification-bell'));
  await clickAt(brA, `[...document.querySelectorAll('[data-testid="notification-item"]')].find((e) => e.innerText.includes('Khách đã mở link chia sẻ sổ tay') && e.innerText.includes('Đặc tả gửi khách'))`);
  await brA.sleep(2500);
  ok('bấm thông báo → mở đúng trang sổ tay đó', await brA.evalJs(`new URL(location.href).searchParams.get('page') === ${JSON.stringify(root.id)}`) && (await text(brA, 'wiki-page-title')) === 'Đặc tả gửi khách');
  await clickAt(brA, q('wiki-share-open'));
  await waitFor(brA, `${q('wiki-share-list')}`);
  ok('danh sách: link 1 có lượt xem + "xem cuối"', await brA.evalJs(`(() => { const m = [...document.querySelectorAll('[data-testid="wiki-share-item"]')].find((e) => e.innerText.includes('Anh Khách'));
    return !!m && /[1-9]\\d* lượt xem/.test(m.innerText) && m.innerText.includes('xem cuối'); })()`), await brA.evalJs(`[...document.querySelectorAll('[data-testid="wiki-share-item"]')].map((e) => e.innerText)`));
  await click(brA, `[...document.querySelectorAll('[data-testid="wiki-share-item"]')].find((e) => e.innerText.includes('Anh Khách')).querySelector('[data-testid="wiki-share-views-open"]')`, 1500);
  ok('nhật ký xem: dòng có giờ VN, IP, trình duyệt HeadlessChrome', await waitFor(brA, `document.querySelectorAll('[data-testid="wiki-share-view-row"]').length > 0`)
    && await brA.evalJs(`(() => { const r = document.querySelector('[data-testid="wiki-share-view-row"]'); const t = r.innerText;
      return /\\d{2}\\/\\d{2}\\/\\d{4} \\d{2}:\\d{2}/.test(t) && /(127\\.0\\.0\\.1|::1)/.test(t) && t.includes('HeadlessChrome'); })()`),
    await brA.evalJs(`[...document.querySelectorAll('[data-testid="wiki-share-view-row"]')].map((e) => e.innerText).slice(0, 2)`));
  await brA.shot(`${SHOTS}/9-views-log.png`);
  await brA.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await brA.sleep(600);

  // ── PM: thu hồi link 1 → khách thấy hết hạn ──
  ok('hộp thoại chia sẻ vẫn mở sau khi đóng nhật ký', await has(brA, 'wiki-share-dialog'));
  await click(brA, `[...document.querySelectorAll('[data-testid="wiki-share-item"]')].find((e) => e.innerText.includes('Anh Khách')).querySelector('[data-testid="wiki-share-revoke"]')`, 800);
  ok('thu hồi: hộp xác nhận', (await text(brA, 'confirm-dialog'))?.includes('Thu hồi link chia sẻ?') === true);
  await click(brA, q('confirm-dialog-ok'), 1800);
  ok('thu hồi xong: link 1 "Đã thu hồi", hết nút Thu hồi', await brA.evalJs(`(() => { const m = [...document.querySelectorAll('[data-testid="wiki-share-item"]')].find((e) => e.innerText.includes('Anh Khách'));
    return !!m && m.getAttribute('data-status') === 'revoked' && m.innerText.includes('Đã thu hồi') && !m.querySelector('[data-testid="wiki-share-revoke"]'); })()`));
  await theme(brA, 'dark', URL_ROOT);
  await clickAt(brA, q('wiki-share-open'));
  await waitFor(brA, `${q('wiki-share-list')}`);
  await brA.shot(`${SHOTS}/10-share-dialog-dark.png`);
  await brC.go(url1, 2500);
  ok('khách mở lại link đã thu hồi → "Link đã hết hạn hoặc bị thu hồi"', (await text(brC, 'wiki-share-gone'))?.includes('Link đã hết hạn hoặc bị thu hồi') === true);
  await brC.shot(`${SHOTS}/11-public-revoked.png`);

  // ── Điện thoại: hộp thoại chia sẻ của PM ──
  await brA.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await mobile(brA);
  await theme(brA, 'light', URL_ROOT);
  ok('điện thoại: nút "Chia sẻ" hiện', await waitFor(brA, `${q('wiki-share-open')}?.offsetParent`), await brA.evalJs(`document.body.innerText.slice(0, 400)`));
  ok('điện thoại: hàng nút trang sổ tay xuống dòng, không cuộn ngang', await noHScroll(brA));
  await brA.shot(`${SHOTS}/12a-wiki-page-mobile.png`);
  await clickAt(brA, q('wiki-share-open'));
  ok('điện thoại: hộp thoại chia sẻ vừa màn hình', await waitFor(brA, `${q('wiki-share-list')}`)
    && await brA.evalJs(`(() => { const b = ${q('wiki-share-dialog')}.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth + 1; })()`));
  await brA.shot(`${SHOTS}/12-share-dialog-mobile.png`);

  ok('không lỗi console (PM)', errorsOf(brA).length === 0, errorsOf(brA));
  ok('không lỗi console (thành viên)', errorsOf(brB).length === 0, errorsOf(brB));
  ok('không lỗi console (khách, trừ 4xx cố ý)', errorsOf(brC).length === 0, errorsOf(brC));
} catch (e) {
  ok('không có ngoại lệ', false, String(e));
} finally {
  brA.close(); brB.close(); brC.close();
}
console.log(`\n${pass}/${pass + fail} đạt · ảnh: ${SHOTS}`);
process.exit(fail ? 1 : 0);
