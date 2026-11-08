// E2E giao diện Bảng tin (2 Chrome headless qua Vite): đăng bài bằng trình soạn thảo Tiptap (in đậm, @nhắc), chọn phạm vi phòng ban,
// bình luận + trả lời, cảm xúc, badge bài mới, bài ghim, người ngoài phạm vi không thấy bài.
// CHỈ chạy trên DB tạm (tạo nhân viên thật) + Vite phải ở :5173 (CORS bucket S3 chỉ cho localhost:5173):
//   Api: ASPNETCORE_URLS=http://localhost:5181 ConnectionStrings__Default="Host=127.0.0.1;Port=55433;…" … dotnet run --project src/OfficeHub.Api --no-launch-profile
//   FE (từ frontend/): VITE_API_TARGET=http://localhost:5181 bun run dev --port 5173
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5181 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/news-ui-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { launch, BASE } from './cdp';
import { totp } from './totp';
if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5181';
const envFile = Bun.file(new URL('../../.env', import.meta.url));
const env: Record<string, string> = (await envFile.exists()) ? Object.fromEntries((await envFile.text()).split('\n')
  .filter((l) => /^[A-Za-z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])) : {};
const ADMIN_LOGIN = process.env.ADMIN_LOGIN ?? env.Seed__AdminEmail, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? env.Seed__AdminPassword;
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => { cond ? pass++ : fail++; console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 400) : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith(name + '=')).at(-1) ?? '';
const login = async (login: string, password: string): Promise<string> => {
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password }) });
  const body = await r.json().catch(() => null) as any;
  if (r.status === 403 && body?.title === '2fa_required') {
    const r2 = await fetch(`${API}/api/auth/login/2fa`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookieOf(r, 'officehub.2fa') },
      body: JSON.stringify({ code: totp(keys[login] ?? ''), isRecoveryCode: false, rememberMe: true }) });
    return cookieOf(r2, 'officehub.auth');
  }
  let cookie = cookieOf(r, 'officehub.auth');
  if (r.ok && body?.mustSetupTwoFactor) {
    const post = async (path: string, b: unknown) => { const x = await fetch(API + path, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(b) }); cookie = cookieOf(x, 'officehub.auth') || cookie; return x.json().catch(() => null) as any; };
    const s = await post('/api/auth/2fa/setup', {});
    await post('/api/auth/2fa/enable', { code: totp(s?.sharedKey ?? '') });
    keys[login] = s.sharedKey; writeFileSync(KEYS_FILE, JSON.stringify(keys));
  }
  return cookie;
};
const json = async (cookie: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const PW = 'E2e-Local-2026', MAIL = 'officehub.test';
const stamp = Date.now().toString(36);
const mkDept = async (name: string, code: string) => {
  const r = await json(admin, 'POST', '/api/org/departments', { name, code, parentId: null, headEmployeeId: null, mapZone: null, sortOrder: 0 });
  return typeof r.body === 'string' ? r.body : r.body.id as string;
};
const mkEmp = async (code: string, name: string, user: string, departmentId: string | null) => {
  const r = await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@${MAIL}`, phone: null, dateOfBirth: null, departmentId, positionId: null, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null });
  if (r.status >= 300) throw new Error(`Tạo ${code} lỗi: ${JSON.stringify(r.body)}`);
  const e = r.body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c0 = await login(user, acc.tempPassword);
  await json(c0, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, user, name };
};
const D = await mkDept(`Khối UI ${stamp}`, `U1${stamp.slice(-4)}`);
const A = await mkEmp(`NV7${stamp.slice(-3)}1`, 'Nguyễn Giao Diện', `e2e.ui.a.${stamp}`, D);
const B = await mkEmp(`NV7${stamp.slice(-3)}2`, 'Trần Thị Bích', `e2e.ui.b.${stamp}`, D);
const C = await mkEmp(`NV7${stamp.slice(-3)}3`, 'Lê Ngoài Phòng', `e2e.ui.c.${stamp}`, null);

const shots = `${tmpdir()}/officehub-news-ui`;
const a = await launch(9301, `${tmpdir()}/chr-news-a-${stamp}`);
const b = await launch(9302, `${tmpdir()}/chr-news-b-${stamp}`);
const c = await launch(9303, `${tmpdir()}/chr-news-c-${stamp}`);
try {
  ok('3 cửa sổ đăng nhập', (await a.login(A.user, PW)) === 200 && (await b.login(B.user, PW)) === 200 && (await c.login(C.user, PW)) === 200);
  await a.go(`${BASE}/news`, 3000);
  ok('A mở /news: thấy ô soạn bài', await a.evalJs(`!!document.querySelector('[data-testid="open-composer"]')`));

  // ---------- Đăng bài bằng trình soạn thảo ----------
  await a.evalJs(`document.querySelector('[data-testid="open-composer"]').click()`);
  await a.sleep(2500); // chờ chunk Tiptap (lazy load)
  ok('hộp soạn bài mở, trình soạn thảo Tiptap đã tải', await a.evalJs(`!!document.querySelector('[data-testid="post-editor"].ProseMirror')`));
  // Gõ chữ qua bàn phím thật để ProseMirror nhận
  await a.evalJs(`document.querySelector('[data-testid="post-editor"]').focus()`);
  for (const ch of 'Xin chao ca nha, ban tin moi!') await a.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch });
  await a.sleep(300);
  ok('chữ đã vào editor', ((await a.evalJs(`document.querySelector('[data-testid="post-editor"]').textContent`)) as string).includes('Xin chao ca nha'));
  // In đậm: chọn hết rồi bấm nút
  await a.evalJs(`document.execCommand && document.getSelection().selectAllChildren(document.querySelector('[data-testid="post-editor"]'))`);
  await a.evalJs(`[...document.querySelectorAll('button[aria-label="In đậm"]')][0].click()`);
  await a.sleep(400);
  await a.evalJs(`document.querySelector('[data-testid="submit-post"]').click()`);
  await a.sleep(3000);
  ok('đăng xong: hộp thoại đóng, bài hiện trong feed', (await a.evalJs(`!document.querySelector('[data-testid="composer-dialog"]')`)) && ((await a.evalJs(`document.body.innerText`)) as string).includes('Xin chao ca nha'));
  const postId = await a.evalJs(`document.querySelector('[data-testid="post-card"]')?.getAttribute('data-post-id')`);
  ok('bài có id', typeof postId === 'string' && postId.length > 10, postId);
  ok('nội dung in đậm được lưu (có <strong>)', ((await json(admin, 'GET', `/api/news/posts/${postId}`)).body.contentHtml as string).includes('<strong>'));
  await a.shot(`${shots}-a-feed.png`);

  // ---------- B thấy bài, thả cảm xúc, bình luận ----------
  await b.go(`${BASE}/news`, 3000);
  ok('B thấy bài của A', ((await b.evalJs(`document.body.innerText`)) as string).includes('Xin chao ca nha'));
  await b.evalJs(`document.querySelector('[data-testid="react-Love"]').click()`);
  await b.sleep(1200);
  ok('B thả cảm xúc ❤️ → nút hiện "Yêu thích"', ((await b.evalJs(`document.querySelector('[data-testid="react-button"]').textContent`)) as string).includes('Yêu thích'));
  await b.evalJs(`document.querySelector('[data-testid="toggle-comments"]').click()`);
  await b.sleep(1500);
  await b.evalJs(`(() => { const t = document.querySelector('[data-testid="comment-input"]'); t.focus(); return true; })()`);
  for (const ch of 'Hay qua anh oi') await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch });
  await b.sleep(300);
  await b.evalJs(`document.querySelector('[data-testid="comment-send"]').click()`);
  await b.sleep(2500);
  ok('B bình luận → hiện trong danh sách', ((await b.evalJs(`document.body.innerText`)) as string).includes('Hay qua anh oi'));
  const cs = (await json(admin, 'GET', `/api/news/posts/${postId}/comments`)).body;
  ok('bình luận lưu ở BE', cs.items?.some((x: any) => x.text === 'Hay qua anh oi'), cs.items?.map((x: any) => x.text));
  await b.shot(`${shots}-b-comment.png`);

  // ---------- Bài giới hạn phòng ban: C không thấy ----------
  const deptPost = await json(admin, 'POST', '/api/news/posts', { contentHtml: '<p>Chi khoi UI moi thay</p>', audience: 'Departments', targets: [{ kind: 'Department', id: D }], uploadIds: [], sendEmail: false, commentsDisabled: false });
  await b.go(`${BASE}/news`, 3000);
  await c.go(`${BASE}/news`, 3000);
  ok('bài phòng ban: B (trong phòng) thấy, C (ngoài phòng) không thấy', deptPost.status === 200
    && ((await b.evalJs(`document.body.innerText`)) as string).includes('Chi khoi UI moi thay')
    && !((await c.evalJs(`document.body.innerText`)) as string).includes('Chi khoi UI moi thay'));
  await c.go(`${BASE}/news/${deptPost.body.id}`, 3000);
  ok('C mở trực tiếp link bài ngoài phạm vi → trang "không tìm thấy"', !((await c.evalJs(`document.body.innerText`)) as string).includes('Chi khoi UI moi thay'));
  await c.shot(`${shots}-c-404.png`);

  // ---------- Bài ghim ----------
  await json(admin, 'POST', `/api/news/admin/posts/${postId}/pin`, { days: 3 });
  await b.go(`${BASE}/news`, 3000);
  ok('bài được ghim hiện nhãn "Bài được ghim" ở đầu feed', ((await b.evalJs(`document.querySelector('[data-testid="post-card"]').innerText`)) as string).includes('Bài được ghim'));

  // ---------- Badge bài mới ở menu ----------
  await json(admin, 'POST', '/api/news/posts', { contentHtml: '<p>Tin moi nhat cho badge</p>', audience: 'Company', targets: [], uploadIds: [], sendEmail: false, commentsDisabled: false });
  await c.go(`${BASE}/`, 3500);
  const badge = await c.evalJs(`(() => { const a = [...document.querySelectorAll('a')].find(x => x.textContent.includes('Bảng tin')); return a ? a.parentElement.innerText : null; })()`);
  ok('menu "Bảng tin" có badge số bài mới', typeof badge === 'string' && /\d/.test(badge), badge);
  ok('thẻ "Bảng tin" ở Tổng quan hiện bài mới', ((await c.evalJs(`document.body.innerText`)) as string).includes('Tin moi nhat cho badge'));
  await c.shot(`${shots}-c-dashboard.png`);
  await c.go(`${BASE}/news`, 3000);
  await c.sleep(1500);
  const badge2 = await c.evalJs(`(() => { const a = [...document.querySelectorAll('a')].find(x => x.textContent.includes('Bảng tin')); return a ? a.parentElement.innerText : null; })()`);
  ok('vào /news → badge biến mất', typeof badge2 === 'string' && !/\d/.test(badge2), badge2);

  const errs = [...a.errors, ...b.errors, ...c.errors].filter((e) => e && !/favicon|ResizeObserver|Download the React DevTools/i.test(e));
  ok('không có lỗi console', errs.length === 0, errs.slice(0, 4));
  console.log(`\nẢnh chụp: ${shots}-*.png`);
} finally {
  a.close(); b.close(); c.close();
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
