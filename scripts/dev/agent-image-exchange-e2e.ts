// E2E TEST-155: hai bot trao đổi ảnh qua chat và bình luận việc — trọn luồng Api + Mcp + S3, CHỈ qua tool MCP thật (như agent làm):
//   1. Bot A create_upload(chat, office) → PUT ảnh → send_chat_message(uploadIds) vào kênh có bot B (Toàn văn phòng — bot không dùng nhóm chat).
//   2. Bot B read_chat thấy attachments (không link) → view_attachment nhận ảnh JPEG đã thu nhỏ (cạnh dài ≤ 1280px).
//   3. Bot A create_upload(task-comment) → comment_task kèm ảnh + mention bot B → B có thông báo, get_task thấy attachments → view_attachment(task-comment).
//   4. Chặn: bot / người ngoài hội thoại hoặc ngoài dự án view_attachment → lỗi; uploadId chưa PUT / của người khác → lỗi;
//      quá 30 tệp / giờ (chat và bình luận việc tính riêng) → lỗi ghi rõ giới hạn; quá 120 request / phút / token → lỗi tiếng Việt rõ ràng.
//   5. DB chỉ lưu khoá file (chat/…, projects/comments/…), không có base64 trong tin nhắn / bình luận / khoá.
// TẠO DỮ LIỆU THẬT → CHỈ DB tạm + S3 tạm (RustFS trong docker — không cần bucket thật). Dựng (Git Bash, từ gốc repo):
//   docker run -d --name e2e155-pg -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=e2e -p 127.0.0.1:55475:5432 postgres:17-alpine
//   docker run -d --name e2e155-s3 -p 127.0.0.1:9475:9000 -e RUSTFS_ACCESS_KEY=e2eaccess -e RUSTFS_SECRET_KEY=e2esecret123 rustfs/rustfs
//     (+ tạo bucket e2e-files: RustFS không có CLI → PUT /e2e-files ký SigV4 bằng một script Bun nhỏ ngoài repo)
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5191
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=55475;Database=e2e;Username=e2e;Password=e2e' Encryption__Key=<base64 32 byte>
//        S3__Region=us-east-1 S3__ServiceUrl=http://127.0.0.1:9475 S3__ForcePathStyle=true S3__AccessKey=e2eaccess S3__SecretKey=e2esecret123
//        S3__BucketFiles=e2e-files S3__KeyPrefix=e2e/ Smtp__Host=127.0.0.1 Smtp__Port=1 Sentry__Dsn= Seq__Url= Chat__InternalKey=<≥32>
//        Telegram__ApiUrl=http://127.0.0.1:9 Firebase__CredentialsPath= Database__MigrateOnStartup=true   (.env nạp NoClobber — không để Telegram / FCM thật)
//        Seed__AdminEmail=e2e155-admin@officehub-e2e.vn Seed__AdminPassword=E2e155-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   Mcp: env Mcp__ApiBaseUrl=http://localhost:5191 Mcp__RealtimeBaseUrl=http://127.0.0.1:9 ASPNETCORE_URLS=http://localhost:5205 Chat__InternalKey=<cùng giá trị>
//        dotnet run --project src/OfficeHub.Mcp --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5191 MCP_URL=http://localhost:5205/mcp PG_URL=postgres://e2e:e2e@127.0.0.1:55475/e2e
//     ADMIN_LOGIN=e2e155-admin@officehub-e2e.vn ADMIN_PASSWORD=E2e155-Admin-2026 bun scripts/dev/agent-image-exchange-e2e.ts
// Đăng nhập bị giới hạn 30 lần / phút / IP: script giãn mỗi lần đăng nhập (LOGIN_GAP_MS, mặc định 800) và gặp 429 thì đợi 61 giây rồi thử lại —
// chạy chung API tạm với script khác vẫn được, chỉ chậm hơn. Hạn mức 30 tệp / giờ / bot → chạy lại trên cùng DB tạo bot mới mỗi lần nên không vướng.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { SQL } from 'bun';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5191';
const MCP = process.env.MCP_URL ?? 'http://localhost:5205/mcp';
const PG_URL = process.env.PG_URL ?? 'postgres://e2e:e2e@127.0.0.1:55475/e2e';
if (!['127.0.0.1', 'localhost'].includes(new URL(PG_URL).hostname)) throw new Error('PG_URL phải là Postgres tạm trên máy (127.0.0.1 / localhost)');
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const LOGIN_GAP_MS = Number(process.env.LOGIN_GAP_MS ?? 800);
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith(name + '=')).at(-1) ?? '';
/** POST đăng nhập có giãn + chờ khi bị giới hạn theo IP (429). */
const authPost = async (path: string, body: unknown, cookie = '') => {
  for (let i = 0; ; i++) {
    await Bun.sleep(LOGIN_GAP_MS);
    const r = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
    if (r.status !== 429 || i >= 3) return r;
    console.log('… đăng nhập bị giới hạn (429) — đợi 61 giây');
    await Bun.sleep(61_000);
  }
};
const login = async (login: string, password: string): Promise<string> => {
  const r = await authPost('/api/auth/login', { login, password });
  const body = await r.json().catch(() => null) as any;
  if (r.status === 403 && body?.title === '2fa_required') {
    if (!keys[login]) throw new Error(`${login} đã bật 2FA nhưng không có khoá trong ${KEYS_FILE}`);
    const r2 = await authPost('/api/auth/login/2fa', { code: totp(keys[login]), isRecoveryCode: false, rememberMe: true }, cookieOf(r, 'officehub.2fa'));
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
/** SDK S3 luôn ký link https — S3 tạm chạy http trên máy → đổi giao thức cho link trỏ localhost. */
const s3url = (u: string) => u.replace(/^https:\/\/(127\.0\.0\.1|localhost)([:/])/, 'http://$1$2');
const stamp = Date.now().toString(36).slice(-5);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

// ---------- Ảnh mẫu: PNG RGBA tự sinh 2400 × 1200 (thu nhỏ → 1280 × 640) ----------
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
const IMG = png(2400, 1200);
const IMG_B64_HEAD = Buffer.from(IMG.subarray(0, 24)).toString('base64').slice(0, 24); // "iVBORw0KGgo…" — dấu hiệu base64 PNG

// ---------- Chuẩn bị: người thật H, bot A / B (thành viên dự án), bot O (ngoài dự án, ngoài 1-1) ----------
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const posStaff = positions.find((p: any) => p.name === 'Chuyên viên') ?? positions[0];
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `Bot trao đổi ảnh ${stamp}`, code: `BA${stamp}`.slice(0, 10) })).body;
let seq = 600 + Math.floor(Math.random() * 90);
const mkEmp = async (name: string, user: string) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code: `NV${seq++}${stamp}`.slice(0, 20), fullName: name, email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: dep, positionId: posStaff.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const me = (await json(cookie, 'GET', '/api/auth/me')).body;
  const t = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `Agent ${user}`, expiresInDays: 30 })).body;
  return { e, cookie, userId: me?.id as string, token: t?.token as string, name };
};
const H = await mkEmp('Người Mở Chat', `e2e.aih.${stamp}`);
const A = await mkEmp('Bot Gửi Ảnh', `e2e.aia.${stamp}`);
const B = await mkEmp('Bot Nhận Ảnh', `e2e.aib.${stamp}`);
const O = await mkEmp('Bot Người Ngoài', `e2e.aio.${stamp}`);
ok('4 tài khoản + token AI', [H, A, B, O].every((x) => x.userId && x.token?.startsWith('ohk_')));
for (const b of [A, B, O]) await json(admin, 'PUT', `/api/org/employees/${b.e.id}/account/bot`, { isBot: true });
const code = `ai-${stamp}`;
const P = (await json(admin, 'POST', '/api/projects', { code, name: 'Bot trao đổi ảnh', kind: 'Internal', startOn: today, memberIds: [H.e.id, A.e.id, B.e.id], sequential: false })).body;
const T = (await json(admin, 'POST', `/api/projects/${P}/tasks`, { title: 'Báo cáo kèm ảnh chụp', assigneeEmployeeId: B.e.id })).body;
const taskId = typeof T === 'string' ? T : T?.id;
const taskCode = (await json(admin, 'GET', `/api/projects/tasks/${taskId}`)).body?.task?.code as string;
ok('dự án (H, A, B) + việc giao bot B', !!P && !!taskId && !!taskCode, { P, T });

// ---------- MCP ----------
let rid = 0;
const call = async (token: string, name: string, args: Record<string, unknown> = {}) => {
  const res = await fetch(MCP, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method: 'tools/call', params: { name, arguments: args } }) });
  const raw = await res.text();
  const data = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? raw;
  let x: any = null;
  try { x = JSON.parse(data); } catch { /* không phải JSON-RPC */ }
  const content: any[] = x?.result?.content ?? [];
  const text: string = content[0]?.text ?? x?.error?.message ?? raw;
  let j: any = null;
  try { j = JSON.parse(text); } catch { /* lỗi dạng chữ */ }
  return { err: !!x?.result?.isError || !!x?.error, j, text, content };
};
/** Như agent: create_upload → chạy lệnh curl (ở đây: fetch PUT đúng link + Content-Type trong lệnh). */
const upload = async (token: string, args: Record<string, unknown>, body: Uint8Array | null = IMG) => {
  const cu = await call(token, 'create_upload', { fileName: 'anh-chup.png', size: IMG.length, ...args });
  const url = String(cu.j?.curl ?? '').match(/'(https?:\/\/[^']+)'$/)?.[1] ?? '';
  const put = body && url ? (await fetch(s3url(url), { method: 'PUT', headers: { 'content-type': cu.j?.contentType }, body })).status : 0;
  return { cu, id: cu.j?.uploadId as string | undefined, put };
};
/** Ảnh trong kết quả view_attachment: [rộng, cao] của JPEG thu nhỏ. */
const viewed = (v: Awaited<ReturnType<typeof call>>) => {
  const block = v.content.find((c) => c.type === 'image');
  return { mime: block?.mimeType as string | undefined, size: block ? jpegSize(Uint8Array.from(Buffer.from(block.data, 'base64'))) : null };
};
const small = (s: [number, number] | null) => !!s && Math.max(...s) <= 1280 && s[0] > 0 && s[1] > 0;
const gap = () => Bun.sleep(1100); // chat: 1 tin / giây / tài khoản

// ---------- 1. Bot A gửi ảnh vào kênh Toàn văn phòng ----------
const aChats = await call(A.token, 'list_chats');
ok('[1] bot A list_chats có kênh office', !aChats.err && aChats.text.includes('"office"'), aChats.text.slice(0, 300));
const up1 = await upload(A.token, { target: 'chat', conversation: 'office', fileName: 'bieu-do.png' });
ok('[1] create_upload(chat, office) → uploadId + lệnh curl PUT + content-type image/png', !up1.cu.err && !!up1.id && String(up1.cu.j?.curl).startsWith('curl -sS --fail -X PUT')
  && up1.cu.j?.contentType === 'image/png' && String(up1.cu.j?.next).includes('send_chat_message'), up1.cu.text);
ok('[1] PUT ảnh lên S3 tạm (khoá chat/)', up1.put === 200 && String(up1.cu.j?.curl).includes('/chat/'), { put: up1.put, curl: String(up1.cu.j?.curl).slice(0, 200) });
const send1 = await call(A.token, 'send_chat_message', { conversation: 'office', text: `Biểu đồ tiến độ ${stamp}`, uploadIds: [up1.id] });
ok('[1] send_chat_message kèm uploadIds → sent, files = [bieu-do.png]', !send1.err && send1.j?.sent === true && JSON.stringify(send1.j?.files) === '["bieu-do.png"]', send1.text);

// ---------- 2. Bot B đọc + xem ảnh ----------
const rB = await call(B.token, 'read_chat', { conversation: 'office', take: 20 });
const mB = (rB.j?.messages ?? []).find((m: any) => m.seq === send1.j?.seq);
const aB = mB?.attachments?.[0];
ok('[2] bot B read_chat thấy tin của A: byBot, attachments (id, tên, image/png, isImage, size)', !rB.err && mB?.byBot === true && mB.senderName === A.name
  && aB?.fileName === 'bieu-do.png' && aB.contentType === 'image/png' && aB.isImage === true && aB.size === IMG.length, rB.text.slice(0, 600));
ok('[2] read_chat không lộ link S3 / base64', !rB.text.includes('X-Amz-') && !rB.text.includes('"url"') && !rB.text.includes(IMG_B64_HEAD));
const vB = await call(B.token, 'view_attachment', { id: aB?.id });
const vBi = viewed(vB);
ok('[2] view_attachment(chat) → ảnh JPEG thu nhỏ cạnh dài ≤ 1280 (2400×1200 → 1280×640)', !vB.err && vBi.mime === 'image/jpeg' && small(vBi.size)
  && JSON.stringify(vBi.size) === '[1280,640]' && vB.j?.fileName === 'bieu-do.png', { ...vBi, text: vB.text });
const marked = await call(B.token, 'mark_chat_read', { conversation: 'office' });
ok('[2] mark_chat_read office', !marked.err, marked.text);

// ---------- 3. Bình luận việc kèm ảnh + mention bot B ----------
const up3 = await upload(A.token, { target: 'task-comment', task: taskCode, fileName: 'man-hinh-loi.png' });
ok('[3] create_upload(task-comment, mã việc) → PUT (khoá projects/comments/)', !up3.cu.err && !!up3.id && up3.put === 200
  && /projects(\/|%2F)comments/.test(String(up3.cu.j?.curl)), up3.cu.text);
const ct3 = await call(A.token, 'comment_task', { task: taskCode, content: `Ảnh lỗi màn hình đăng nhập ${stamp}`, uploadIds: [up3.id], mention: B.e.code });
ok('[3] comment_task kèm ảnh + mention bot B → ok, files = 1', !ct3.err && ct3.j?.ok === true && ct3.j?.files === 1, ct3.text);
const nB = await call(B.token, 'list_notifications', {});
ok('[3] bot B nhận thông báo được nhắc ở việc', !nB.err && nB.text.includes(taskCode), nB.text.slice(0, 400));
const gB = await call(B.token, 'get_task', { task: taskCode });
const cB = (gB.j?.comments ?? []).find((c: any) => c.attachments?.length);
const caB = cB?.attachments?.[0];
ok('[3] bot B get_task thấy bình luận của A (byBot) + attachments, không link', !gB.err && cB?.byBot === true && caB?.fileName === 'man-hinh-loi.png' && caB.isImage === true
  && caB.size === IMG.length && !gB.text.includes('X-Amz-') && !gB.text.includes(IMG_B64_HEAD), gB.text.slice(0, 600));
const vT = await call(B.token, 'view_attachment', { id: caB?.id, source: 'task-comment' });
const vTi = viewed(vT);
ok('[3] view_attachment(task-comment) → JPEG cạnh dài ≤ 1280', !vT.err && vTi.mime === 'image/jpeg' && small(vTi.size), { ...vTi, text: vT.text });

// ---------- 4. Chặn ----------
// 4a. Hội thoại 1-1 H ↔ A: bot B / bot O (ngoài hội thoại) và người thật dùng token không xem được ảnh trong đó
const dm = (await json(H.cookie, 'POST', '/api/chat/conversations/direct', { userId: A.userId })).body;
await gap();
const upDm = await upload(A.token, { target: 'chat', conversation: dm?.id, fileName: 'rieng-tu.png' });
const sendDm = await call(A.token, 'send_chat_message', { conversation: dm?.id, text: 'Ảnh riêng', uploadIds: [upDm.id] });
const rA = await call(A.token, 'read_chat', { conversation: dm?.id });
const dmAtt = (rA.j?.messages ?? []).flatMap((m: any) => m.attachments ?? [])[0];
ok('[4] bot A gửi ảnh vào 1-1 người mở (H ↔ A)', !!dm?.id && upDm.put === 200 && !sendDm.err && !!dmAtt?.id, { dm, send: sendDm.text });
const vA = await call(A.token, 'view_attachment', { id: dmAtt?.id });
ok('[4] thành viên hội thoại (A) xem được', !vA.err && viewed(vA).mime === 'image/jpeg', vA.text);
for (const [who, x] of [['bot B', B], ['bot O', O]] as const) {
  const v = await call(x.token, 'view_attachment', { id: dmAtt?.id });
  ok(`[4] ${who} ngoài hội thoại view_attachment(chat) → lỗi, không có ảnh`, v.err && !v.content.some((c) => c.type === 'image'), v.text);
}
ok('[4] bot B read_chat 1-1 của A → lỗi', (await call(B.token, 'read_chat', { conversation: dm?.id })).err);
ok('[4] bot B create_upload vào 1-1 của A → lỗi', (await upload(B.token, { target: 'chat', conversation: dm?.id }, null)).cu.err);
const vH = await call(H.token, 'view_attachment', { id: dmAtt?.id });
ok('[4] người thật dùng token (không phải bot) view_attachment(chat) → lỗi', vH.err, vH.text);
// 4b. Ngoài dự án: bot O
const vO = await call(O.token, 'view_attachment', { id: caB?.id, source: 'task-comment' });
ok('[4] bot O ngoài dự án view_attachment(task-comment) → lỗi, không có ảnh', vO.err && !vO.content.some((c) => c.type === 'image'), vO.text);
ok('[4] bot O ngoài dự án get_task → lỗi', (await call(O.token, 'get_task', { task: taskCode })).err);
ok('[4] bot O ngoài dự án create_upload(task-comment) → lỗi', (await upload(O.token, { target: 'task-comment', task: taskCode }, null)).cu.err);
ok('[4] id tệp lạ → lỗi', (await call(B.token, 'view_attachment', { id: crypto.randomUUID(), source: 'task-comment' })).err);
// 4c. uploadId chưa PUT / của người khác / không phải uuid
await gap();
const noPut = await upload(A.token, { target: 'chat', conversation: 'office' }, null);
const sNoPut = await call(A.token, 'send_chat_message', { conversation: 'office', text: 'chưa PUT', uploadIds: [noPut.id] });
ok('[4] send_chat_message với uploadId chưa PUT → lỗi', !noPut.cu.err && sNoPut.err, sNoPut.text);
const cNoPutUp = await upload(A.token, { target: 'task-comment', task: taskCode }, null);
const cNoPut = await call(A.token, 'comment_task', { task: taskCode, content: 'chưa PUT', uploadIds: [cNoPutUp.id] });
ok('[4] comment_task với uploadId chưa PUT → lỗi', !cNoPutUp.cu.err && cNoPut.err, cNoPut.text);
const aOwn = await upload(A.token, { target: 'chat', conversation: 'office' });
await gap();
const stolen = await call(B.token, 'send_chat_message', { conversation: 'office', text: 'lấy vé của A', uploadIds: [aOwn.id] });
ok('[4] bot B gửi tin bằng uploadId (đã PUT) của bot A → lỗi', aOwn.put === 200 && stolen.err, stolen.text);
const aOwnT = await upload(A.token, { target: 'task-comment', task: taskCode });
const stolenT = await call(B.token, 'comment_task', { task: taskCode, content: 'lấy vé của A', uploadIds: [aOwnT.id] });
ok('[4] bot B comment_task bằng uploadId (đã PUT) của bot A → lỗi', aOwnT.put === 200 && stolenT.err, stolenT.text);
ok('[4] uploadId không phải uuid → lỗi', (await call(A.token, 'comment_task', { task: taskCode, uploadIds: ['data:image/png;base64,' + IMG_B64_HEAD] })).err);
// 4d. Hạn mức 30 tệp / giờ — chat và bình luận việc tính riêng; vượt → lỗi nêu rõ giới hạn
const quota = async (args: Record<string, unknown>) => {
  for (let i = 0; i < 40; i++) {
    const r = await call(A.token, 'create_upload', { fileName: `q${i}.png`, size: 100, ...args });
    if (r.err) return { okCount: i, text: r.text };
  }
  return { okCount: 40, text: '' };
};
const qChat = await quota({ target: 'chat', conversation: 'office' });
ok('[4] chat: quá 30 tệp / giờ → lỗi rõ ràng "30 tệp trong 1 giờ"', qChat.okCount < 30 && /30 tệp trong 1 giờ/.test(qChat.text), qChat);
// Token AI còn giới hạn 120 request / phút (cửa sổ cố định) → sang cửa sổ mới rồi mới thử hạn mức bình luận việc (id việc: 1 request / lần)
console.log('… đợi 61 giây sang cửa sổ giới hạn request / phút mới');
await Bun.sleep(61_000);
const qTask = await quota({ target: 'task-comment', task: taskId });
ok('[4] bình luận việc: quá 30 tệp / giờ → lỗi rõ ràng (đếm riêng với chat)', qTask.okCount > 0 && qTask.okCount < 30 && /30 tệp .*1 giờ/.test(qTask.text), qTask);
await gap();
ok('[4] vẫn gửi được tin chữ khi hết hạn mức tệp', !(await call(A.token, 'send_chat_message', { conversation: 'office', text: 'hết hạn mức tệp' })).err);
// Vượt giới hạn request / phút của token (Api trả problem chỉ có title "Too Many Requests") → MCP báo câu tiếng Việt rõ ràng
let burst = { n: 0, text: '' };
for (let i = 0; i < 150; i++) {
  const r = await call(A.token, 'list_chats');
  if (r.err) { burst = { n: i, text: r.text }; break; }
}
ok('[4] quá giới hạn request / phút của token → lỗi rõ ràng (không phải "Too Many Requests")', burst.n > 0 && burst.text.includes('1 phút') && !burst.text.includes('Too Many Requests'), burst);

// ---------- 5. DB chỉ có khoá file, không base64 ----------
const db = new SQL(PG_URL);
const chatFiles = await db`SELECT "FileKey" AS key, "Size" AS size FROM chat.attachments a JOIN chat.messages m ON m."Id" = a."MessageId" WHERE m."SenderId" = ${A.userId}`;
ok('[5] chat.attachments: 2 tệp của A, khoá chat/…/tên-file, size đúng', chatFiles.length === 2
  && chatFiles.every((r: any) => /^chat\/\d{4}\/\d{2}\/[0-9a-f-]{32,36}\/[\w.-]+\.png$/.test(r.key) && Number(r.size) === IMG.length), chatFiles);
const taskFiles = await db`SELECT a."FileKey" AS key FROM projects.comment_attachments a JOIN projects.task_comments c ON c."Id" = a."CommentId" WHERE c."TaskId" = ${taskId}`;
ok('[5] comment_attachments: khoá projects/comments/…', taskFiles.length === 1 && taskFiles.every((r: any) => r.key.startsWith('projects/comments/') && r.key.length < 200), taskFiles);
const B64 = '[A-Za-z0-9+/]{200,}';
const [leak] = await db`SELECT
    (SELECT count(*) FROM chat.messages WHERE "Text" ~ ${B64} OR "Text" LIKE '%base64%' OR "Text" LIKE ${'%' + IMG_B64_HEAD + '%'}) AS msg,
    (SELECT count(*) FROM chat.attachments WHERE "FileKey" ~ ${B64} OR length("FileKey") > 300) AS att,
    (SELECT count(*) FROM chat.upload_tickets WHERE "FileKey" ~ ${B64}) AS tic,
    (SELECT count(*) FROM projects.task_comments WHERE "Content" ~ ${B64} OR "Content" LIKE '%base64%' OR "Content" LIKE ${'%' + IMG_B64_HEAD + '%'}) AS cmt,
    (SELECT count(*) FROM projects.comment_attachments WHERE "FileKey" ~ ${B64} OR length("FileKey") > 300) AS catt,
    (SELECT count(*) FROM projects.comment_upload_tickets WHERE "FileKey" ~ ${B64}) AS ctic`;
ok('[5] không có base64 trong tin nhắn / bình luận / khoá / vé', Object.values(leak).every((n) => Number(n) === 0), leak);
await db.close();

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
