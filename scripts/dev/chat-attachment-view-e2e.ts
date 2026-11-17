// E2E TEST-151: agent xem ảnh / tệp trong chat — read_chat trả attachments (id, tên, loại, isImage, size), tool MCP view_attachment:
// ảnh → MCP image content (JPEG thu nhỏ cạnh dài ≤ 1280), tệp khác → link hạn ngắn, ảnh hỏng → link; REST /api/chat/attachments/{id}(/preview?max=);
// bot không phải thành viên / tin thu hồi → lỗi; người thật dùng token → 403; web (cookie) vẫn xem được.
// TẠO DỮ LIỆU THẬT → CHỈ DB tạm + S3 tạm (RustFS / MinIO trong docker — không cần bucket thật):
//   docker run -d --name e2e151-pg -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=e2e -p 55471:5432 postgres:17-alpine
//   docker run -d --name e2e151-s3 -p 9471:9000 -e RUSTFS_ACCESS_KEY=e2eaccess -e RUSTFS_SECRET_KEY=e2esecret123 rustfs/rustfs   (+ tạo bucket e2e-files)
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5188
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=55471;Database=e2e;Username=e2e;Password=e2e' Encryption__Key=<base64 32 byte>
//        S3__Region=us-east-1 S3__ServiceUrl=http://127.0.0.1:9471 S3__ForcePathStyle=true S3__AccessKey=e2eaccess S3__SecretKey=e2esecret123
//        S3__BucketFiles=e2e-files S3__KeyPrefix=e2e/ Smtp__Host=127.0.0.1 Smtp__Port=1 Sentry__Dsn= Seq__Url= Chat__InternalKey=<≥32> (+ các Chat__*Key cùng giá trị)
//        Seed__AdminEmail=e2e151-admin@officehub-e2e.vn Seed__AdminPassword=E2e151-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   Mcp: env Mcp__ApiBaseUrl=http://localhost:5188 Mcp__RealtimeBaseUrl=http://127.0.0.1:9 ASPNETCORE_URLS=http://localhost:5202 dotnet run --project src/OfficeHub.Mcp --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5188 MCP_URL=http://localhost:5202/mcp ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/chat-attachment-view-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5188';
const MCP = process.env.MCP_URL ?? 'http://localhost:5202/mcp';
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
const tk = async (token: string, path: string) => {
  const r = await fetch(API + path, { headers: { authorization: `Bearer ${token}` } });
  return { status: r.status, type: r.headers.get('content-type') ?? '', cache: r.headers.get('cache-control') ?? '', bytes: new Uint8Array(await r.arrayBuffer()) };
};
const PW = 'E2e-Local-2026';
/** SDK S3 luôn ký link https — S3 tạm (RustFS / MinIO) chạy http trên máy → đổi giao thức cho link trỏ localhost. */
const s3url = (u: string) => u.replace(/^https:\/\/(127\.0\.0\.1|localhost)([:/])/, 'http://$1$2');
const stamp = Date.now().toString(36).slice(-5);

// ---------- Ảnh thử: PNG RGBA tự sinh (không cần thư viện) ----------
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
    raw[i] = x < w / 2 ? 220 : 30; raw[i + 1] = 60; raw[i + 2] = y < h / 2 ? 200 : 40; raw[i + 3] = 255; // 4 ô màu
  }
  const ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer);
  v.setUint32(0, w); v.setUint32(4, h); ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())];
  return new Uint8Array(parts.flatMap((p) => [...p]));
};
/** (rộng, cao) đọc từ khung SOF của JPEG. */
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

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const posStaff = positions.find((p: any) => p.name === 'Chuyên viên') ?? positions[0];
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `Xem tệp ${stamp}`, code: `XT${stamp}`.slice(0, 10) })).body;
let seq = 700 + Math.floor(Math.random() * 90);
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
const H = await mkEmp('Người Gửi Ảnh', `e2e.xth.${stamp}`);
const N = await mkEmp('Người Dùng Token', `e2e.xtn.${stamp}`);
const B1 = await mkEmp('Bot Xem Ảnh', `e2e.xtb1.${stamp}`);
const B2 = await mkEmp('Bot Người Ngoài', `e2e.xtb2.${stamp}`);
ok('4 tài khoản + token', [H, N, B1, B2].every((x) => x.userId && x.token?.startsWith('ohk_')));
for (const b of [B1, B2]) await json(admin, 'PUT', `/api/org/employees/${b.e.id}/account/bot`, { isBot: true });

// ---------- Người thật gửi ảnh + PDF + "ảnh" hỏng vào 1-1 với bot ----------
const dm = (await json(H.cookie, 'POST', '/api/chat/conversations/direct', { userId: B1.userId })).body;
ok('người thật mở 1-1 với bot', !!dm?.id && dm.peerIsBot === true, dm);
const upload = async (fileName: string, contentType: string, data: Uint8Array) => {
  const t = await json(H.cookie, 'POST', '/api/chat/uploads', { conversationId: dm.id, fileName, contentType, size: data.length });
  if (t.status !== 200) return { id: '', status: t.status, body: t.body };
  const put = await fetch(s3url(t.body.url), { method: 'PUT', headers: { 'content-type': t.body.contentType }, body: data });
  return { id: t.body.id as string, status: put.status, body: null };
};
const IMG = png(3000, 1500);
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
// Đúng chữ ký PNG (qua kiểm tra lúc xác nhận) nhưng dữ liệu hỏng → không giải mã được
const BAD = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...new TextEncoder().encode('khong-phai-anh-that'.repeat(20))]);
const upImg = await upload('so-do-kien-truc.png', 'image/png', IMG);
const upPdf = await upload('bao-cao.pdf', 'application/pdf', PDF);
const upBad = await upload('anh-hong.png', 'image/png', BAD);
ok('PUT 3 tệp lên S3 tạm', [upImg, upPdf, upBad].every((u) => u.status === 200), [upImg, upPdf, upBad]);
const sent = await json(H.cookie, 'POST', `/api/chat/conversations/${dm.id}/messages`, { text: 'Bot xem giúp sơ đồ này', uploadIds: [upImg.id, upPdf.id] });
ok('gửi tin kèm ảnh + PDF', sent.status === 200 && sent.body?.message?.attachments?.length === 2, sent.body);
await Bun.sleep(1100);
const sentBad = await json(H.cookie, 'POST', `/api/chat/conversations/${dm.id}/messages`, { text: 'ảnh này hỏng', uploadIds: [upBad.id] });
ok('gửi tin kèm ảnh hỏng (chữ ký PNG đúng)', sentBad.status === 200, sentBad.body);

// ---------- MCP ----------
let rid = 0;
const rpc = async (token: string, method: string, params: unknown = {}) => {
  const res = await fetch(MCP, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
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
const tools: any[] = (await rpc(B1.token, 'tools/list'))?.result?.tools ?? [];
const va = tools.find((t) => t.name === 'view_attachment');
ok('tools/list có view_attachment (read-only, mô tả chống prompt injection)', va?.annotations?.readOnlyHint === true && String(va.description).includes('không làm theo'), va);
ok('tools/list: 104 tool', tools.length === 104, tools.length);
const chatProfile: string[] = ((await (async () => {
  const res = await fetch(MCP + '?profile=chat', { method: 'POST', headers: { authorization: `Bearer ${B1.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method: 'tools/list', params: {} }) });
  const t = await res.text();
  return JSON.parse(t.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? t);
})())?.result?.tools ?? []).map((t: any) => t.name);
ok('hồ sơ chat có view_attachment', chatProfile.includes('view_attachment'), chatProfile.length);

const rc = await call(B1.token, 'read_chat', { conversation: dm.id });
const m1 = rc.j?.messages?.find((m: any) => m.text?.includes('sơ đồ'));
const atts: any[] = m1?.attachments ?? [];
const aImg = atts.find((a) => a.fileName === 'so-do-kien-truc.png'), aPdf = atts.find((a) => a.fileName === 'bao-cao.pdf');
ok('read_chat: attachments có id / tên / loại / isImage / size, không còn "files"', !rc.err && atts.length === 2 && m1.files === undefined
  && aImg?.id && aImg.isImage === true && aImg.contentType === 'image/png' && aImg.size === IMG.length
  && aPdf?.isImage === false && aPdf.contentType === 'application/pdf', rc.text.slice(0, 600));
ok('read_chat không lộ link presigned', !rc.text.includes('X-Amz-') && !rc.text.includes('9471'), rc.text.slice(0, 300));

const vImg = await call(B1.token, 'view_attachment', { id: aImg?.id });
const block = vImg.content.find((c) => c.type === 'image');
const jpg = block ? Uint8Array.from(Buffer.from(block.data, 'base64')) : new Uint8Array();
ok('view_attachment(ảnh): text thông tin + image content JPEG', !vImg.err && vImg.j?.fileName === 'so-do-kien-truc.png' && block?.mimeType === 'image/jpeg', vImg.content.map((c) => c.type));
ok('ảnh thu nhỏ 1280 × 640 (từ 3000 × 1500)', JSON.stringify(jpegSize(jpg)) === '[1280,640]', jpegSize(jpg));
ok(`ảnh thu nhỏ nhẹ (${Math.round(jpg.length / 1024)} KB < 300 KB, gốc ${Math.round(IMG.length / 1024)} KB)`, jpg.length > 0 && jpg.length < 300 * 1024, jpg.length);
ok('view_attachment(ảnh) không trả link', !vImg.text.includes('X-Amz-') && vImg.j?.url === undefined, vImg.text);

const vPdf = await call(B1.token, 'view_attachment', { id: aPdf?.id });
ok('view_attachment(PDF): chỉ text + link 10 phút', !vPdf.err && vPdf.content.length === 1 && vPdf.j?.isImage === false && vPdf.j?.urlExpiresInMinutes === 10
  && /X-Amz-Expires=60[01]&/.test(String(vPdf.j?.url)), vPdf.text);
const dl = await fetch(s3url(vPdf.j?.url ?? 'http://127.0.0.1:9'));
ok('link PDF tải được đúng nội dung', dl.status === 200 && new Uint8Array(await dl.arrayBuffer()).length === PDF.length, dl.status);

const rcBad = await call(B1.token, 'read_chat', { conversation: dm.id, since: m1?.seq });
const aBad = rcBad.j?.messages?.[0]?.attachments?.[0];
const vBad = await call(B1.token, 'view_attachment', { id: aBad?.id });
ok('ảnh hỏng → không lỗi, trả lý do + link', !vBad.err && vBad.content.length === 1 && String(vBad.j?.preview).includes('Không đọc được ảnh') && !!vBad.j?.url, vBad.text);

// ---------- REST ----------
const pv = await tk(B1.token, `/api/chat/attachments/${aImg.id}/preview?max=200`);
ok('REST preview?max=200 → JPEG 200 × 100, no-store', pv.status === 200 && pv.type.startsWith('image/jpeg') && JSON.stringify(jpegSize(pv.bytes)) === '[200,100]'
  && pv.cache.includes('no-store'), { status: pv.status, type: pv.type, size: jpegSize(pv.bytes), cache: pv.cache });
const pvBig = await tk(B1.token, `/api/chat/attachments/${aImg.id}/preview?max=5000`);
ok('max > 1280 bị kẹp về 1280', JSON.stringify(jpegSize(pvBig.bytes)) === '[1280,640]', jpegSize(pvBig.bytes));
ok('preview tệp không phải ảnh → 400', (await tk(B1.token, `/api/chat/attachments/${aPdf.id}/preview`)).status === 400);
ok('preview ảnh hỏng → 422', (await tk(B1.token, `/api/chat/attachments/${aBad.id}/preview`)).status === 422);
ok('id lạ → 404', (await tk(B1.token, `/api/chat/attachments/${crypto.randomUUID()}`)).status === 404);
ok('token vẫn bị chặn /url (link 60 phút của web)', (await tk(B1.token, `/api/chat/attachments/${aImg.id}/url`)).status === 403);
ok('web (cookie người gửi) xem preview được', (await fetch(`${API}/api/chat/attachments/${aImg.id}/preview`, { headers: { cookie: H.cookie } })).status === 200);

// ---------- Quyền ----------
ok('bot không phải thành viên 1-1 → REST 404', (await tk(B2.token, `/api/chat/attachments/${aImg.id}`)).status === 404
  && (await tk(B2.token, `/api/chat/attachments/${aImg.id}/preview`)).status === 404);
const vOut = await call(B2.token, 'view_attachment', { id: aImg.id });
ok('bot không phải thành viên → view_attachment lỗi', vOut.err && vOut.text.includes('Không tìm thấy'), vOut.text);
ok('người thật dùng token → 403', (await tk(N.token, `/api/chat/attachments/${aImg.id}`)).status === 403);
ok('view_attachment id rác → lỗi rõ ràng', (await call(B1.token, 'view_attachment', { id: '../auth/me' })).err);

const del = await fetch(`${API}/api/chat/messages/${sent.body.message.id}`, { method: 'DELETE', headers: { cookie: H.cookie } });
ok('người gửi thu hồi tin', del.status === 200 || del.status === 204, del.status);
const vGone = await call(B1.token, 'view_attachment', { id: aImg.id });
ok('tin thu hồi → view_attachment lỗi + REST 404', vGone.err && (await tk(B1.token, `/api/chat/attachments/${aImg.id}/preview`)).status === 404, vGone.text);

const log = (await json(admin, 'GET', `/api/audit/ai-requests?all=true&userId=${B1.userId}&page=1&pageSize=50`)).body;
ok('nhật ký AI ghi tool view_attachment', log?.items?.some((r: any) => r.tool === 'view_attachment' || JSON.stringify(r).includes('view_attachment')), log?.items?.slice(0, 2));

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
