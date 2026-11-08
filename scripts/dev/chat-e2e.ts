// E2E module Chat (REST, Api): hội thoại Office / Room / Direct, quyền (người ngoài và admin không đọc được tin 1-1), gửi / khử trùng / giới hạn
// tốc độ, lịch sử theo con trỏ, chưa đọc, thu hồi (xoá mềm), thành viên kênh phòng (khoá nội bộ), tệp đính kèm S3 (thư mục chat/), token AI bị chặn.
// TẠO NHÂN VIÊN THẬT + GHI 1 ẢNH NHỎ LÊN S3 THẬT (thư mục files/chat/, giữ lại vì thu hồi chỉ xoá mềm) → CHỈ chạy trên DB tạm:
//   docker run -d --name officehub-e2e-pg -e POSTGRES_DB=officehub_e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e_pw_7391 -p 127.0.0.1:55432:5432 postgres:18-alpine
//   Api (từ backend/): ASPNETCORE_URLS=http://localhost:5180 ConnectionStrings__Default="Host=127.0.0.1;Port=55432;Database=officehub_e2e;Username=e2e;Password=e2e_pw_7391"
//        Seed__AdminEmail=e2e.admin@officehub.test Seed__AdminPassword='E2e-Admin-2026!' dotnet run --project src/OfficeHub.Api --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 ADMIN_LOGIN=e2e.admin@officehub.test ADMIN_PASSWORD='E2e-Admin-2026!' bun scripts/dev/chat-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';
if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5180';
const envFile = Bun.file(new URL('../../.env', import.meta.url));
const env: Record<string, string> = (await envFile.exists()) ? Object.fromEntries((await envFile.text()).split('\n')
  .filter((l) => /^[A-Za-z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])) : {};
const ADMIN_LOGIN = process.env.ADMIN_LOGIN ?? env.Seed__AdminEmail, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? env.Seed__AdminPassword;
const INTERNAL_KEY = process.env.CHAT_INTERNAL_KEY ?? env.Chat__InternalKey;
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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
    if (e.status !== 200) throw new Error(`Không bật được 2FA cho ${login}: ${s.status} ${e.status} ${JSON.stringify(e.body)}`);
    keys[login] = s.body.sharedKey;
    writeFileSync(KEYS_FILE, JSON.stringify(keys));
  }
  return cookie;
};
const json = async (cookie: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const PW = 'E2e-Local-2026';
const MAIL = 'officehub.test'; // tên miền dành riêng → hệ thống không bao giờ gửi email
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');

const stamp = Date.now().toString(36);
const mkEmp = async (code: string, name: string, user: string) => {
  const r = await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@${MAIL}`, phone: null, dateOfBirth: null,
    departmentId: null, positionId: null, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null });
  if (r.status >= 300) throw new Error(`Tạo ${code} lỗi: ${JSON.stringify(r.body)}`);
  const e = r.body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const me = (await json(cookie, 'GET', '/api/auth/me')).body;
  return { e, cookie, userId: me.id as string, name };
};
const A = await mkEmp(`NV9${stamp.slice(-3)}1`, 'Nguyễn Đức Anh', `e2e.chat.a.${stamp}`);
const B = await mkEmp(`NV9${stamp.slice(-3)}2`, 'Trần Bảo Bình', `e2e.chat.b.${stamp}`);
const C = await mkEmp(`NV9${stamp.slice(-3)}3`, 'Lê Chí Cường', `e2e.chat.c.${stamp}`);
ok('3 tài khoản đăng nhập', [A, B, C].every((x) => !!x.cookie && !!x.userId));

// Mỗi tài khoản gửi tối đa 1 tin / giây → đợi trước mỗi lần gửi
const lastSend = new Map<string, number>();
const send = async (u: { cookie: string }, conv: string, body: Record<string, unknown>) => {
  const wait = 1150 - (Date.now() - (lastSend.get(u.cookie) ?? 0));
  if (wait > 0) await sleep(wait);
  const r = await json(u.cookie, 'POST', `/api/chat/conversations/${encodeURIComponent(conv)}/messages`, body);
  lastSend.set(u.cookie, Date.now());
  return r;
};
const convs = async (u: { cookie: string }) => (await json(u.cookie, 'GET', '/api/chat/conversations')).body as any[];
const msgs = async (u: { cookie: string }, conv: string, qs = '') => json(u.cookie, 'GET', `/api/chat/conversations/${encodeURIComponent(conv)}/messages${qs}`);

// ---------- Danh sách ban đầu ----------
const a0 = await convs(A);
ok('Office đứng đầu, chưa đọc 0, chưa thấy kênh phòng', a0[0]?.type === 'Office' && a0[0].title === 'Toàn văn phòng' && a0[0].unread === 0 && a0.length === 1, a0);
ok('unread-count = 0', (await json(A.cookie, 'GET', '/api/chat/unread-count')).body?.count === 0);

// ---------- Tìm người ----------
const ppl = (await json(A.cookie, 'GET', '/api/chat/people?search=tran%20bao')).body as any[];
ok('tìm "tran bao" ra Trần Bảo Bình (bỏ dấu), không có chính mình', ppl.some((p) => p.userId === B.userId) && !ppl.some((p) => p.userId === A.userId), ppl);
ok('tìm theo mã nhân viên', ((await json(A.cookie, 'GET', `/api/chat/people?search=${B.e.code}`)).body as any[]).some((p) => p.userId === B.userId));

// ---------- Chat 1-1 ----------
const d1 = await json(A.cookie, 'POST', '/api/chat/conversations/direct', { userId: B.userId });
ok('A mở chat với B → Direct, tiêu đề = tên B', d1.status === 200 && d1.body.type === 'Direct' && d1.body.title === B.name && d1.body.peerUserId === B.userId, d1.body);
const d2 = await json(B.cookie, 'POST', '/api/chat/conversations/direct', { userId: A.userId });
ok('B mở chat với A → cùng hội thoại (một cặp một hội thoại)', d2.body?.id === d1.body.id && d2.body.title === A.name, d2.body);
ok('mở lại lần nữa vẫn cùng id', (await json(A.cookie, 'POST', '/api/chat/conversations/direct', { userId: B.userId })).body?.id === d1.body.id);
ok('chat với chính mình → 400', (await json(A.cookie, 'POST', '/api/chat/conversations/direct', { userId: A.userId })).status === 400);
ok('chat với người không tồn tại → 404', (await json(A.cookie, 'POST', '/api/chat/conversations/direct', { userId: crypto.randomUUID() })).status === 404);
const DM = d1.body.id as string;

// ---------- Gửi tin ----------
const s1 = await send(A, DM, { text: '  Chào Bình  ', clientId: 'c-1' });
ok('A gửi → 200, cắt khoảng trắng, seq > 0, người nhận = [A, B]', s1.status === 200 && s1.body.message.text === 'Chào Bình' && s1.body.message.seq > 0
  && s1.body.conversationType === 'Direct' && s1.body.recipients.length === 2 && s1.body.recipients.includes(B.userId), s1.body);
const dup = await send(A, DM, { text: 'Chào Bình', clientId: 'c-1' });
ok('gửi lại cùng clientId → trả tin cũ, không tạo bản sao', dup.status === 200 && dup.body.message.id === s1.body.message.id, dup.body);
ok('tin rỗng → 400', (await send(A, DM, { text: '   ' })).status === 400);
ok('tin quá 1000 ký tự → 400', (await send(A, DM, { text: 'x'.repeat(1001) })).status === 400);
const fast1 = await json(A.cookie, 'POST', `/api/chat/conversations/${DM}/messages`, { text: 'nhanh 1' });
const fast2 = await json(A.cookie, 'POST', `/api/chat/conversations/${DM}/messages`, { text: 'nhanh 2' });
ok('gửi dồn dập < 1 giây → 429', fast2.status === 429 || fast1.status === 429, { f1: fast1.status, f2: fast2.status });
lastSend.set(A.cookie, Date.now());

// ---------- Chưa đọc / xem trước / đã đọc ----------
const bList = await convs(B);
const bDm = bList.find((c) => c.id === DM);
ok('B thấy hội thoại với A: chưa đọc ≥ 1, xem trước có nội dung', !!bDm && bDm.unread >= 1 && bDm.title === A.name && !!bDm.lastPreview, bList);
ok('unread-count của B ≥ 1', ((await json(B.cookie, 'GET', '/api/chat/unread-count')).body?.count ?? 0) >= 1);
const aSees = (await convs(A)).find((c) => c.id === DM);
ok('tin của chính A không tính chưa đọc của A', aSees?.unread === 0, aSees);
ok('B đánh dấu đã đọc → 204', (await json(B.cookie, 'POST', `/api/chat/conversations/${DM}/read`)).status === 204);
ok('sau khi đọc: chưa đọc 0', (await convs(B)).find((c) => c.id === DM)?.unread === 0);

// ---------- Lịch sử theo con trỏ ----------
for (let i = 1; i <= 5; i++) await send(B, DM, { text: `tin số ${i}` });
const page1 = await msgs(A, DM, '?take=3');
ok('trang 1 (take=3): 3 tin tăng dần theo seq, hasMore', page1.status === 200 && page1.body.items.length === 3 && page1.body.hasMore === true
  && page1.body.items[0].seq < page1.body.items[2].seq, page1.body);
const page2 = await msgs(A, DM, `?take=50&before=${page1.body.items[0].seq}`);
ok('trang cũ hơn: toàn tin có seq < con trỏ, hết tin', page2.body.items.every((m: any) => m.seq < page1.body.items[0].seq) && page2.body.hasMore === false, page2.body);
ok('người ngoài (C) không đọc / gửi / đánh dấu được hội thoại A–B (404)', (await msgs(C, DM)).status === 404
  && (await send(C, DM, { text: 'lén' })).status === 404 && (await json(C.cookie, 'POST', `/api/chat/conversations/${DM}/read`)).status === 404);
ok('admin / HR cũng không đọc được tin 1-1 (404)', (await msgs({ cookie: admin }, DM)).status === 404);
ok('C không thấy hội thoại A–B trong danh sách', !(await convs(C)).some((c) => c.id === DM));

// ---------- Kênh Office ----------
const so = await send(A, 'office', { text: 'Chào cả văn phòng' });
ok('gửi vào "office" → Office, người nhận = null (mọi người)', so.status === 200 && so.body.conversationType === 'Office' && so.body.recipients === null, so.body);
const bOffice = (await convs(B)).find((c) => c.type === 'Office');
const cOffice = (await convs(C)).find((c) => c.type === 'Office');
ok('B và C đều có 1 tin Office chưa đọc', bOffice.unread === 1 && cOffice.unread === 1, { b: bOffice.unread, c: cOffice.unread });

// ---------- Kênh phòng + khoá nội bộ ----------
const join = (key: string | null, room: string, userId: string) => json('', 'POST', `/api/chat/internal/rooms/${room}/members`, { userId }, key ? { 'x-chat-key': key } : {});
ok('cấp thành viên phòng thiếu khoá → 401', (await join(null, 'meeting-large', B.userId)).status === 401);
ok('cấp thành viên phòng sai khoá → 401', (await join('sai-khoa-' + 'x'.repeat(40), 'meeting-large', B.userId)).status === 401);
ok('phòng không tồn tại → 404', (await join(INTERNAL_KEY, 'khong-co-phong', B.userId)).status === 404);
ok('phòng khu mở (không tường) không có kênh → 404', (await join(INTERNAL_KEY, 'open', B.userId)).status === 404);
ok('B được cấp thành viên phòng họp lớn → 204 (lặp lại cũng 204)', (await join(INTERNAL_KEY, 'meeting-large', B.userId)).status === 204
  && (await join(INTERNAL_KEY, 'meeting-large', B.userId)).status === 204);
const bRoom = (await convs(B)).find((c) => c.type === 'Room');
ok('B thấy kênh "Phòng họp lớn" (roomId), chưa đọc 0', bRoom?.roomId === 'meeting-large' && bRoom.title === 'Phòng họp lớn' && bRoom.unread === 0, bRoom);
ok('A chưa vào phòng: không thấy kênh, không gửi / đọc được (404)', !(await convs(A)).some((c) => c.type === 'Room')
  && (await send(A, 'room:meeting-large', { text: 'ngoài' })).status === 404 && (await msgs(A, 'room:meeting-large')).status === 404);
const sr = await send(B, 'room:meeting-large', { text: 'Họp lúc 10h' });
ok('B gửi vào kênh phòng → Room, người nhận = thành viên [B]', sr.status === 200 && sr.body.conversationType === 'Room' && sr.body.roomId === 'meeting-large'
  && sr.body.roomName === 'Phòng họp lớn' && sr.body.recipients.length === 1 && sr.body.recipients[0] === B.userId, sr.body);
ok('A vào phòng (Realtime báo) → xem được lịch sử cũ nhưng không bị "chưa đọc" từ trước', (await join(INTERNAL_KEY, 'meeting-large', A.userId)).status === 204
  && (await convs(A)).find((c) => c.type === 'Room')?.unread === 0 && (await msgs(A, 'room:meeting-large')).body?.items?.length === 1);
const sr2 = await send(A, 'room:meeting-large', { text: 'Em vào họp' });
ok('A (thành viên) gửi được từ web; người nhận = [B, A]', sr2.status === 200 && sr2.body.recipients.length === 2, sr2.body);
ok('C vẫn ngoài kênh phòng (404)', (await msgs(C, 'room:meeting-large')).status === 404);
ok('Realtime tra kênh phòng theo bí danh "room:<id>" và theo Guid đều được', (await msgs(B, bRoom.id)).body?.items?.length === 2);

// ---------- Thu hồi (xoá mềm) ----------
const victim = (await send(A, DM, { text: 'tin sẽ thu hồi' })).body.message;
ok('người khác không thu hồi được tin của A (404)', (await json(B.cookie, 'DELETE', `/api/chat/messages/${victim.id}`)).status === 404);
const del = await json(A.cookie, 'DELETE', `/api/chat/messages/${victim.id}`);
ok('A thu hồi tin của mình → 200, người nhận = [A, B]', del.status === 200 && del.body.messageId === victim.id && del.body.recipients.length === 2, del.body);
const afterDel = (await msgs(B, DM, '?take=100')).body.items.find((m: any) => m.id === victim.id);
ok('tin thu hồi: deleted, không còn nội dung / tệp', afterDel?.deleted === true && afterDel.text === null && afterDel.attachments.length === 0, afterDel);
ok('xem trước hội thoại thành "Tin nhắn đã thu hồi" khi là tin cuối', (await convs(B)).find((c) => c.id === DM)?.lastPreview === 'Tin nhắn đã thu hồi');
ok('thu hồi lần nữa → 200 (không lỗi)', (await json(A.cookie, 'DELETE', `/api/chat/messages/${victim.id}`)).status === 200);
const rowInDb = await Bun.$`docker exec officehub-e2e-pg psql -U e2e -d officehub_e2e -tAc ${`select "Text", "DeletedAt" is not null from chat.messages where "Id" = '${victim.id}'`}`.text();
ok('nội dung vẫn còn trong DB (xoá mềm)', rowInDb.trim() === 'tin sẽ thu hồi|t', rowInDb);

// ---------- Tệp đính kèm (S3 thật, thư mục chat/) ----------
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const up = (u: { cookie: string }, conv: string, over: Record<string, unknown> = {}) =>
  json(u.cookie, 'POST', '/api/chat/uploads', { conversationId: conv, fileName: 'Ảnh thử e2e.png', contentType: 'image/png', size: PNG.length, ...over });
ok('chặn file chạy chương trình (.exe) → 400', (await up(A, DM, { fileName: 'setup.exe', contentType: 'application/octet-stream' })).status === 400);
ok('ảnh > 10 MB → 400', (await up(A, DM, { size: 11 * 1024 * 1024 })).status === 400);
ok('tệp > 25 MB → 400', (await up(A, DM, { fileName: 'a.pdf', contentType: 'application/pdf', size: 26 * 1024 * 1024 })).status === 400);
ok('C xin tải lên vào hội thoại A–B → 404', (await up(C, DM)).status === 404);
const t = await up(A, DM);
ok('xin tải lên → vé + presigned PUT trỏ vào thư mục chat/', t.status === 200 && /\/files\/chat\/\d{4}\/\d{2}\//.test(decodeURIComponent(t.body.url)) && !t.body.url.includes('documents/'), t.body?.url?.slice(0, 200));
const unfinished = await send(A, DM, { text: 'chưa tải xong', uploadIds: [t.body.id] });
ok('gửi khi tệp chưa PUT lên S3 → 409', unfinished.status === 409, unfinished.body);
const put = await fetch(t.body.url, { method: 'PUT', headers: { 'content-type': t.body.contentType }, body: PNG });
ok('PUT ảnh lên S3 thật', put.status === 200, put.status);
ok('vé của A không dùng được bởi B (400)', (await send(B, DM, { text: 'x', uploadIds: [t.body.id] })).status === 400);
const withImg = await send(A, DM, { text: '', uploadIds: [t.body.id] });
const att = withImg.body?.message?.attachments?.[0];
ok('gửi tin chỉ có ảnh → 1 tệp, isImage, size đúng, có url', withImg.status === 200 && att?.isImage === true && att.size === PNG.length && att.fileName === 'Ảnh thử e2e.png' && !!att.url, withImg.body);
const preview = (await convs(B)).find((c) => c.id === DM)?.lastPreview;
ok('xem trước = "[Ảnh] tên tệp"', preview === '[Ảnh] Ảnh thử e2e.png', preview);
const got = await fetch(att.url);
ok('tải ảnh qua presigned GET đúng nội dung', got.status === 200 && (await got.arrayBuffer()).byteLength === PNG.length, got.status);
ok('B (thành viên) lấy link tải', (await json(B.cookie, 'GET', `/api/chat/attachments/${att.id}/url?download=true`)).body?.url?.includes('attachment'));
ok('C lấy link tải tệp của hội thoại A–B → 404', (await json(C.cookie, 'GET', `/api/chat/attachments/${att.id}/url`)).status === 404);
await json(A.cookie, 'DELETE', `/api/chat/messages/${withImg.body.message.id}`);
ok('thu hồi tin có ảnh → link tải ảnh cũng bị 404', (await json(B.cookie, 'GET', `/api/chat/attachments/${att.id}/url`)).status === 404);

// ---------- Token AI bị chặn ----------
const tok = (await json(A.cookie, 'POST', '/api/auth/access-tokens', { name: 'e2e-chat', expiresInDays: 30 })).body?.token;
const ai = await fetch(`${API}/api/chat/conversations`, { headers: { authorization: `Bearer ${tok}` } });
const aiSend = await fetch(`${API}/api/chat/conversations/office/messages`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'ai' }) });
ok('token AI không đọc / gửi được chat (403)', !!tok && ai.status === 403 && aiSend.status === 403, { read: ai.status, send: aiSend.status });

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
