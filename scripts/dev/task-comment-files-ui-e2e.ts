// E2E giao diện TEST-153 (Chrome headless): ô bình luận việc — dán ảnh (Ctrl+V, sự kiện paste có File), chip xem trước + bỏ (×), chọn tệp PDF,
// gửi (nút loading) → ảnh thu nhỏ + chip tệp dưới bình luận, bấm ảnh → ImageViewer dùng chung, bình luận chỉ có tệp; ảnh từ S3 tạm tải được.
// CHỈ DB tạm + S3 tạm: dựng Api / Mcp như đầu task-comment-files-e2e.ts, rồi Vite: VITE_API_TARGET=http://localhost:5189 bunx vite --port 5179 (trong frontend/).
//   S3 tạm phải cho CORS PUT từ origin Vite (RustFS mặc định cho phép).
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5189 BASE_URL=http://localhost:5179 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/task-comment-files-ui-e2e.ts
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE, launch } from './cdp';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5189';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const SHOTS = process.env.SHOTS_DIR;
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 400) : ''}`);
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
    await post('/api/auth/2fa/enable', { code: totp(s.body?.sharedKey ?? '') });
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

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const posStaff = positions.find((p: any) => p.name === 'Chuyên viên') ?? positions[0];
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `UI tệp ${stamp}`, code: `UT${stamp}`.slice(0, 10) })).body;
const user = `e2e.tbui.${stamp}`;
const emp = (await json(admin, 'POST', '/api/org/employees', { code: `NV5${stamp}`.slice(0, 20), fullName: 'Người Dán Ảnh UI', email: `${user}@e2e.test`, phone: null,
  dateOfBirth: null, departmentId: dep, positionId: posStaff.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
const acc = (await json(admin, 'POST', `/api/org/employees/${emp.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
await json(await login(user, acc.tempPassword), 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
const P = (await json(admin, 'POST', '/api/projects', { code: `ui-${stamp}`, name: 'UI tệp bình luận', kind: 'Internal', startOn: today, memberIds: [emp.id], sequential: false })).body;
const T = (await json(admin, 'POST', `/api/projects/${P}/tasks`, { title: 'Việc dán ảnh', assigneeEmployeeId: emp.id })).body;
const taskId = typeof T === 'string' ? T : T?.id;
ok('nhân viên + dự án + việc', !!P && !!taskId);

const b = await launch(9353, mkdtempSync(join(tmpdir(), 'oh-ui153-')));
// S3 tạm (RustFS) chạy http + không trả header CORS, còn SDK luôn ký link https → CDP Fetch chặn request tới S3 tạm, Node gửi thay
// bằng http (chữ ký không gồm giao thức) rồi trả về trình duyệt kèm header CORS. Bucket thật có CORS + https → không cần bước này.
const CORS = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'GET, PUT' },
  { name: 'Access-Control-Allow-Headers', value: 'content-type' }];
b.on('Fetch.requestPaused', async (p: any) => {
  const req = p.request;
  if (req.method === 'OPTIONS') return b.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 204, responseHeaders: CORS });
  const url = String(req.url).replace(/^https:\/\/(127\.0\.0\.1|localhost)([:/])/, 'http://$1$2');
  const body = req.postDataEntries?.length ? Buffer.concat(req.postDataEntries.map((e: any) => Buffer.from(e.bytes ?? '', 'base64'))) : undefined;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers as Record<string, string>)) if (/^content-type$/i.test(k)) headers[k] = v;
  const res = await fetch(url, { method: req.method, headers, body });
  const data = Buffer.from(await res.arrayBuffer());
  const out = [...CORS, ...[...res.headers].filter(([k]) => /^content-(type|disposition)$/i.test(k)).map(([name, value]) => ({ name, value }))];
  return b.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: res.status, responseHeaders: out, body: data.toString('base64') });
});
await b.send('Fetch.enable', { patterns: [{ urlPattern: 'https://127.0.0.1*' }, { urlPattern: 'https://localhost*' }] });
try {
  ok('đăng nhập web', (await b.login(user, PW)) === 200);
  await b.go(`${BASE}/projects/${P}?task=${taskId}`, 4000);
  ok('mở hộp thoại việc có ô bình luận', await b.evalJs(`!!document.querySelector('[data-testid=task-comment-input]')`));

  // Dán ảnh: PNG nhỏ tạo bằng canvas → ClipboardEvent có File
  await b.evalJs(`(async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 160; const g = c.getContext('2d');
    g.fillStyle = '#e11d48'; g.fillRect(0, 0, 160, 160); g.fillStyle = '#2563eb'; g.fillRect(160, 0, 160, 160);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'anh-dan.png', { type: 'image/png' }));
    const ta = document.querySelector('[data-testid=task-comment-input]'); ta.focus();
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return true; })()`);
  await b.sleep(400);
  ok('dán ảnh → chip xem trước có ảnh', await b.evalJs(`(() => { const l = document.querySelector('[data-testid=task-comment-files]'); return !!l && l.textContent.includes('anh-dan.png') && !!l.querySelector('img'); })()`));
  // Chọn thêm PDF qua input file, rồi một tệp thứ ba và bỏ nó bằng ×
  await b.evalJs(`(() => {
    const inp = document.querySelector('[data-testid=task-comment-file-input]');
    const dt = new DataTransfer();
    dt.items.add(new File(['%PDF-1.4\\n%%EOF\\n'], 'bao-cao.pdf', { type: 'application/pdf' }));
    dt.items.add(new File(['tam'], 'bo-di.txt', { type: 'text/plain' }));
    inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await b.sleep(300);
  await b.evalJs(`document.querySelector('[aria-label="Bỏ bo-di.txt"]').click()`);
  await b.sleep(300);
  ok('chọn tệp + bỏ (×) → còn 2 chip', await b.evalJs(`document.querySelectorAll('[data-testid=task-comment-files] li').length`) === 2);
  // .exe bị chặn ở client
  await b.evalJs(`(() => { const inp = document.querySelector('[data-testid=task-comment-file-input]'); const dt = new DataTransfer();
    dt.items.add(new File(['MZ'], 'virus.exe')); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await b.sleep(300);
  ok('.exe không được thêm', await b.evalJs(`document.querySelectorAll('[data-testid=task-comment-files] li').length`) === 2);
  if (SHOTS) await b.shot(`${SHOTS}/153-before-send.png`);

  await b.evalJs(`document.querySelector('[data-testid=task-comment-send]').click()`);
  let done = false;
  for (let i = 0; i < 30 && !done; i++) { await b.sleep(300); done = await b.evalJs(`!!document.querySelector('[data-testid=task-comment-attachments]')`); }
  ok('gửi bình luận chỉ có tệp → hiện dưới bình luận', done, await b.evalJs(`[...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent).join(' | ')`));
  ok('ô chọn tệp được xoá sau khi gửi', await b.evalJs(`!document.querySelector('[data-testid=task-comment-files]')`));
  await b.sleep(1500);
  const img = await b.evalJs(`(() => { const i = document.querySelector('[data-testid=task-comment-image] img'); return i ? { ok: i.complete && i.naturalWidth > 0, w: i.naturalWidth } : null; })()`);
  ok('ảnh thu nhỏ tải được từ S3 (presigned)', img?.ok === true && img.w === 320, img);
  ok('chip PDF có tên + link', await b.evalJs(`(() => { const a = document.querySelector('[data-testid=task-comment-file]'); return !!a && a.textContent.includes('bao-cao.pdf') && a.href.includes('X-Amz-'); })()`));
  if (SHOTS) await b.shot(`${SHOTS}/153-after-send.png`);
  await b.evalJs(`document.querySelector('[data-testid=task-comment-image]')?.click()`);
  await b.sleep(800);
  const viewer = await b.evalJs(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].pop(); return d ? { text: d.textContent, img: !!d.querySelector('img[src*="X-Amz-"]') } : null; })()`);
  ok('bấm ảnh → mở ImageViewer (ảnh gốc + chú thích người viết)', !!viewer?.img && String(viewer.text).includes('Người Dán Ảnh UI'), viewer);
  if (SHOTS) await b.shot(`${SHOTS}/153-viewer.png`);
  const detail = (await json(await login(user, PW), 'GET', `/api/projects/tasks/${taskId}`)).body;
  ok('server lưu bình luận chỉ có 2 tệp, nội dung rỗng', detail?.comments?.[0]?.content === '' && detail.comments[0].attachments?.length === 2, detail?.comments);
  // Realtime (SignalR) không chạy trong e2e này → bỏ lỗi kết nối hub
  const errs = b.errors.filter((e) => !/negotiation|start the connection/i.test(e));
  ok('không lỗi console (ngoài kết nối Realtime)', errs.length === 0, errs);
} finally {
  b.close();
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
