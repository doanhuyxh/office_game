// E2E TEST-138 trang chi tiết dự án: đầu trang gọn (1 dòng tóm tắt mô tả, không Markdown thô) + tab "Tổng quan" (mô tả Markdown + thông tin nhanh, link sang tab),
// dự án không mô tả ("Thêm mô tả" chỉ quản lý — người xem nhờ phòng ban không thấy), ô mô tả trong hộp Sửa là MarkdownEditor (Viết / Xem trước),
// link chuông ?task=… vẫn mở tab Công việc + hộp thoại việc, điện thoại 390 px, theme tối. Ảnh vào SHOTS_DIR (tuỳ chọn).
// CHỈ DB tạm. Api (backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5280
//   'ConnectionStrings__Default=Host=127.0.0.1;Port=55438;Database=e2e;Username=e2e;Password=e2e' Seed__AdminEmail=… Seed__AdminPassword=…
//   Telegram__ApiUrl=http://127.0.0.1:9 Smtp__Host=127.0.0.1 Smtp__Port=1 dotnet run --project src/OfficeHub.Api --no-launch-profile
// Vite (frontend/): VITE_API_TARGET=http://localhost:5280 bunx vite --port 5175 --strictPort
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5280 BASE_URL=http://localhost:5175 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/project-overview-e2e.ts
// Không bật Realtime → lỗi kết nối hub chat (negotiation) bị bỏ qua. Đăng nhập ~8 lần.
import { BASE, launch } from './cdp';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5280';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
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
const SHOTS = process.env.SHOTS_DIR;

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV OV ${stamp}`, level: 7, financePermissions: 0 })).body;
const deptA = (await json(admin, 'POST', '/api/org/departments', { name: `Dự án OV ${stamp}`, code: `OA${stamp}` })).body;
const deptB = (await json(admin, 'POST', '/api/org/departments', { name: `Kinh doanh OV ${stamp}`, code: `OB${stamp}` })).body;
const mkEmp = async (code: string, name: string, user: string, roles: string[], dept: string) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW), user };
};
const PM = await mkEmp(`OM${stamp}`, 'Quản Lý OV', `e2e.ov.pm.${stamp}`, ['employee', 'manager'], deptA);
const Dev = await mkEmp(`OD${stamp}`, 'Dev OV', `e2e.ov.dev.${stamp}`, ['employee'], deptA);
const Viewer = await mkEmp(`OX${stamp}`, 'Người xem OV', `e2e.ov.view.${stamp}`, ['employee'], deptB);
const DESC = '**Mục tiêu:** xây cửa hàng _online_ bán đồ gia dụng cho khách SHOP, chạy trên web và điện thoại, thanh toán qua cổng VNPay và chuyển khoản ngân hàng.\n\n'
  + '## Phạm vi\n- Trang sản phẩm, giỏ hàng\n- Thanh toán **VNPay**\n- Quản trị đơn hàng\n\n'
  + Array.from({ length: 12 }, (_, i) => `${i + 1}. Hạng mục chi tiết số ${i + 1} của dự án`).join('\n');
const A = (await json(PM.cookie, 'POST', '/api/projects', { code: `ov-${stamp}`, name: 'Cửa hàng OV', kind: 'Internal', startOn: today, endOn: '2027-03-31', budgetManDays: 40,
  description: DESC, departmentIds: [deptA, deptB], leadDepartmentId: deptA, memberIds: [Dev.e.id] })).body as string;
const B = (await json(PM.cookie, 'POST', '/api/projects', { code: `ow-${stamp}`, name: 'Không mô tả OV', kind: 'Internal', startOn: today,
  departmentIds: [deptB], leadDepartmentId: deptB, memberIds: [] })).body as string;
// C: không mô tả, chỉ phòng ban B tham gia → người xem nhờ phòng ban (B được sửa mô tả trong bài)
const C = (await json(PM.cookie, 'POST', '/api/projects', { code: `oz-${stamp}`, name: 'Chỉ đọc OV', kind: 'Internal', startOn: today,
  departmentIds: [deptB], leadDepartmentId: deptB, memberIds: [] })).body as string;
const T = (await json(PM.cookie, 'POST', `/api/projects/${A}/tasks`, { title: 'Việc mở từ chuông OV', assigneeEmployeeId: Dev.e.id })).body as string;
await json(PM.cookie, 'POST', `/api/projects/${A}/tasks`, { title: 'Việc thứ hai OV', assigneeEmployeeId: Dev.e.id });
ok('dựng dữ liệu (3 dự án, 2 việc)', typeof A === 'string' && typeof B === 'string' && typeof C === 'string' && typeof T === 'string', { A, B, T });

type Br = Awaited<ReturnType<typeof launch>>;
const until = async (br: Br, js: string, ms = 8000) => { for (let i = 0; i < ms / 250; i++) { if (await br.evalJs(js)) return true; await br.sleep(250); } return false; };
const click = (sel: string, text?: string) => `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => ${text ? `e.textContent.trim().startsWith(${JSON.stringify(text)})` : 'true'}); el?.click(); return !!el; })()`;
const jsErr = (errs: string[]) => errs.filter((e) => !/negotiation|Failed to start the connection|WebSocket|\/rt\//.test(e));

const br = await launch(9381, `${tmpdir()}/officehub-ov-${Date.now()}`, 1440, 900);
try {
  ok('quản lý đăng nhập web', (await br.login(PM.user, PW)) === 200);
  await br.go(`${BASE}/projects/${A}`, 3500);
  ok('trang dự án tải', await until(br, `!!document.querySelector('[data-testid="project-summary"]')`));
  const head = await br.evalJs(`(() => { const s = document.querySelector('[data-testid="project-summary"]'); const t = s.querySelector('span');
    return { text: t.textContent, h: s.getBoundingClientRect().height, clamp: getComputedStyle(t).webkitLineClamp }; })()`) as any;
  ok('đầu trang: 1 dòng tóm tắt, bỏ ký hiệu Markdown', head.text.startsWith('Mục tiêu: xây cửa hàng online') && !/[*_#]/.test(head.text), head);
  ok('… ≤ 120 ký tự, line-clamp-1, cao 1 dòng', head.text.length <= 120 && head.clamp === '1' && head.h < 30, head);
  ok('đầu trang không còn mô tả đầy đủ (phạm vi / hạng mục)', !(await br.evalJs(`document.body.innerText.includes('Hạng mục chi tiết số 5')`)));
  const gap = await br.evalJs(`(() => { const tl = document.querySelector('[role=tablist]').getBoundingClientRect(); const col = document.querySelector('[data-testid^="col-"]').getBoundingClientRect();
    return { tabsTop: Math.round(tl.top), tabsBottom: Math.round(tl.bottom), boardTop: Math.round(col.top) }; })()`) as any;
  ok('kanban bắt đầu ngay dưới hàng tab (≤ 80 px), hàng tab ở nửa trên màn hình (< 300 px)', gap.boardTop - gap.tabsBottom <= 80 && gap.tabsTop < 300, gap);
  const tabs = await br.evalJs(`[...document.querySelectorAll('[role=tab]')].map(t => t.textContent.trim())`) as string[];
  ok('tab "Tổng quan" đứng sau "Công việc"', tabs[0].startsWith('Công việc') && tabs[1] === 'Tổng quan' && tabs[2] === 'Hướng dẫn', tabs);
  if (SHOTS) await br.shot(`${SHOTS}/1-header-tasks.png`);

  ok('bấm "Xem tổng quan" → tab overview', await br.evalJs(click('[data-testid="project-summary"] button'))
    && await until(br, `location.search.includes('tab=overview') && !!document.querySelector('[data-testid="overview-description"]')`));
  const md = await br.evalJs(`(() => { const d = document.querySelector('[data-testid="overview-description"]'); return { strong: d.querySelectorAll('strong').length, li: d.querySelectorAll('li').length,
    h2: d.querySelectorAll('h2').length, raw: d.innerText.includes('**') }; })()`) as any;
  ok('Tổng quan: mô tả hiển thị Markdown (đậm, tiêu đề, danh sách), không còn "**"', md.strong >= 2 && md.li >= 15 && md.h2 === 1 && !md.raw, md);
  const facts = await br.evalJs(`document.querySelector('[data-testid="overview-facts"]').innerText`) as string;
  ok('thông tin nhanh: loại, phòng ban (chủ trì), thời gian, ngân sách, tiến độ, thành viên đúng số liệu',
    facts.includes('Nội bộ') && facts.includes(`Dự án OV ${stamp} (chủ trì)`) && facts.includes(`Kinh doanh OV ${stamp}`) && facts.includes('31/03/2027')
      && facts.includes('40 ngày công') && facts.includes('2 đang mở · 0 xong') && facts.includes('2 người'), facts);
  ok('phòng ban chủ trì in đậm', await br.evalJs(`[...document.querySelectorAll('[data-testid="overview-facts"] b')].some(b => b.textContent.includes('(chủ trì)'))`));
  const layout = await br.evalJs(`(() => { const d = document.querySelector('[data-testid="overview-description"]').getBoundingClientRect(); const f = document.querySelector('[data-testid="overview-facts"]').getBoundingClientRect();
    return { dW: Math.round(d.width), side: f.left > d.right }; })()`) as any;
  ok('máy tính: mô tả bên trái (≤ 48 rem), thông tin nhanh cột phải', layout.dW <= 768 && layout.side, layout);
  if (SHOTS) await br.shot(`${SHOTS}/2-overview.png`);
  ok('link "Thành viên →" sang tab members', await br.evalJs(click('[data-testid="overview-facts"] button', 'Thành viên')) && await until(br, `location.search.includes('tab=members')`));
  await br.go(`${BASE}/projects/${A}?tab=overview`, 2500);
  ok('link "Tiến độ →" sang tab Công việc', await br.evalJs(click('[data-testid="overview-facts"] button', 'Tiến độ'))
    && await until(br, `!location.search.includes('tab=') && !!document.querySelector('[data-testid^="col-"]')`));
  await br.go(`${BASE}/projects/${A}?tab=overview`, 2500);
  ok('link "Phòng ban →" sang tab Phụ lục', await br.evalJs(click('[data-testid="overview-facts"] button', 'Phòng ban')) && await until(br, `location.search.includes('tab=appendix')`));
  await br.go(`${BASE}/projects/${A}?tab=guide`, 2500);
  ok('tab Hướng dẫn giữ nguyên (khối work-guide, không chứa mô tả)', await until(br, `!!document.querySelector('[data-testid="work-guide"]')`)
    && !(await br.evalJs(`document.querySelector('[data-testid="work-guide"]').innerText.includes('Hạng mục chi tiết')`)));

  // Link chuông ?task=… → tab Công việc + hộp thoại việc (kể cả khi URL có tab=overview)
  await br.go(`${BASE}/projects/${A}?tab=overview&task=${T}`, 3500);
  ok('link chuông ?task=… mở tab Công việc + hộp thoại việc', await until(br, `(document.querySelector('[role=dialog]')?.innerText ?? '').includes('Việc mở từ chuông OV')`)
    && await br.evalJs(`!document.querySelector('[data-testid="project-overview"]')`));

  // Dự án không mô tả
  await br.go(`${BASE}/projects/${B}`, 3000);
  ok('dự án không mô tả: không có dòng tóm tắt', await until(br, `!!document.querySelector('[role=tablist]')`) && !(await br.evalJs(`!!document.querySelector('[data-testid="project-summary"]')`)));
  await br.go(`${BASE}/projects/${B}?tab=overview`, 2500);
  ok('Tổng quan: "Chưa có mô tả." + nút "Thêm mô tả" (quản lý)', await until(br, `(document.querySelector('[data-testid="overview-no-description"]')?.innerText ?? '').includes('Chưa có mô tả.')`)
    && await br.evalJs(`[...document.querySelectorAll('[data-testid="overview-no-description"] button')].some(b => b.textContent.includes('Thêm mô tả'))`));
  ok('bấm "Thêm mô tả" → mở hộp Sửa dự án', await br.evalJs(click('[data-testid="overview-no-description"] button'))
    && await until(br, `(document.querySelector('[role=dialog]')?.innerText ?? '').includes('Sửa dự án')`));
  const editor = await br.evalJs(`(() => { const dlg = document.querySelector('[role=dialog]'); return { previews: [...dlg.querySelectorAll('button')].filter(b => b.textContent === 'Xem trước').length,
    ta: dlg.querySelector('#pj-desc')?.tagName, max: dlg.querySelector('#pj-desc')?.getAttribute('maxlength') }; })()`) as any;
  ok('ô mô tả là MarkdownEditor (Viết / Xem trước), ≤ 2000 ký tự', editor.previews === 2 && editor.ta === 'TEXTAREA' && editor.max === '2000', editor);
  // Gõ mô tả Markdown → xem trước → lưu → tóm tắt hiện ở đầu trang
  await br.evalJs(`(() => { const ta = document.querySelector('#pj-desc'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(ta, '# Dự án **nội bộ** B\\n- dòng hai'); ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await br.sleep(300);
  await br.evalJs(`[...document.querySelectorAll('[role=dialog] button')].filter(b => b.textContent === 'Xem trước')[0].click()`);
  await br.sleep(300);
  ok('Xem trước mô tả hiển thị Markdown', await br.evalJs(`!!document.querySelector('[role=dialog] [data-testid="pj-col-text"] h1 strong')`));
  if (SHOTS) await br.shot(`${SHOTS}/3-edit-dialog.png`);
  await br.evalJs(click('[role=dialog] button[type=submit]'));
  ok('lưu → đầu trang hiện tóm tắt "Dự án nội bộ B"', await until(br, `(document.querySelector('[data-testid="project-summary"] span')?.textContent ?? '') === 'Dự án nội bộ B'`, 10000));
  ok('… Tổng quan hiện mô tả mới (h1)', await until(br, `!!document.querySelector('[data-testid="overview-description"] h1')`));

  // Theme sáng / tối
  await br.evalJs(`localStorage.setItem('officehub:theme', 'light')`);
  await br.go(`${BASE}/projects/${A}?tab=overview`, 3000);
  ok('theme sáng: không có class dark, mô tả hiển thị', !(await br.evalJs(`document.documentElement.classList.contains('dark')`))
    && await until(br, `!!document.querySelector('[data-testid="overview-description"] strong')`));
  if (SHOTS) await br.shot(`${SHOTS}/4-overview-light.png`);
  await br.evalJs(`localStorage.setItem('officehub:theme', 'dark')`);
  await br.go(`${BASE}/projects/${A}?tab=overview`, 3000);
  ok('theme tối: trang có class dark, mô tả hiển thị', await br.evalJs(`document.documentElement.classList.contains('dark')`)
    && await until(br, `!!document.querySelector('[data-testid="overview-description"] strong')`));
  if (SHOTS) await br.shot(`${SHOTS}/4-overview-dark.png`);
  await br.evalJs(`localStorage.setItem('officehub:theme', 'light')`);
  ok('không lỗi JS (quản lý)', jsErr(br.errors).length === 0, jsErr(br.errors).slice(0, 3));
} finally { br.close(); }

// Người xem nhờ phòng ban (chỉ đọc) — điện thoại 390 px
const ph = await launch(9382, `${tmpdir()}/officehub-ov-m-${Date.now()}`, 390, 844);
try {
  ok('người xem nhờ phòng ban đăng nhập', (await ph.login(Viewer.user, PW)) === 200);
  await ph.go(`${BASE}/projects/${C}?tab=overview`, 3500);
  ok('người xem nhờ phòng ban: "Chưa có mô tả." nhưng KHÔNG có nút "Thêm mô tả"',
    await until(ph, `(document.querySelector('[data-testid="overview-no-description"]')?.innerText ?? '').includes('Chưa có mô tả.')`)
    && !(await ph.evalJs(`document.body.innerText.includes('Thêm mô tả')`)) && await ph.evalJs(`!!document.querySelector('[data-testid="via-department"]')`));
  await ph.go(`${BASE}/projects/${A}`, 3500);
  const m = await ph.evalJs(`(() => { const s = document.querySelector('[data-testid="project-summary"]'); return { h: s?.getBoundingClientRect().height, sw: document.documentElement.scrollWidth }; })()`) as any;
  ok('điện thoại: tóm tắt 1 dòng, trang không tràn ngang', m.h != null && m.h < 30 && m.sw <= 392, m);
  if (SHOTS) await ph.shot(`${SHOTS}/5-mobile-header.png`);
  await ph.go(`${BASE}/projects/${A}?tab=overview`, 3000);
  const ml = await ph.evalJs(`(() => { const d = document.querySelector('[data-testid="overview-description"]').getBoundingClientRect(); const f = document.querySelector('[data-testid="overview-facts"]').getBoundingClientRect();
    return { below: f.top >= d.bottom - 1, sw: document.documentElement.scrollWidth }; })()`) as any;
  ok('điện thoại: thông tin nhanh xuống dưới mô tả, không tràn ngang', ml.below && ml.sw <= 392, ml);
  if (SHOTS) await ph.shot(`${SHOTS}/6-mobile-overview.png`);
  ok('không lỗi JS (người xem, điện thoại)', jsErr(ph.errors).length === 0, jsErr(ph.errors).slice(0, 3));
} finally { ph.close(); }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
