// E2E TEST-175: link tải tệp từ thiết bị khác cho bình luận việc — REST (+ Chrome cho trang công khai / hộp thoại).
// Tạo link (thành viên dự án, web; hạn 15 / 60 / 1440 phút, khác → 400; token AI → 403; người ngoài 404) → trang công khai chỉ mã việc
// → xin vé bằng token (không cookie) → PUT S3 → POST bình luận: đứng tên người tạo link, viaUploadLink, DB lưu id link + IP + User-Agent;
// vé link không dùng được ở web và ngược lại; ≤ 5 tệp / lần, .exe chặn, ≤ 50 tệp / link; thu hồi / hết hạn / người tạo rời dự án / dự án đóng → 410;
// token sai / đoán → 404; xoá việc → link 404. UI (UI=1): trang /u/{token} trên điện thoại 390×844 (sáng + tối), chọn tệp + ghi chú → Gửi →
// danh sách đã gửi; hộp thoại "Tải từ thiết bị khác" trong việc (QR, link, thu hồi) + nhãn "Qua link tải lên" dưới bình luận.
// TẠO DỮ LIỆU THẬT → CHỈ DB tạm + S3 tạm (RustFS) — dựng như đầu task-comment-files-e2e.ts (Api không cần Mcp), Vite: VITE_API_TARGET=<Api> bunx vite --port 5181.
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5195 BASE_URL=http://localhost:5181 PG_URL=postgres://e2e:e2e@127.0.0.1:15475/e2e ADMIN_LOGIN=… ADMIN_PASSWORD=…
//   UI=1 SHOTS_DIR=<thư mục ảnh> bun scripts/dev/task-upload-link-e2e.ts
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQL } from 'bun';
import { BASE, launch } from './cdp';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5195';
const PG_URL = process.env.PG_URL ?? '';
if (PG_URL && !/@(127\.0\.0\.1|localhost)[:/]/.test(PG_URL)) throw new Error('PG_URL chỉ được trỏ DB tạm trên máy (127.0.0.1)');
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const SHOTS = process.env.SHOTS_DIR;
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
const json = async (cookie: string, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
  const r = await fetch(API + path, { method, headers: { ...(cookie ? { cookie } : {}), 'content-type': 'application/json', ...extra },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
/** Gọi endpoint công khai: KHÔNG cookie, như điện thoại chưa đăng nhập. */
const pub = (method: string, path: string, body?: unknown) => json('', method, `/api/projects/public/upload-links/${path}`, body, { 'user-agent': 'E2E-Phone/1.0 (TEST-175)' });
const PW = 'E2e-Local-2026';
const s3url = (u: string) => u.replace(/^https:\/\/(127\.0\.0\.1|localhost)([:/])/, 'http://$1$2');
const stamp = Date.now().toString(36).slice(-5);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
/** Xin vé qua link → PUT → trả id vé. */
const upload = async (token: string, name: string, data: Uint8Array) => {
  const t = await pub('POST', `${token}/uploads`, { fileName: name, size: data.length });
  if (t.status !== 200) return { status: t.status, body: t.body, id: '' };
  const put = await fetch(s3url(t.body.url), { method: 'PUT', headers: { 'content-type': t.body.contentType }, body: data });
  return { status: put.status, body: t.body, id: t.body.id as string };
};

// ---------- Chuẩn bị: H (thành viên, tạo link), M (thành viên khác), O (ngoài dự án), B (bot có token AI) ----------
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const posStaff = positions.find((p: any) => p.name === 'Chuyên viên') ?? positions[0];
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `Link tải lên ${stamp}`, code: `LT${stamp}`.slice(0, 10) })).body;
let seq = 700 + Math.floor(Math.random() * 90);
const mkEmp = async (name: string, user: string) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code: `NV${seq++}${stamp}`.slice(0, 20), fullName: name, email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: dep, positionId: posStaff.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const t = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `Agent ${user}`, expiresInDays: 30 })).body;
  return { e, cookie, token: t?.token as string, name, user };
};
const H = await mkEmp('Người Tạo Link', `e2e.ulh.${stamp}`);
const M = await mkEmp('Thành Viên Khác', `e2e.ulm.${stamp}`);
const O = await mkEmp('Người Ngoài', `e2e.ulo.${stamp}`);
ok('3 tài khoản', [H, M, O].every((x) => !!x.cookie && x.token?.startsWith('ohk_')));
const P = (await json(admin, 'POST', '/api/projects', { code: `ul-${stamp}`, name: 'Link tải lên', kind: 'Internal', startOn: today, memberIds: [H.e.id, M.e.id], sequential: false })).body;
const mkTask = async (title: string) => { const t = (await json(admin, 'POST', `/api/projects/${P}/tasks`, { title, assigneeEmployeeId: M.e.id })).body; return typeof t === 'string' ? t : t?.id; };
const taskId = await mkTask('Ảnh hiện trường từ điện thoại');
const task2 = await mkTask('Việc sẽ bị xoá');
const taskCode = (await json(admin, 'GET', `/api/projects/tasks/${taskId}`)).body?.task?.code;
ok('dự án + 2 việc', !!P && !!taskId && !!task2 && !!taskCode, { P, taskId, task2, taskCode });

// ---------- Tạo link ----------
const create = (who: { cookie: string }, tid: string, minutes?: number) => json(who.cookie, 'POST', `/api/projects/tasks/${tid}/upload-links`, minutes === undefined ? {} : { minutes });
const L = await create(H, taskId);
const tokenA = L.body?.token as string;
const ttl = (new Date(L.body?.expiresAt).getTime() - Date.now()) / 60000;
ok('tạo link mặc định 1 giờ → token 43 ký tự base64url', L.status === 200 && /^[A-Za-z0-9_-]{43}$/.test(tokenA ?? '') && ttl > 58 && ttl <= 60.1, L);
for (const m of [15, 1440]) {
  const x = await create(H, taskId, m);
  const t = (new Date(x.body?.expiresAt).getTime() - Date.now()) / 60000;
  ok(`tạo link ${m} phút`, x.status === 200 && t > m - 2 && t <= m + 0.1, x);
  if (x.body?.id) await json(H.cookie, 'DELETE', `/api/projects/upload-links/${x.body.id}`);
}
ok('hạn khác 15 / 60 / 1440 → 400', (await create(H, taskId, 30)).status === 400);
ok('người ngoài dự án → 404', (await create(O, taskId)).status === 404);
ok('token AI (bot) → 403', (await json('', 'POST', `/api/projects/tasks/${taskId}/upload-links`, {}, { authorization: `Bearer ${H.token}` })).status === 403);
const mine = await json(H.cookie, 'GET', `/api/projects/tasks/${taskId}/upload-links`);
ok('danh sách link của tôi: 1 link còn hạn, không lộ token', mine.status === 200 && mine.body?.length === 1 && !JSON.stringify(mine.body).includes(tokenA), mine.body);
ok('thành viên khác không thấy link của H', (await json(M.cookie, 'GET', `/api/projects/tasks/${taskId}/upload-links`)).body?.length === 0);
if (PG_URL) {
  const sql = new SQL(PG_URL);
  const rows = await sql`SELECT "TokenHash" FROM projects.comment_upload_links WHERE "TaskId" = ${taskId}`;
  ok('DB chỉ giữ SHA-256 (64 hex), không giữ token', rows.length >= 1 && rows.every((r: any) => /^[0-9a-f]{64}$/.test(r.TokenHash) && r.TokenHash !== tokenA), rows);
  await sql.close();
}

// ---------- Trang công khai ----------
const info = await pub('GET', tokenA);
ok('trang công khai: chỉ mã việc + hạn + giới hạn', info.status === 200 && info.body?.taskCode === taskCode && info.body?.maxFiles === 50 && info.body?.maxFilesPerComment === 5
  && Object.keys(info.body).sort().join() === 'expiresAt,fileCount,maxFiles,maxFilesPerComment,taskCode', info.body);
ok('không lộ tên việc / id', !JSON.stringify(info.body).includes('hiện trường') && !JSON.stringify(info.body).includes(taskId));
ok('token sai dạng → 404', (await pub('GET', 'abc')).status === 404);
ok('token đúng dạng nhưng đoán → 404', (await pub('GET', 'A'.repeat(43))).status === 404);

const u1 = await upload(tokenA, 'hien-truong.png', PNG);
const u2 = await upload(tokenA, 'bien-ban.pdf', PDF);
ok('xin vé bằng token (không cookie) + PUT S3', u1.status === 200 && u2.status === 200 && String(u1.body?.url).includes('projects/comments'), [u1, u2]);
ok('.exe bị chặn', (await pub('POST', `${tokenA}/uploads`, { fileName: 'virus.exe', size: 10 })).status === 400);
ok('ảnh > 10 MB bị chặn', (await pub('POST', `${tokenA}/uploads`, { fileName: 'to.png', size: 11 * 1024 * 1024 })).status === 400);
ok('gửi không có tệp → 400', (await pub('POST', `${tokenA}/comments`, { content: 'chỉ chữ' })).status === 400);
// Vé link không gắn được ở web, vé web không gắn được qua link
ok('vé của link không dùng được ở web (dù cùng người)', (await json(H.cookie, 'POST', `/api/projects/tasks/${taskId}/comments`, { content: 'x', uploadIds: [u1.id] })).status === 400);
const webTicket = (await json(H.cookie, 'POST', `/api/projects/tasks/${taskId}/uploads`, { fileName: 'web.png', size: PNG.length })).body;
await fetch(s3url(webTicket.url), { method: 'PUT', headers: { 'content-type': 'image/png' }, body: PNG });
ok('vé web không gửi được qua link', (await pub('POST', `${tokenA}/comments`, { uploadIds: [webTicket.id] })).status === 400);
const sent = await pub('POST', `${tokenA}/comments`, { content: 'Ảnh chụp lúc 9h', uploadIds: [u1.id, u2.id] });
ok('gửi 2 tệp + ghi chú → 200, chỉ trả số tệp (không id)', sent.status === 200 && sent.body?.fileCount === 2 && Object.keys(sent.body).join() === 'fileCount', sent);
ok('dùng lại vé đã gửi → 400', (await pub('POST', `${tokenA}/comments`, { uploadIds: [u1.id] })).status === 400);
const det = (await json(M.cookie, 'GET', `/api/projects/tasks/${taskId}`)).body;
const cm = det?.comments?.find((c: any) => c.viaUploadLink);
ok('bình luận đứng tên người tạo link, viaUploadLink, không BOT', cm?.authorName === H.name && cm.byBot === false && cm.content === 'Ảnh chụp lúc 9h' && cm.attachments?.length === 2, cm);
ok('ảnh xem được qua link presigned', (await fetch(s3url(cm?.attachments?.[0]?.url ?? 'http://127.0.0.1:9'))).status === 200);
ok('H xoá được bình luận của mình (như bình luận thường)', (await json(H.cookie, 'GET', `/api/projects/tasks/${taskId}`)).body?.comments?.find((c: any) => c.id === cm?.id)?.canDelete === true);
const notes = (await json(M.cookie, 'GET', '/api/notifications?page=1&pageSize=20')).body;
ok('người làm việc nhận chuông "… bình luận việc"', JSON.stringify(notes).includes(`${H.name} bình luận việc ${taskCode}`), notes);
if (PG_URL) {
  const sql = new SQL(PG_URL);
  const [row] = await sql`SELECT "UploadLinkId", "ClientIp", "UserAgent" FROM projects.task_comments WHERE "Id" = ${cm?.id}`;
  ok('DB lưu id link + IP + User-Agent (tra soát)', !!row?.UploadLinkId && !!row.ClientIp && row.UserAgent === 'E2E-Phone/1.0 (TEST-175)', row);
  await sql.close();
}
ok('API bình luận không trả IP / User-Agent', !JSON.stringify(det).includes('E2E-Phone'));
ok('số tệp đã gửi tăng (trang công khai + danh sách của tôi)', (await pub('GET', tokenA)).body?.fileCount === 2
  && (await json(H.cookie, 'GET', `/api/projects/tasks/${taskId}/upload-links`)).body?.[0]?.fileCount === 2);
// > 5 tệp một lần
const six: string[] = [];
for (let i = 0; i < 6; i++) six.push((await upload(tokenA, `a${i}.png`, PNG)).id);
ok('> 5 tệp / lần → 400', (await pub('POST', `${tokenA}/comments`, { uploadIds: six })).status === 400);

// ---------- Trần 50 tệp / link ----------
const L50 = (await create(H, taskId, 15)).body;
if (PG_URL) {
  const sql = new SQL(PG_URL);
  await sql`UPDATE projects.comment_upload_links SET "FileCount" = 49 WHERE "Id" = ${L50.id}`;
  await sql.close();
  ok('còn 1 chỗ → xin vé được', (await upload(L50.token, 'cuoi.png', PNG)).status === 200);
  const over = await pub('POST', `${L50.token}/uploads`, { fileName: 'thua.png', size: PNG.length });
  ok('quá 50 tệp / link (đã gửi + vé đang treo) → 429 báo rõ', over.status === 429 && String(over.body?.detail).includes('50'), over);
}

// ---------- Thu hồi / hết hạn / rời dự án / dự án đóng / xoá việc ----------
const LR = (await create(H, taskId)).body;
ok('người khác không thu hồi được link của H', (await json(M.cookie, 'DELETE', `/api/projects/upload-links/${LR.id}`)).status === 404);
ok('H thu hồi → 204', (await json(H.cookie, 'DELETE', `/api/projects/upload-links/${LR.id}`)).status === 204);
ok('link thu hồi: trang 410 + không xin vé được', (await pub('GET', LR.token)).status === 410 && (await pub('POST', `${LR.token}/uploads`, { fileName: 'a.png', size: 9 })).status === 410);
ok('link thu hồi biến khỏi danh sách', !(await json(H.cookie, 'GET', `/api/projects/tasks/${taskId}/upload-links`)).body?.some((x: any) => x.id === LR.id));
if (PG_URL) {
  const LE = (await create(H, taskId)).body;
  const sql = new SQL(PG_URL);
  await sql`UPDATE projects.comment_upload_links SET "ExpiresAt" = now() - interval '1 second' WHERE "Id" = ${LE.id}`;
  await sql.close();
  ok('link hết hạn → 410', (await pub('GET', LE.token)).status === 410);
}
const LD = (await create(H, task2)).body;
ok('link việc 2 chạy', (await pub('GET', LD.token)).status === 200);
await json(admin, 'DELETE', `/api/projects/tasks/${task2}`);
ok('xoá việc → link 404', (await pub('GET', LD.token)).status === 404);
// Rời dự án: bỏ H khỏi thành viên → link 410; thêm lại → chạy lại
const proj = (await json(admin, 'GET', `/api/projects/${P}`)).body;
const LM = (await create(H, taskId)).body;
// Dự án do admin (không phải nhân viên) tạo chưa có quản lý → thêm O làm quản lý để gỡ được H (phần "người ngoài" đã kiểm xong ở trên)
await json(admin, 'POST', `/api/projects/${P}/members`, { employeeIds: [O.e.id], role: 'Manager' });
const rm = await json(admin, 'DELETE', `/api/projects/${P}/members/${H.e.id}`);
const goneMember = await pub('GET', LM.token);
ok('người tạo bị gỡ khỏi dự án → 410', goneMember.status === 410, { rm: rm.status, goneMember });
await json(admin, 'POST', `/api/projects/${P}/members`, { employeeIds: [H.e.id] });
ok('thêm lại → link chạy lại (chưa hết hạn / thu hồi)', (await pub('GET', LM.token)).status === 200);

if (process.env.UI === '1') await ui(LM.token);

// Dự án đóng → 410 (để cuối)
const close = await json(admin, 'PUT', `/api/projects/${P}`, { code: proj.project.code, name: proj.project.name, kind: proj.project.kind, startOn: proj.project.startOn,
  sequential: false, status: 1 }); // ProjectStatus.Closed
ok('dự án đóng → link 410', (await pub('GET', LM.token)).status === 410, close);

async function ui(token: string) {
  // ---- Trang công khai trên điện thoại (không đăng nhập) ----
  const phone = await launch(9375, mkdtempSync(join(tmpdir(), 'oh-ui175p-')), 390, 844);
  const CORS = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'GET, PUT' },
    { name: 'Access-Control-Allow-Headers', value: 'content-type' }];
  // S3 tạm (RustFS) chạy http + không CORS, SDK ký https → CDP Fetch chặn request S3, Node gửi thay bằng http (như task-comment-files-ui-e2e.ts)
  const proxyS3 = (b: Awaited<ReturnType<typeof launch>>) => b.on('Fetch.requestPaused', async (p: any) => {
    const req = p.request;
    if (req.method === 'OPTIONS') return b.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 204, responseHeaders: CORS });
    const body = req.postDataEntries?.length ? Buffer.concat(req.postDataEntries.map((e: any) => Buffer.from(e.bytes ?? '', 'base64'))) : undefined;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers as Record<string, string>)) if (/^content-type$/i.test(k)) headers[k] = v;
    const res = await fetch(s3url(String(req.url)), { method: req.method, headers, body });
    const data = Buffer.from(await res.arrayBuffer());
    const out = [...CORS, ...[...res.headers].filter(([k]) => /^content-(type|disposition)$/i.test(k)).map(([name, value]) => ({ name, value }))];
    return b.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: res.status, responseHeaders: out, body: data.toString('base64') });
  });
  proxyS3(phone);
  await phone.send('Fetch.enable', { patterns: [{ urlPattern: 'https://127.0.0.1*' }, { urlPattern: 'https://localhost*' }] });
  await phone.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  try {
    await phone.go(`${BASE}/u/${token}`, 2500);
    await phone.evalJs(`localStorage.setItem('officehub:theme', 'light')`);
    await phone.go(`${BASE}/u/${token}`, 2500);
    const head = await phone.evalJs(`({ code: document.querySelector('[data-testid=upload-link-task]')?.textContent, cd: document.querySelector('[data-testid=upload-link-countdown]')?.textContent, path: location.pathname, body: document.body.innerText })`);
    ok('UI: trang công khai mở không cần đăng nhập, hiện mã việc + đếm ngược', head?.code === taskCode && /\d+:\d\d/.test(head?.cd ?? '') && head.path.startsWith('/u/'), head);
    ok('UI: không hiện tên việc', !String(head?.body).includes('hiện trường'));
    await phone.evalJs(`(async () => {
      const c = document.createElement('canvas'); c.width = 400; c.height = 300; const g = c.getContext('2d');
      g.fillStyle = '#16a34a'; g.fillRect(0, 0, 400, 300); g.fillStyle = '#fff'; g.font = '40px sans-serif'; g.fillText('Hiện trường', 60, 160);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const inp = document.querySelector('[data-testid=upload-link-file-input]'); const dt = new DataTransfer();
      dt.items.add(new File([blob], 'anh-dien-thoai.png', { type: 'image/png' }));
      dt.items.add(new File(['%PDF-1.4\\n%%EOF\\n'], 'bien-ban.pdf', { type: 'application/pdf' }));
      inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await phone.sleep(300);
    // Kéo-thả thêm một tệp vào trang
    await phone.evalJs(`(() => { const z = document.querySelector('[data-testid=upload-link-page]'); const dt = new DataTransfer();
      dt.items.add(new File(['ghi chu'], 'ghi-chu.txt', { type: 'text/plain' }));
      for (const t of ['dragenter', 'dragover', 'drop']) z.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true })); return true; })()`);
    await phone.sleep(300);
    ok('UI: chọn tệp + kéo-thả → 3 chip (ảnh có xem trước)', await phone.evalJs(`(() => { const l = document.querySelector('[data-testid=upload-link-files]'); return !!l && l.querySelectorAll('li').length === 3 && !!l.querySelector('img'); })()`));
    await phone.evalJs(`(() => { const t = document.querySelector('[data-testid=upload-link-note]'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      set.call(t, 'Ảnh từ điện thoại'); t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    if (SHOTS) await phone.shot(`${SHOTS}/175-phone-before-send.png`);
    await phone.evalJs(`document.querySelector('[data-testid=upload-link-send]').click()`);
    let done = false;
    for (let i = 0; i < 40 && !done; i++) { await phone.sleep(300); done = await phone.evalJs(`!!document.querySelector('[data-testid=upload-link-sent]')`); }
    ok('UI: Gửi → danh sách "Đã gửi" 3 tệp, ô chọn trống', done && await phone.evalJs(`document.querySelectorAll('[data-testid=upload-link-sent] li').length === 3 && !document.querySelector('[data-testid=upload-link-files]')`),
      await phone.evalJs(`[...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent).join(' | ')`));
    await phone.evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('mã QR'))?.click()`);
    await phone.sleep(300);
    ok('UI: có mã QR của chính link', await phone.evalJs(`!!document.querySelector('[data-testid=upload-link-self-qr] svg')`));
    if (SHOTS) await phone.shot(`${SHOTS}/175-phone-sent.png`);
    await phone.evalJs(`localStorage.setItem('officehub:theme', 'dark')`);
    await phone.go(`${BASE}/u/${token}`, 2500);
    ok('UI: theme tối', await phone.evalJs(`document.documentElement.classList.contains('dark')`));
    if (SHOTS) await phone.shot(`${SHOTS}/175-phone-dark.png`);
    await phone.go(`${BASE}/u/${'B'.repeat(43)}`, 2500);
    ok('UI: token đoán → "Link không tồn tại"', await phone.evalJs(`document.querySelector('[data-testid=upload-link-gone]')?.textContent.includes('không tồn tại')`));
    const errs = phone.errors.filter((e) => !/negotiation|start the connection|404|410/i.test(e));
    ok('UI: không lỗi console trên trang công khai', errs.length === 0, errs);
  } finally { phone.close(); }

  const det2 = (await json(H.cookie, 'GET', `/api/projects/tasks/${taskId}`)).body;
  const c2 = det2?.comments?.filter((c: any) => c.viaUploadLink).at(-1);
  ok('UI → server: bình luận 3 tệp + ghi chú, đứng tên H', c2?.attachments?.length === 3 && c2.content === 'Ảnh từ điện thoại' && c2.authorName === H.name, c2);

  // ---- Web: hộp thoại "Tải từ thiết bị khác" + nhãn dưới bình luận (máy tính, đăng nhập H) ----
  const pc = await launch(9376, mkdtempSync(join(tmpdir(), 'oh-ui175w-')), 1440, 900);
  proxyS3(pc);
  await pc.send('Fetch.enable', { patterns: [{ urlPattern: 'https://127.0.0.1*' }, { urlPattern: 'https://localhost*' }] });
  try {
    ok('UI web: đăng nhập H', (await pc.login(H.user, PW)) === 200);
    await pc.go(`${BASE}/projects/${P}?task=${taskId}`, 4500);
    ok('UI web: nhãn "Qua link tải lên" cạnh tên', await pc.evalJs(`[...document.querySelectorAll('[data-testid=upload-link-badge]')].length >= 2`));
    if (SHOTS) {
      await pc.evalJs(`[...document.querySelectorAll('[data-testid=upload-link-badge]')].at(-1)?.scrollIntoView({ block: 'center' })`);
      await pc.sleep(800);
      await pc.shot(`${SHOTS}/175-web-comment-badge.png`);
    }
    await pc.evalJs(`document.querySelector('[data-testid=task-comment-upload-link]').click()`);
    await pc.sleep(600);
    await pc.evalJs(`document.querySelector('[data-testid=upload-link-ttl-15]').click()`);
    await pc.evalJs(`document.querySelector('[data-testid=upload-link-create]').click()`);
    let made = false;
    for (let i = 0; i < 20 && !made; i++) { await pc.sleep(250); made = await pc.evalJs(`!!document.querySelector('[data-testid=upload-link-qr] svg')`); }
    const url = await pc.evalJs(`document.querySelector('[data-testid=upload-link-url]')?.value`);
    ok('UI web: tạo link 15 phút → QR + URL /u/{token}', made && new RegExp(`^${BASE}/u/[A-Za-z0-9_-]{43}$`).test(url ?? ''), url);
    ok('UI web: danh sách link còn hạn khác', await pc.evalJs(`!!document.querySelector('[data-testid=upload-link-list]')`));
    if (SHOTS) await pc.shot(`${SHOTS}/175-web-dialog.png`);
    await pc.evalJs(`document.querySelector('[data-testid=upload-link-revoke]').click()`);
    await pc.sleep(500);
    await pc.evalJs(`document.querySelector('[role=alertdialog] button[type=submit]')?.click()`);
    let revoked = false;
    for (let i = 0; i < 20 && !revoked; i++) { await pc.sleep(250); revoked = await pc.evalJs(`!document.querySelector('[data-testid=upload-link-created]')`); }
    const tok = String(url).split('/u/')[1];
    ok('UI web: Thu hồi → link mới 410', revoked && (await pub('GET', tok)).status === 410);
    const errs = pc.errors.filter((e) => !/negotiation|start the connection/i.test(e));
    ok('UI web: không lỗi console (ngoài Realtime)', errs.length === 0, errs);
  } finally { pc.close(); }
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
