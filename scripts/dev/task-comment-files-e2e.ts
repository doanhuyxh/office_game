// E2E TEST-153: ảnh / tệp đính kèm bình luận việc — vé tải lên của module Projects (presigned PUT, khoá S3 projects/comments/…),
// POST /comments nhận uploadIds (bình luận chỉ có tệp), CommentDto.attachments (link presigned), xem qua /comment-attachments/{id}(/preview),
// MCP: create_upload(target = task-comment) → PUT → comment_task(uploadIds) → bot khác get_task / list_task_comments thấy attachments (không link)
// → view_attachment(source = task-comment) nhìn được ảnh; người ngoài dự án 404; xoá bình luận / xoá việc → file S3 bị xoá; .exe / quá cỡ / vé người khác bị chặn.
// TẠO DỮ LIỆU THẬT → CHỈ DB tạm + S3 tạm (RustFS / MinIO trong docker — không cần bucket thật). Dựng như chat-attachment-view-e2e.ts:
//   docker run -d --name e2e153-pg -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=e2e -p 55473:5432 postgres:17-alpine
//   docker run -d --name e2e153-s3 -p 9473:9000 -e RUSTFS_ACCESS_KEY=e2eaccess -e RUSTFS_SECRET_KEY=e2esecret123 rustfs/rustfs   (+ tạo bucket e2e-files)
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5189
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=55473;Database=e2e;Username=e2e;Password=e2e' Encryption__Key=<base64 32 byte>
//        S3__Region=us-east-1 S3__ServiceUrl=http://127.0.0.1:9473 S3__ForcePathStyle=true S3__AccessKey=e2eaccess S3__SecretKey=e2esecret123
//        S3__BucketFiles=e2e-files S3__KeyPrefix=e2e/ Smtp__Host=127.0.0.1 Smtp__Port=1 Sentry__Dsn= Seq__Url= Chat__InternalKey=<≥32> (+ các Chat__*Key cùng giá trị)
//        Telegram__ApiUrl=http://127.0.0.1:9 Firebase__CredentialsPath= Database__MigrateOnStartup=true   (.env nạp NoClobber — không để Telegram / FCM thật)
//        Seed__AdminEmail=e2e153-admin@officehub-e2e.vn Seed__AdminPassword=E2e153-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   Mcp: env Mcp__ApiBaseUrl=http://localhost:5189 Mcp__RealtimeBaseUrl=http://127.0.0.1:9 ASPNETCORE_URLS=http://localhost:5203 dotnet run --project src/OfficeHub.Mcp --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5189 MCP_URL=http://localhost:5203/mcp ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/task-comment-files-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5189';
const MCP = process.env.MCP_URL ?? 'http://localhost:5203/mcp';
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
const tk = async (token: string, path: string, method = 'GET', body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, type: r.headers.get('content-type') ?? '', bytes: new Uint8Array(await r.arrayBuffer()) };
};
const PW = 'E2e-Local-2026';
/** SDK S3 luôn ký link https — S3 tạm chạy http trên máy → đổi giao thức cho link trỏ localhost. */
const s3url = (u: string) => u.replace(/^https:\/\/(127\.0\.0\.1|localhost)([:/])/, 'http://$1$2');
const stamp = Date.now().toString(36).slice(-5);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

// ---------- Ảnh thử: PNG RGBA tự sinh ----------
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Uint8Array) => {
  const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
  v.setUint32(0, data.length); out.set(new TextEncoder().encode(type), 4); out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};
const png = (w: number, h: number) => {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * (w * 4 + 1) + 1 + x * 4;
    raw[i] = x < w / 2 ? 220 : 30; raw[i + 1] = 60; raw[i + 2] = y < h / 2 ? 200 : 40; raw[i + 3] = 255;
  }
  const ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer);
  v.setUint32(0, w); v.setUint32(4, h); ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())];
  return new Uint8Array(parts.flatMap((p) => [...p]));
};
const jpegSize = (b: Uint8Array): [number, number] | null => {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
    if (m >= 0xc0 && m <= 0xc2) return [(b[i + 7] << 8) | b[i + 8], (b[i + 5] << 8) | b[i + 6]];
    i += 2 + len;
  }
  return null;
};
const IMG = png(1600, 800);
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

// ---------- Chuẩn bị: người thật H (thành viên), 2 bot B1 / B2 (thành viên), người ngoài O ----------
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const posStaff = positions.find((p: any) => p.name === 'Chuyên viên') ?? positions[0];
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `Tệp bình luận ${stamp}`, code: `TB${stamp}`.slice(0, 10) })).body;
let seq = 600 + Math.floor(Math.random() * 90);
const mkEmp = async (name: string, user: string) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code: `NV${seq++}${stamp}`.slice(0, 20), fullName: name, email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: dep, positionId: posStaff.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const t = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `Agent ${user}`, expiresInDays: 30 })).body;
  return { e, cookie, token: t?.token as string, name };
};
const H = await mkEmp('Người Dán Ảnh', `e2e.tbh.${stamp}`);
const B1 = await mkEmp('Bot Báo Cáo', `e2e.tbb1.${stamp}`);
const B2 = await mkEmp('Bot Đọc Báo Cáo', `e2e.tbb2.${stamp}`);
const O = await mkEmp('Người Ngoài Dự Án', `e2e.tbo.${stamp}`);
ok('4 tài khoản + token', [H, B1, B2, O].every((x) => x.token?.startsWith('ohk_')));
for (const b of [B1, B2]) await json(admin, 'PUT', `/api/org/employees/${b.e.id}/account/bot`, { isBot: true });
const code = `tb-${stamp}`;
const P = (await json(admin, 'POST', '/api/projects', { code, name: 'Tệp bình luận', kind: 'Internal', startOn: today, memberIds: [H.e.id, B1.e.id, B2.e.id], sequential: false })).body;
const T = (await json(admin, 'POST', `/api/projects/${P}/tasks`, { title: 'Báo cáo kèm ảnh', assigneeEmployeeId: B1.e.id })).body;
const taskId = typeof T === 'string' ? T : T?.id;
const T2 = (await json(admin, 'POST', `/api/projects/${P}/tasks`, { title: 'Việc sẽ bị xoá', assigneeEmployeeId: H.e.id })).body;
const task2 = typeof T2 === 'string' ? T2 : T2?.id;
ok('dự án + 2 việc', !!P && !!taskId && !!task2, { P, T, T2 });

// ---------- MCP ----------
let rid = 0;
const rpc = async (token: string, method: string, params: unknown = {}, profile = '') => {
  const res = await fetch(MCP + profile, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
  const text = await res.text();
  const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? text;
  try { return JSON.parse(data); } catch { return text; }
};
const call = async (token: string, name: string, args: Record<string, unknown> = {}) => {
  const x = await rpc(token, 'tools/call', { name, arguments: args });
  const content: any[] = x?.result?.content ?? [];
  const text = content[0]?.text ?? '';
  let j: any = null;
  try { j = JSON.parse(text); } catch { /* lỗi chữ */ }
  return { err: !!x?.result?.isError, j, text, content };
};
const taskProfile: string[] = ((await rpc(B1.token, 'tools/list', {}, '?profile=task'))?.result?.tools ?? []).map((t: any) => t.name);
ok('hồ sơ task có create_upload + view_attachment (89 tool)', taskProfile.includes('create_upload') && taskProfile.includes('view_attachment') && taskProfile.length === 89,
  taskProfile.length);

// B1: create_upload(task-comment) theo mã việc → PUT (như lệnh curl) → comment_task chỉ có tệp
const taskCode = (await json(admin, 'GET', `/api/projects/tasks/${taskId}`)).body?.task?.code;
const cu = await call(B1.token, 'create_upload', { target: 'task-comment', task: taskCode, fileName: 'ket-qua.png', size: IMG.length });
ok('create_upload(task-comment, mã việc) → uploadId + curl PUT', !cu.err && !!cu.j?.uploadId && String(cu.j?.curl).startsWith('curl -sS --fail -X PUT')
  && cu.j?.contentType === 'image/png' && String(cu.j?.next).includes('comment_task'), cu.text);
const url = String(cu.j?.curl ?? '').match(/'(https?:\/\/[^']+)'$/)?.[1] ?? '';
ok('khoá S3 riêng projects/comments/', url.includes('/uploads/projects/comments/') || url.includes('projects%2Fcomments'), url.slice(0, 160));
const put = await fetch(s3url(url), { method: 'PUT', headers: { 'content-type': cu.j?.contentType }, body: IMG });
ok('PUT ảnh lên S3 tạm', put.status === 200, put.status);
const cuPdf = await call(B1.token, 'create_upload', { target: 'task-comment', task: taskId, fileName: 'bao-cao.pdf', size: PDF.length });
const putPdf = await fetch(s3url(String(cuPdf.j?.curl ?? '').match(/'(https?:\/\/[^']+)'$/)?.[1] ?? ''), { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: PDF });
ok('PUT PDF', !cuPdf.err && putPdf.status === 200, cuPdf.text);
ok('create_upload task-comment thiếu task → lỗi rõ ràng', (await call(B1.token, 'create_upload', { target: 'task-comment', fileName: 'a.png', size: 10 })).err);
ok('create_upload target lạ → lỗi', (await call(B1.token, 'create_upload', { target: 'news', task: taskId, fileName: 'a.png', size: 10 })).err);
const ct = await call(B1.token, 'comment_task', { task: taskId, uploadIds: [cu.j?.uploadId, cuPdf.j?.uploadId] });
ok('comment_task chỉ có tệp (không nội dung) → ok, files = 2', !ct.err && ct.j?.ok === true && ct.j?.files === 2, ct.text);
ok('dùng lại uploadId đã gắn → lỗi', (await call(B1.token, 'comment_task', { task: taskId, content: 'lại', uploadIds: [cu.j?.uploadId] })).err);
ok('comment_task không nội dung, không tệp → lỗi', (await call(B1.token, 'comment_task', { task: taskId })).err);

// B2: get_task / list_task_comments thấy attachments (không link) → view_attachment
const gt = await call(B2.token, 'get_task', { task: taskId });
const c1 = gt.j?.comments?.find((c: any) => c.attachments?.length);
const aImg = c1?.attachments?.find((a: any) => a.fileName === 'ket-qua.png'), aPdf = c1?.attachments?.find((a: any) => a.fileName === 'bao-cao.pdf');
ok('bot khác get_task thấy attachments (id, tên, loại, isImage, size), đúng thứ tự', !gt.err && c1?.attachments?.length === 2 && c1.attachments[0].fileName === 'ket-qua.png'
  && aImg?.isImage === true && aImg.size === IMG.length && aPdf?.isImage === false && c1.byBot === true, gt.text.slice(0, 600));
ok('get_task không lộ link presigned', !gt.text.includes('X-Amz-') && !gt.text.includes('"url"'), gt.text.slice(0, 300));
const lc = await call(B2.token, 'list_task_comments', { task: taskId });
ok('list_task_comments có attachments, không link', !lc.err && lc.text.includes(aImg?.id) && !lc.text.includes('X-Amz-'), lc.text.slice(0, 300));
const vImg = await call(B2.token, 'view_attachment', { id: aImg?.id, source: 'task-comment' });
const block = vImg.content.find((c) => c.type === 'image');
const jpg = block ? Uint8Array.from(Buffer.from(block.data, 'base64')) : new Uint8Array();
ok('view_attachment(task-comment, ảnh) → image content JPEG 1280 × 640', !vImg.err && block?.mimeType === 'image/jpeg' && JSON.stringify(jpegSize(jpg)) === '[1280,640]',
  { types: vImg.content.map((c) => c.type), size: jpegSize(jpg), text: vImg.text });
const vPdf = await call(B2.token, 'view_attachment', { id: aPdf?.id, source: 'task-comment' });
ok('view_attachment(task-comment, PDF) → link 10 phút tải được', !vPdf.err && vPdf.j?.urlExpiresInMinutes === 10
  && (await fetch(s3url(vPdf.j?.url ?? 'http://127.0.0.1:9'))).status === 200, vPdf.text);
ok('view_attachment nhầm source chat → lỗi (không thấy tệp chat)', (await call(B2.token, 'view_attachment', { id: aImg?.id })).err);

// ---------- Web (cookie) ----------
const det = await json(H.cookie, 'GET', `/api/projects/tasks/${taskId}`);
const wc = det.body?.comments?.find((c: any) => c.attachments?.length);
const wImg = wc?.attachments?.find((a: any) => a.isImage);
ok('web: CommentDto.attachments có link presigned (X-Amz-Expires=3600)', !!wImg?.url && /X-Amz-Expires=3600/.test(wImg.url), wc);
const got = await fetch(s3url(wImg?.url ?? 'http://127.0.0.1:9'));
ok('link ảnh mở được đúng nội dung', got.status === 200 && new Uint8Array(await got.arrayBuffer()).length === IMG.length, got.status);
ok('web: GET /comments cũng có attachments', (await json(H.cookie, 'GET', `/api/projects/tasks/${taskId}/comments`)).body?.some((c: any) => c.attachments?.length === 2));
ok('web preview ảnh (cookie) → 200', (await fetch(`${API}/api/projects/comment-attachments/${aImg?.id}/preview?max=200`, { headers: { cookie: H.cookie } })).status === 200);
ok('preview PDF → 400', (await tk(B2.token, `/api/projects/comment-attachments/${aPdf?.id}/preview`)).status === 400);
ok('id lạ → 404', (await tk(B2.token, `/api/projects/comment-attachments/${crypto.randomUUID()}`)).status === 404);

// ---------- Quyền: người ngoài dự án ----------
ok('người ngoài (token) → 404 thông tin + preview', (await tk(O.token, `/api/projects/comment-attachments/${aImg?.id}`)).status === 404
  && (await tk(O.token, `/api/projects/comment-attachments/${aImg?.id}/preview`)).status === 404);
ok('người ngoài (cookie) → 404', (await fetch(`${API}/api/projects/comment-attachments/${aImg?.id}`, { headers: { cookie: O.cookie } })).status === 404);
ok('người ngoài view_attachment → lỗi', (await call(O.token, 'view_attachment', { id: aImg?.id, source: 'task-comment' })).err);
ok('người ngoài xin vé tải lên → 404', (await json(O.cookie, 'POST', `/api/projects/tasks/${taskId}/uploads`, { fileName: 'a.png', size: 10 })).status === 404);

// ---------- Kiểm tra tải lên (web) ----------
ok('.exe → 400', (await json(H.cookie, 'POST', `/api/projects/tasks/${taskId}/uploads`, { fileName: 'virus.exe', size: 100 })).status === 400);
ok('ảnh 11 MB → 400', (await json(H.cookie, 'POST', `/api/projects/tasks/${taskId}/uploads`, { fileName: 'to.png', size: 11 * 1024 * 1024 })).status === 400);
ok('tệp 26 MB → 400', (await json(H.cookie, 'POST', `/api/projects/tasks/${taskId}/uploads`, { fileName: 'to.zip', size: 26 * 1024 * 1024 })).status === 400);
const hT = (await json(H.cookie, 'POST', `/api/projects/tasks/${taskId}/uploads`, { fileName: 'dan-anh.png', contentType: 'image/png', size: IMG.length })).body;
ok('web xin vé ảnh dán (Ctrl+V)', !!hT?.id && !!hT?.url, hT);
const stolen = await json(B2.cookie, 'POST', `/api/projects/tasks/${taskId}/comments`, { content: 'lấy vé người khác', uploadIds: [hT?.id] });
ok('dùng vé của người khác → 400', stolen.status === 400, stolen);
const notYet = await json(H.cookie, 'POST', `/api/projects/tasks/${taskId}/comments`, { content: 'chưa PUT', uploadIds: [hT?.id] });
ok('chưa PUT file → 409', notYet.status === 409, notYet);
await fetch(s3url(hT.url), { method: 'PUT', headers: { 'content-type': hT.contentType }, body: IMG });
const hc = await json(H.cookie, 'POST', `/api/projects/tasks/${taskId}/comments`, { content: 'Ảnh lỗi giao diện', uploadIds: [hT.id] });
ok('web bình luận kèm ảnh dán → 201', hc.status === 201, hc);
const six = await json(H.cookie, 'POST', `/api/projects/tasks/${taskId}/comments`, { content: 'x', uploadIds: Array.from({ length: 6 }, () => crypto.randomUUID()) });
ok('> 5 tệp → 400', six.status === 400, six);
const empty = await json(H.cookie, 'POST', `/api/projects/tasks/${taskId}/comments`, { content: '  ' });
ok('bình luận rỗng không tệp → 400', empty.status === 400, empty);

// ---------- Xoá bình luận → xoá file S3 ----------
const after = (await json(H.cookie, 'GET', `/api/projects/tasks/${taskId}`)).body;
const mine = after?.comments?.find((c: any) => c.id === hc.body);
const mineUrl = mine?.attachments?.[0]?.url;
ok('bình luận của H có ảnh + canDelete', !!mineUrl && mine.canDelete === true, mine);
ok('trước khi xoá: file tồn tại', (await fetch(s3url(mineUrl))).status === 200);
const del = await fetch(`${API}/api/projects/comments/${hc.body}`, { method: 'DELETE', headers: { cookie: H.cookie } });
ok('xoá bình luận → 204', del.status === 204, del.status);
ok('xoá bình luận → file S3 bị xoá', (await fetch(s3url(mineUrl))).status === 404);
ok('xoá bình luận → /comment-attachments 404', (await fetch(`${API}/api/projects/comment-attachments/${mine?.attachments?.[0]?.id}`, { headers: { cookie: H.cookie } })).status === 404);

// ---------- Xoá việc → xoá file S3 của mọi bình luận ----------
const t2 = (await json(H.cookie, 'POST', `/api/projects/tasks/${task2}/uploads`, { fileName: 'tren-viec-xoa.png', size: IMG.length })).body;
await fetch(s3url(t2.url), { method: 'PUT', headers: { 'content-type': t2.contentType }, body: IMG });
await json(H.cookie, 'POST', `/api/projects/tasks/${task2}/comments`, { content: '', uploadIds: [t2.id] });
const t2Url = (await json(H.cookie, 'GET', `/api/projects/tasks/${task2}`)).body?.comments?.[0]?.attachments?.[0]?.url;
ok('việc 2 có bình luận chỉ ảnh', !!t2Url && (await fetch(s3url(t2Url))).status === 200);
const feed = (await json(admin, 'GET', `/api/projects/activity?after=${encodeURIComponent(new Date(Date.now() - 60_000).toISOString())}`)).body;
ok('luồng thay đổi: bình luận chỉ tệp hiện "[Ảnh / tệp đính kèm]"', feed?.items?.some((i: any) => i.kind === 'Commented' && i.text === '[Ảnh / tệp đính kèm]'), feed?.items?.slice(-3));
const delTask = await fetch(`${API}/api/projects/tasks/${task2}`, { method: 'DELETE', headers: { cookie: admin } });
ok('xoá việc → 204', delTask.status === 204, delTask.status);
ok('xoá việc → file S3 của bình luận bị xoá', (await fetch(s3url(t2Url))).status === 404);

const log = (await json(admin, 'GET', `/api/audit/ai-requests?all=true&page=1&pageSize=100`)).body;
ok('nhật ký AI ghi create_upload / comment_task', ['create_upload', 'comment_task'].every((n) => JSON.stringify(log?.items ?? []).includes(n)), log?.items?.slice(0, 2));

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
