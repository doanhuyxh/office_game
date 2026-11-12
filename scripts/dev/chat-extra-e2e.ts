// E2E TEST-54 (chat): nhóm tuỳ chọn (ai cũng tạo, thành viên thêm người, rời nhóm, người ngoài 404), sửa tin (của mình, đã sửa, xem trước),
// cảm xúc emoji tự do (bật / tắt, emoji sai 400), tìm trong tin nhắn (không phân biệt hoa thường, % _ là ký tự thường, bỏ tin thu hồi), token AI 403.
// TẠO NHÂN VIÊN THẬT → CHỈ chạy trên DB tạm (lệnh Api như chat-e2e.ts):
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 ADMIN_LOGIN=e2e.admin@officehub.test ADMIN_PASSWORD='E2e-Admin-2026!' bun scripts/dev/chat-extra-e2e.ts
// Phần Realtime (hub Edit / React → MessageUpdated) khi có RT_URL: Realtime :5190 (Realtime__ApiBaseUrl=http://localhost:5180), chạy từ frontend/:
//   cd frontend && E2E_LOCAL_DB=1 API_URL=… RT_URL=http://localhost:5190 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun ../scripts/dev/chat-extra-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';
if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5180';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
if (!ADMIN_LOGIN || !ADMIN_PASSWORD) throw new Error('Đặt ADMIN_LOGIN / ADMIN_PASSWORD của DB tạm');
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
const MAIL = 'officehub.test';
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
const A = await mkEmp(`NX${stamp.slice(-4)}1`, 'Nguyễn Đức Anh', `e2e.cx.a.${stamp}`);
const B = await mkEmp(`NX${stamp.slice(-4)}2`, 'Trần Bảo Bình', `e2e.cx.b.${stamp}`);
const C = await mkEmp(`NX${stamp.slice(-4)}3`, 'Lê Chí Cường', `e2e.cx.c.${stamp}`);
const D = await mkEmp(`NX${stamp.slice(-4)}4`, 'Phạm Diệu Dung', `e2e.cx.d.${stamp}`);
ok('4 tài khoản đăng nhập', [A, B, C, D].every((x) => !!x.cookie && !!x.userId));

const lastSend = new Map<string, number>();
const send = async (u: { cookie: string }, conv: string, body: Record<string, unknown>) => {
  const wait = 1150 - (Date.now() - (lastSend.get(u.cookie) ?? 0));
  if (wait > 0) await sleep(wait);
  const r = await json(u.cookie, 'POST', `/api/chat/conversations/${encodeURIComponent(conv)}/messages`, body);
  lastSend.set(u.cookie, Date.now());
  return r;
};
const convs = async (u: { cookie: string }) => (await json(u.cookie, 'GET', '/api/chat/conversations')).body as any[];

// ---------- Nhóm tuỳ chọn ----------
ok('tạo nhóm thiếu tên → 400', (await json(A.cookie, 'POST', '/api/chat/conversations/group', { title: ' ', userIds: [B.userId] })).status === 400);
ok('tạo nhóm không mời ai → 400', (await json(A.cookie, 'POST', '/api/chat/conversations/group', { title: 'Nhóm', userIds: [A.userId] })).status === 400);
ok('mời người không tồn tại → 400', (await json(A.cookie, 'POST', '/api/chat/conversations/group', { title: 'Nhóm', userIds: [crypto.randomUUID()] })).status === 400);
const g = await json(A.cookie, 'POST', '/api/chat/conversations/group', { title: '  Dự án Alpha  ', userIds: [B.userId, B.userId] });
ok('nhân viên thường tạo nhóm → Group, tên đã cắt khoảng trắng', g.status === 200 && g.body.type === 'Group' && g.body.title === 'Dự án Alpha', g.body);
const G = g.body.id as string;
ok('B thấy nhóm trong danh sách', (await convs(B)).some((c) => c.id === G && c.type === 'Group' && c.title === 'Dự án Alpha'));
ok('C (ngoài nhóm) không thấy nhóm', !(await convs(C)).some((c) => c.id === G));
const mem = await json(B.cookie, 'GET', `/api/chat/conversations/${G}/members`);
ok('thành viên: A (người tạo) + B', mem.status === 200 && mem.body.length === 2 && mem.body.some((m: any) => m.userId === A.userId && m.isCreator)
  && mem.body.some((m: any) => m.userId === B.userId && !m.isCreator), mem.body);
ok('C xem thành viên → 404', (await json(C.cookie, 'GET', `/api/chat/conversations/${G}/members`)).status === 404);
ok('C đọc tin nhóm → 404', (await json(C.cookie, 'GET', `/api/chat/conversations/${G}/messages`)).status === 404);
ok('C gửi tin nhóm → 404', (await send(C, G, { text: 'xin vào' })).status === 404);
ok('C tự thêm mình vào nhóm → 404', (await json(C.cookie, 'POST', `/api/chat/conversations/${G}/members`, { userIds: [C.userId] })).status === 404);

const m1 = await send(A, G, { text: 'Họp 50% lúc 9h_sáng nhé' });
ok('A gửi tin nhóm → người nhận = thành viên', m1.status === 200 && m1.body.conversationType === 'Group' && m1.body.recipients.length === 2, m1.body);
ok('B có 1 tin chưa đọc ở nhóm', (await convs(B)).find((c) => c.id === G)?.unread === 1);

const add = await json(B.cookie, 'POST', `/api/chat/conversations/${G}/members`, { userIds: [C.userId] });
ok('B (thành viên thường) thêm C → 204', add.status === 204, add);
ok('C mới vào: thấy nhóm, không bị tính lịch sử cũ là chưa đọc', (await convs(C)).find((c) => c.id === G)?.unread === 0);
ok('C đọc được lịch sử nhóm', (await json(C.cookie, 'GET', `/api/chat/conversations/${G}/messages`)).body?.items?.length === 1);
ok('thêm lại người đã có → 204 không lỗi', (await json(A.cookie, 'POST', `/api/chat/conversations/${G}/members`, { userIds: [C.userId] })).status === 204);

// ---------- Sửa tin ----------
const mid = m1.body.message.id as string;
const e1 = await json(A.cookie, 'PATCH', `/api/chat/messages/${mid}`, { text: '  Họp lúc 10h  ' });
ok('A sửa tin của mình → editedAt, nội dung mới, người nhận = nhóm', e1.status === 200 && e1.body.message.text === 'Họp lúc 10h' && !!e1.body.message.editedAt
  && e1.body.recipients.length === 3, e1.body);
ok('xem trước nhóm đổi theo tin đã sửa', (await convs(B)).find((c) => c.id === G)?.lastPreview === 'Họp lúc 10h');
ok('B sửa tin của A → 404', (await json(B.cookie, 'PATCH', `/api/chat/messages/${mid}`, { text: 'hack' })).status === 404);
ok('sửa thành rỗng (tin không tệp) → 400', (await json(A.cookie, 'PATCH', `/api/chat/messages/${mid}`, { text: '  ' })).status === 400);
ok('sửa quá 1000 ký tự → 400', (await json(A.cookie, 'PATCH', `/api/chat/messages/${mid}`, { text: 'x'.repeat(1001) })).status === 400);
const hist = (await json(B.cookie, 'GET', `/api/chat/conversations/${G}/messages`)).body.items as any[];
ok('lịch sử trả editedAt', hist[0]?.text === 'Họp lúc 10h' && !!hist[0]?.editedAt, hist[0]);

// ---------- Cảm xúc ----------
const r1 = await json(B.cookie, 'POST', `/api/chat/messages/${mid}/reactions`, { emoji: '👍' });
ok('B thả 👍 → reactions [{👍, [B]}]', r1.status === 200 && r1.body.message.reactions?.length === 1 && r1.body.message.reactions[0].emoji === '👍'
  && r1.body.message.reactions[0].userIds[0] === B.userId, r1.body);
const r2 = await json(C.cookie, 'POST', `/api/chat/messages/${mid}/reactions`, { emoji: '👍' });
ok('C thả cùng 👍 → 2 người', r2.body?.message?.reactions?.[0]?.userIds?.length === 2, r2.body);
const r3 = await json(A.cookie, 'POST', `/api/chat/messages/${mid}/reactions`, { emoji: '🇻🇳' });
ok('emoji tự do (cờ) → thêm loại thứ hai', r3.status === 200 && r3.body.message.reactions.length === 2, r3.body);
const r4 = await json(B.cookie, 'POST', `/api/chat/messages/${mid}/reactions`, { emoji: '👍' });
ok('B bấm lại 👍 → gỡ, còn C', r4.status === 200 && r4.body.message.reactions.find((x: any) => x.emoji === '👍')?.userIds?.join() === C.userId, r4.body);
ok('emoji không hợp lệ ("ok") → 400', (await json(B.cookie, 'POST', `/api/chat/messages/${mid}/reactions`, { emoji: 'ok' })).status === 400);
ok('hai emoji một lần → 400', (await json(B.cookie, 'POST', `/api/chat/messages/${mid}/reactions`, { emoji: '👍👍' })).status === 400);
ok('D (ngoài nhóm) thả cảm xúc → 404', (await json(D.cookie, 'POST', `/api/chat/messages/${mid}/reactions`, { emoji: '👍' })).status === 404);
const hist2 = (await json(B.cookie, 'GET', `/api/chat/conversations/${G}/messages`)).body.items as any[];
ok('lịch sử trả cảm xúc', hist2[0]?.reactions?.length === 2, hist2[0]);

// ---------- Tìm trong tin nhắn ----------
await send(B, G, { text: 'Báo cáo tuần: 100% xong' });
await send(C, G, { text: 'giảm_giá 20%' });
const s1 = await json(A.cookie, 'GET', `/api/chat/conversations/${G}/search?q=${encodeURIComponent('BÁO CÁO')}`);
ok('tìm không phân biệt hoa thường', s1.status === 200 && s1.body.length === 1 && s1.body[0].text.startsWith('Báo cáo'), s1.body);
const s2 = await json(A.cookie, 'GET', `/api/chat/conversations/${G}/search?q=${encodeURIComponent('0%')}`);
ok('"%" là ký tự thường (không phải ký tự đại diện)', s2.status === 200 && s2.body.length === 2, s2.body.map((x: any) => x.text));
const s3 = await json(A.cookie, 'GET', `/api/chat/conversations/${G}/search?q=${encodeURIComponent('o_c')}`);
ok('"_" là ký tự thường ("o_c" không khớp "Báo cáo")', s3.status === 200 && s3.body.length === 0, s3.body.map((x: any) => x.text));
const s4 = await json(A.cookie, 'GET', `/api/chat/conversations/${G}/search?q=${encodeURIComponent('m_g')}`);
ok('"m_g" khớp đúng "giảm_giá"', s4.status === 200 && s4.body.length === 1, s4.body.map((x: any) => x.text));
ok('tìm 1 ký tự → 400', (await json(A.cookie, 'GET', `/api/chat/conversations/${G}/search?q=a`)).status === 400);
ok('D tìm trong nhóm → 404', (await json(D.cookie, 'GET', `/api/chat/conversations/${G}/search?q=bao`)).status === 404);
const del = await send(C, G, { text: 'tin bí mật sẽ thu hồi' });
await json(C.cookie, 'DELETE', `/api/chat/messages/${del.body.message.id}`);
ok('tin thu hồi không ra kết quả tìm', ((await json(A.cookie, 'GET', `/api/chat/conversations/${G}/search?q=b%C3%AD%20m%E1%BA%ADt`)).body as any[]).length === 0);
ok('sửa tin đã thu hồi → 404', (await json(C.cookie, 'PATCH', `/api/chat/messages/${del.body.message.id}`, { text: 'x' })).status === 404);
ok('thả cảm xúc tin đã thu hồi → 404', (await json(A.cookie, 'POST', `/api/chat/messages/${del.body.message.id}/reactions`, { emoji: '👍' })).status === 404);
const so = await send(A, 'office', { text: 'Thông báo chung e2e-cx' });
ok('tìm ở kênh Office', ((await json(D.cookie, 'GET', `/api/chat/conversations/office/search?q=e2e-cx`)).body as any[]).some((x) => x.id === so.body.message.id));

// ---------- Realtime (tuỳ chọn: RT_URL, chạy từ frontend/ để có @microsoft/signalr) ----------
const RT = process.env.RT_URL;
if (RT) {
  const signalR = await import(new URL('../../frontend/node_modules/@microsoft/signalr/dist/esm/index.js', import.meta.url).href) as typeof import('../../frontend/node_modules/@microsoft/signalr');
  const hubOf = (cookie: string) => new signalR.HubConnectionBuilder()
    .withUrl(`${RT}/rt/hub/chat`, { headers: { cookie }, transport: signalR.HttpTransportType.WebSockets, skipNegotiation: true })
    .configureLogging(signalR.LogLevel.Warning).build();
  const hA = hubOf(A.cookie), hB = hubOf(B.cookie), hD = hubOf(D.cookie);
  const gotB: any[] = [], gotD: any[] = [];
  hB.on('MessageUpdated', (m: any) => gotB.push(m));
  hD.on('MessageUpdated', (m: any) => gotD.push(m));
  await Promise.all([hA.start(), hB.start(), hD.start()]);
  const edited: any = await hA.invoke('Edit', mid, 'Họp lúc 11h (realtime)');
  const reacted: any = await hA.invoke('React', mid, '🎉');
  await sleep(800);
  ok('hub Edit → trả tin đã sửa, B nhận MessageUpdated', edited?.text === 'Họp lúc 11h (realtime)' && !!edited?.editedAt
    && gotB.some((m) => m.id === mid && m.text === 'Họp lúc 11h (realtime)'), { edited, gotB });
  ok('hub React → B nhận cảm xúc 🎉 của A', reacted?.reactions?.some((r: any) => r.emoji === '🎉')
    && gotB.some((m) => m.id === mid && m.reactions?.some((r: any) => r.emoji === '🎉' && r.userIds.includes(A.userId))), gotB.at(-1));
  ok('D (ngoài nhóm) không nhận MessageUpdated', gotD.length === 0, gotD);
  let err = '';
  try { await hB.invoke('Edit', mid, 'hack'); } catch (e) { err = String(e); }
  ok('hub Edit tin người khác → lỗi', err.includes('HubException'), err);
  await Promise.all([hA.stop(), hB.stop(), hD.stop()]);
} else console.log('(bỏ qua phần Realtime — đặt RT_URL)');

// ---------- Rời nhóm ----------
ok('C rời nhóm → 204', (await json(C.cookie, 'DELETE', `/api/chat/conversations/${G}/members/me`)).status === 204);
ok('C không còn thấy nhóm / đọc tin (404)', !(await convs(C)).some((c) => c.id === G) && (await json(C.cookie, 'GET', `/api/chat/conversations/${G}/messages`)).status === 404);
ok('rời nhóm 1-1 / Office → 404', (await json(A.cookie, 'DELETE', `/api/chat/conversations/office/members/me`)).status === 404);
const m2 = await send(A, G, { text: 'sau khi C rời' });
ok('người nhận còn A + B', m2.body?.recipients?.length === 2 && !m2.body.recipients.includes(C.userId), m2.body);

// ---------- Vé tải lên (đường dọn file mồ côi chạy trước khi cấp vé) ----------
const up = await json(A.cookie, 'POST', '/api/chat/uploads', { conversationId: G, fileName: 'a.png', contentType: 'image/png', size: 10 });
ok('xin vé tải lên vẫn 200 (dọn vé quá 24 giờ + file S3 trước đó)', up.status === 200 && !!up.body?.url, up);

// ---------- Token AI ----------
const tok = (await json(D.cookie, 'POST', '/api/auth/access-tokens', { name: 'e2e-cx', expiresInDays: 30 })).body?.token;
const ai = (method: string, path: string, body?: unknown) => fetch(API + path, { method, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => r.status);
const aiStatuses = [
  await ai('POST', '/api/chat/conversations/group', { title: 'bot', userIds: [A.userId] }),
  await ai('PATCH', `/api/chat/messages/${so.body.message.id}`, { text: 'x' }),
  await ai('POST', `/api/chat/messages/${so.body.message.id}/reactions`, { emoji: '👍' }),
  await ai('GET', '/api/chat/conversations/office/search?q=e2e'),
];
ok('token AI không tạo nhóm / sửa / thả cảm xúc / tìm (403)', !!tok && aiStatuses.every((s) => s === 403), aiStatuses);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
