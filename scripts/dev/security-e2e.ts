// E2E: rà soát bảo mật (dự án TEST) — huỷ phiên & token (TEST-12), đăng nhập & hạn mức (TEST-20).
// TẠO TÀI KHOẢN THẬT → CHỈ chạy trên DB tạm + SMTP = Mailpit:
//   docker run -d --name e2e-sec-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:55461:5432 postgres:18-alpine
//   docker run -d --name e2e-sec-mail -p 127.0.0.1:11061:1025 -p 127.0.0.1:18061:8025 axllent/mailpit
//   Api (từ backend/): env ASPNETCORE_URLS=http://localhost:5185 'ConnectionStrings__Default=Host=127.0.0.1;Port=55461;Database=e2e;Username=e2e;Password=e2e'
//        Smtp__Host=127.0.0.1 Smtp__Port=11061 Smtp__UseSsl=false Smtp__Username= Smtp__Password=
//        Seed__AdminEmail=sec-admin@officehub-e2e.vn Seed__AdminPassword=Sec-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5185 MAILPIT_URL=http://127.0.0.1:18061 PG_CONTAINER=e2e-sec-pg bun scripts/dev/security-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { $ } from 'bun';
import { totp } from './totp';
if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5185';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:18061';
const PG = process.env.PG_CONTAINER ?? 'e2e-sec-pg';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN ?? 'sec-admin@officehub-e2e.vn', ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Sec-Admin-2026';
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sql = (q: string) => $`docker exec ${PG} psql -U e2e -d e2e -tAc ${q}`.text();
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith(name + '=')).at(-1) ?? '';
const rawLogin = (login: string, password: string) =>
  fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password }) });
const login = async (login: string, password: string): Promise<string> => {
  const r = await rawLogin(login, password);
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
const json = async (cookie: string, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any, res: r };
};
const bearer = (token: string, path = '/api/auth/me') => fetch(API + path, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.status);
const PW = 'E2e-Sec-2026';
const MAIL = 'officehub-e2e.vn';
const stamp = Date.now().toString(36).slice(-4);
async function mailTo(to: string, subjectPart: string): Promise<any | null> {
  for (let i = 0; i < 30; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/messages?limit=100`)).json();
    const m = list.messages?.find((x: any) => x.To?.some((t: any) => t.Address === to) && x.Subject.includes(subjectPart));
    if (m) return m;
    await sleep(500);
  }
  return null;
}

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });

/** Tạo nhân viên + tài khoản mật khẩu tạm; trả cookie đang ở trạng thái mật khẩu tạm. */
const mkTemp = async (code: string, user: string) => {
  const r = await json(admin, 'POST', '/api/org/employees', { code, fullName: `Bảo Mật ${code}`, email: `${user}@${MAIL}`, phone: null, dateOfBirth: null,
    departmentId: null, positionId: null, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null });
  if (r.status >= 300) throw new Error(`Tạo ${code} lỗi: ${JSON.stringify(r.body)}`);
  const e = r.body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  return { e, user, email: `${user}@${MAIL}`, temp: acc.tempPassword as string, cookie: await login(user, acc.tempPassword) };
};

// ================= TEST-12: mật khẩu tạm bị chặn ở server =================
const A = await mkTemp(`SEC-${stamp}-A`, `e2e.sec.a${stamp}`);
const blocked = await json(A.cookie, 'GET', '/api/org/employees');
ok('mật khẩu tạm: API khác → 403 password_change_required', blocked.status === 403 && blocked.body?.title === 'password_change_required', blocked);
ok('mật khẩu tạm: /auth/me vẫn 200', (await json(A.cookie, 'GET', '/api/auth/me')).status === 200);
ok('mật khẩu tạm: tạo token → 403', (await json(A.cookie, 'POST', '/api/auth/access-tokens', { name: 'x', expiresInDays: 30 })).status === 403);
const ch = await json(A.cookie, 'POST', '/api/auth/change-password', { currentPassword: A.temp, newPassword: PW });
ok('đổi mật khẩu tạm → 204', ch.status === 204, ch.body);
let a = cookieOf(ch.res, 'officehub.auth');
ok('sau đổi mật khẩu: API dùng được', (await json(a, 'GET', '/api/auth/access-tokens')).status === 200);

// ================= TEST-12: tạo token cần xác nhận (trừ khi vừa đăng nhập) =================
a = await login(A.user, PW);
const t1 = await json(a, 'POST', '/api/auth/access-tokens', { name: 'vừa đăng nhập', expiresInDays: 30 });
ok('vừa đăng nhập ≤ 10 phút: tạo token không cần xác nhận', t1.status === 200 && !!t1.body?.token, t1.body);
await sql(`UPDATE identity.users SET "LastLoginAt" = now() - interval '1 hour' WHERE "UserName" = '${A.user}'`);
const t2 = await json(a, 'POST', '/api/auth/access-tokens', { name: 'thiếu xác nhận', expiresInDays: 30 });
ok('đăng nhập lâu rồi + thiếu confirm → 400 errors.confirm', t2.status === 400 && !!t2.body?.errors?.confirm, t2.body);
const t3 = await json(a, 'POST', '/api/auth/access-tokens', { name: 'sai', expiresInDays: 30, confirm: 'sai-mat-khau' });
ok('confirm sai → 400', t3.status === 400 && !!t3.body?.errors?.confirm, t3.body);
const failed = Number((await sql(`SELECT "AccessFailedCount" FROM identity.users WHERE "UserName" = '${A.user}'`)).trim());
ok('confirm sai → tăng AccessFailedCount', failed >= 2, failed);
const t4 = await json(a, 'POST', '/api/auth/access-tokens', { name: 'đúng', expiresInDays: 30, confirm: PW });
ok('confirm = mật khẩu đúng → 200', t4.status === 200 && !!t4.body?.token, t4.body);
const tokA1 = t1.body.token as string, tokA2 = t4.body.token as string;
ok('token dùng được', (await bearer(tokA1)) === 200 && (await bearer(tokA2)) === 200);

// ================= TEST-12: đăng xuất đổi security stamp =================
const copy = a; // "bản sao cookie" bị chép
const lo = await json(a, 'POST', '/api/auth/logout');
ok('đăng xuất → 204', lo.status === 204);
ok('bản sao cookie sau đăng xuất → 401', (await json(copy, 'GET', '/api/auth/me')).status === 401);
ok('đăng xuất web KHÔNG ngắt token AI', (await bearer(tokA1)) === 200);

// ================= TEST-12: tự đổi mật khẩu → thu hồi token AI =================
a = await login(A.user, PW);
const PW2 = PW + '!';
ok('tự đổi mật khẩu → 204', (await json(a, 'POST', '/api/auth/change-password', { currentPassword: PW, newPassword: PW2 })).status === 204);
ok('sau đổi mật khẩu: mọi token AI → 401', (await bearer(tokA1)) === 401 && (await bearer(tokA2)) === 401);

// ================= TEST-12: HR cấp mật khẩu tạm → thu hồi token + báo chính chủ =================
a = await login(A.user, PW2);
const t5 = (await json(a, 'POST', '/api/auth/access-tokens', { name: 'trước khi HR reset', expiresInDays: 30 })).body?.token as string;
ok('token mới dùng được', (await bearer(t5)) === 200);
const rp = await json(admin, 'POST', `/api/org/employees/${A.e.id}/account/reset-password`);
ok('HR cấp mật khẩu tạm → 200', rp.status === 200 && !!rp.body?.tempPassword, rp);
ok('HR reset: token AI → 401', (await bearer(t5)) === 401);
ok('HR reset: cookie cũ → 401', (await json(a, 'GET', '/api/auth/me')).status === 401);
const bellA = await login(A.user, rp.body.tempPassword);
ok('HR reset: email tới chính chủ', !!(await mailTo(A.email, 'Mật khẩu đã được đặt lại')));
const ch2 = await json(bellA, 'POST', '/api/auth/change-password', { currentPassword: rp.body.tempPassword, newPassword: PW });
a = await login(A.user, PW);
const notes = (await json(a, 'GET', '/api/notifications?take=20')).body?.items ?? [];
ok('HR reset: chuông "Mật khẩu đã được đặt lại"', notes.some((n: any) => n.title === 'Mật khẩu đã được đặt lại'), notes.map((n: any) => n.title));

// ================= TEST-12: khoá tài khoản → token không sống lại khi mở lại =================
const t6 = (await json(a, 'POST', '/api/auth/access-tokens', { name: 'trước khi khoá', expiresInDays: 30 })).body?.token as string;
ok('token trước khi khoá dùng được', ch2.status === 204 && (await bearer(t6)) === 200);
const off = await json(admin, 'POST', `/api/org/employees/${A.e.id}/resign`, { leftAt: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }) });
const on = await json(admin, 'POST', `/api/org/employees/${A.e.id}/reactivate`);
ok('nghỉ việc (khoá) rồi đi làm lại (mở)', off.status < 300 && on.status < 300, [off.status, on.status, off.body, on.body]);
ok('mở lại: token cũ vẫn 401', (await bearer(t6)) === 401);

// ================= TEST-20: đăng nhập & hạn mức =================
const B = await mkTemp(`SEC-${stamp}-B`, `e2e.sec.b${stamp}`);
await json(B.cookie, 'POST', '/api/auth/change-password', { currentPassword: B.temp, newPassword: PW });
// Phản hồi đồng nhất: không có tài khoản / sai mật khẩu → cùng status + cùng thông điệp
const noUser = await rawLogin(`khong.ton.tai.${stamp}`, 'Sai-Mat-Khau-1');
const badPw = await rawLogin(B.user, 'Sai-Mat-Khau-1');
const [nb, bb] = [await noUser.json() as any, await badPw.json() as any];
ok('không có tài khoản và sai mật khẩu → cùng 401 + cùng thông điệp', noUser.status === 401 && badPw.status === 401 && nb.detail === bb.detail, [nb, bb]);
// 5 lần sai từ cùng IP → chặn (kể cả mật khẩu đúng) nhưng KHÔNG khoá tài khoản ở DB
for (let i = 0; i < 4; i++) await rawLogin(B.user, 'Sai-Mat-Khau-1');
const blockedRight = await rawLogin(B.user, PW);
const bj = await blockedRight.json() as any;
ok('sai 5 lần → IP bị chặn, mật khẩu đúng vẫn 401 cùng thông điệp', blockedRight.status === 401 && bj.detail === bb.detail, [blockedRight.status, bj]);
const lockEnd = (await sql(`SELECT coalesce("LockoutEnd"::text, '') FROM identity.users WHERE "UserName" = '${B.user}'`)).trim();
ok('tài khoản KHÔNG bị khoá trong DB (người khác không khoá được nạn nhân)', lockEnd === '' || new Date(lockEnd) < new Date(), lockEnd);
// Tài khoản thật bị khoá (vd sai mã 2FA) → cũng trả cùng phản hồi, không lộ 423
await sql(`UPDATE identity.users SET "LockoutEnd" = now() + interval '10 minutes' WHERE "UserName" = '${A.user}'`);
const lockedRes = await rawLogin(A.user, 'Sai-Mat-Khau-1');
const lj = await lockedRes.json() as any;
ok('tài khoản đang khoá → 401 cùng thông điệp (không 423)', lockedRes.status === 401 && lj.detail === bb.detail, [lockedRes.status, lj]);
await sql(`UPDATE identity.users SET "LockoutEnd" = NULL WHERE "UserName" = '${A.user}'`);

// Quên mật khẩu: 204 ngay (gửi nền), hạn mức 3 / email / giờ, link 1 giờ
await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });
const forgot = (email: string) => fetch(`${API}/api/auth/forgot-password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
const t0 = performance.now();
const f1 = await forgot(A.email);
const dt = performance.now() - t0;
ok('quên mật khẩu → 204 nhanh (không chờ SMTP)', f1.status === 204 && dt < 1500, [f1.status, Math.round(dt)]);
ok('quên mật khẩu: email không tồn tại → 204', (await forgot(`khong.co.${stamp}@${MAIL}`)).status === 204);
const resetMail = await mailTo(A.email, 'Đặt lại mật khẩu');
ok('email đặt lại tới (gửi nền)', !!resetMail);
const body = resetMail ? await (await fetch(`${MAILPIT}/api/v1/message/${resetMail.ID}`)).json() as any : null;
ok('email ghi "hết hạn sau 1 giờ"', !!body?.HTML?.includes('1 giờ'));
await forgot(A.email); await forgot(A.email); await forgot(A.email); // lần 2, 3, 4
await sleep(3000);
const all = await (await fetch(`${MAILPIT}/api/v1/messages?limit=100`)).json() as any;
const toA = all.messages.filter((m: any) => m.To?.some((t: any) => t.Address === A.email) && m.Subject.includes('Đặt lại mật khẩu')).length;
ok('hạn mức 3 email / địa chỉ / giờ', toA === 3, toA);
// Link đặt lại hoạt động
const link = body?.HTML?.match(/href="([^"]+reset-password[^"]+)"/)?.[1]?.replaceAll('&amp;', '&');
const u = link ? new URL(link) : null;
const rs = await fetch(`${API}/api/auth/reset-password`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ userId: u?.searchParams.get('uid'), token: u?.searchParams.get('token'), newPassword: PW + '#' }) });
ok('link đặt lại 1 giờ dùng được → 204', rs.status === 204, rs.status);
// Link mời (72 giờ) vẫn hoạt động cho tài khoản chưa có mật khẩu
const ie = await json(admin, 'POST', '/api/org/employees', { code: `SEC-${stamp}-I`, fullName: 'Được Mời', email: `e2e.sec.i${stamp}@${MAIL}`, phone: null,
  dateOfBirth: null, departmentId: null, positionId: null, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null });
const inv = await json(admin, 'POST', `/api/org/employees/${ie.body.employee.id}/account`, { mode: 'invite', roles: ['employee'], userName: `e2e.sec.i${stamp}` });
const im = await mailTo(`e2e.sec.i${stamp}@${MAIL}`, 'Lời mời');
const ib = im ? await (await fetch(`${MAILPIT}/api/v1/message/${im.ID}`)).json() as any : null;
const il = ib?.HTML?.match(/href="([^"]+accept-invite[^"]+)"/)?.[1]?.replaceAll('&amp;', '&');
const iu = il ? new URL(il) : null;
ok('email mời ghi 72 giờ', inv.status < 300 && !!ib?.HTML?.includes('72 giờ'), inv);
const accept = (pw: string) => fetch(`${API}/api/auth/reset-password`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ userId: iu?.searchParams.get('uid'), token: iu?.searchParams.get('token'), newPassword: pw }) });
ok('nhận lời mời → 204', (await accept(PW)).status === 204);
ok('link mời dùng lần 2 → 400', (await accept(PW + '2')).status === 400);
ok('đăng nhập bằng mật khẩu vừa đặt từ lời mời', !!(await login(`e2e.sec.i${stamp}`, PW)));

// Đổi mật khẩu: sai mật khẩu hiện tại tính vào khoá
let bck = await login(`e2e.sec.i${stamp}`, PW);
for (let i = 0; i < 5; i++) await json(bck, 'POST', '/api/auth/change-password', { currentPassword: 'sai-sai-sai', newPassword: PW + '9' });
const lockedCh = await json(bck, 'POST', '/api/auth/change-password', { currentPassword: PW, newPassword: PW + '9' });
ok('sai mật khẩu hiện tại 5 lần → bị tạm khoá kể cả khi nhập đúng', lockedCh.status === 400 && /khoá/.test(JSON.stringify(lockedCh.body)), lockedCh.body);

// ================= TEST-10: tách nhiệm vụ duyệt =================
await sleep(61_000); // hạn mức 30 lần đăng nhập / phút / IP
const mkUser = async (code: string, user: string, roles: string[], managerId: string | null = null, fullName = `Tách Nhiệm Vụ ${code}`) => {
  const r = await json(admin, 'POST', '/api/org/employees', { code, fullName, email: `${user}@${MAIL}`, phone: null, dateOfBirth: null,
    departmentId: null, positionId: null, managerId, status: 'Active', joinedAt: '2026-01-05', note: null });
  if (r.status >= 300) throw new Error(`Tạo ${code} lỗi: ${JSON.stringify(r.body)}`);
  const acc = (await json(admin, 'POST', `/api/org/employees/${r.body.employee.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c0 = await login(user, acc.tempPassword);
  await json(c0, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e: r.body.employee, cookie: await login(user, PW) };
};
const MH = await mkUser(`SEC-${stamp}-MH`, `e2e.sec.mh${stamp}`, ['manager', 'hr']);   // quản lý kiêm HR
const H = await mkUser(`SEC-${stamp}-H`, `e2e.sec.h${stamp}`, ['hr']);                   // HR khác
const S = await mkUser(`SEC-${stamp}-S`, `e2e.sec.s${stamp}`, ['employee'], MH.e.id);   // nhân viên của MH
ok('tạo 3 tài khoản (quản lý kiêm HR, HR, nhân viên)', !!MH.cookie && !!H.cookie && !!S.cookie);
const types = (await json(S.cookie, 'GET', '/api/leave/types')).body as any[];
const unpaid = types.find((t) => t.code === 'unpaid') ?? types[types.length - 1];
const leaveDay = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 40); while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
const lr = await json(S.cookie, 'POST', '/api/leave/requests', { leaveTypeId: unpaid.id, startDate: leaveDay, endDate: leaveDay, period: 'FullDay', reason: 'E2E tách nhiệm vụ' });
const reqId = lr.body?.approvalRequestId as string;
ok('nhân viên gửi đơn nghỉ', lr.status < 300 && !!reqId, lr.body);
const m1 = await json(MH.cookie, 'POST', `/api/approval/${reqId}/approve`, { comment: null });
ok('quản lý duyệt bước quản lý', m1.status === 200, m1.body);
const m2 = await json(MH.cookie, 'POST', `/api/approval/${reqId}/approve`, { comment: null });
ok('cùng người (kiêm HR) duyệt tiếp bước HR → 403', m2.status === 403, m2);
const inboxMH = (await json(MH.cookie, 'GET', '/api/approval/inbox')).body as any[];
ok('đơn không còn trong hộp duyệt của người đã duyệt bước trước', !JSON.stringify(inboxMH ?? []).includes(reqId));
ok('HR khác duyệt bước HR → 200', (await json(H.cookie, 'POST', `/api/approval/${reqId}/approve`, { comment: null })).status === 200);

const today2 = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const selfDel = await json(H.cookie, 'POST', '/api/approval/delegations', { delegatorEmployeeId: MH.e.id, delegateEmployeeId: H.e.id, fromDate: today2, toDate: today2, note: null });
ok('HR tạo hộ uỷ quyền mà người nhận là chính mình → 403', selfDel.status === 403, selfDel);
const otherDel = await json(H.cookie, 'POST', '/api/approval/delegations', { delegatorEmployeeId: MH.e.id, delegateEmployeeId: S.e.id, fromDate: today2, toDate: today2, note: null });
ok('HR tạo hộ uỷ quyền cho người khác → 200', otherDel.status === 200, otherDel);

const pr = await json(H.cookie, 'POST', '/api/org/profile/me/requests', { change: { bankName: 'Vietcombank', bankAccount: '0123456789', bankAccountHolder: 'tach nhiem vu' }, note: null });
ok('HR gửi yêu cầu đổi STK của mình', pr.status === 200, pr.body);
ok('HR tự duyệt yêu cầu của mình → 403', (await json(H.cookie, 'POST', `/api/org/profile/requests/${pr.body.id}/approve`)).status === 403);
ok('HR khác duyệt → 200', (await json(MH.cookie, 'POST', `/api/org/profile/requests/${pr.body.id}/approve`)).status === 200);
const selfEdit = await json(H.cookie, 'PUT', `/api/org/profile/employees/${H.e.id}`, { contact: {}, sensitive: { bankAccount: '999' } });
ok('HR sửa thẳng hồ sơ nhạy cảm của mình → 403', selfEdit.status === 403, selfEdit);
const otherEdit = await json(H.cookie, 'GET', `/api/org/profile/employees/${S.e.id}`);
ok('HR vẫn xem / sửa được hồ sơ người khác', otherEdit.status === 200);

const per = await json(H.cookie, 'POST', '/api/payroll/periods', { month: '2026-09' });
const perId = per.body?.id ?? ((await json(H.cookie, 'GET', '/api/payroll/periods')).body as any[])?.find((x: any) => x.month === '2026-09')?.id;
if (perId) {
  const own = await json(H.cookie, 'POST', `/api/payroll/periods/${perId}/adjustments`, { employeeId: H.e.id, label: 'Thưởng tự cho', amount: 5000000, taxable: true });
  ok('HR tự thêm khoản cộng lương của mình → 403', own.status === 403, own);
  const oth = await json(H.cookie, 'POST', `/api/payroll/periods/${perId}/adjustments`, { employeeId: S.e.id, label: 'x', amount: 1, taxable: true });
  ok('HR thêm khoản cho người khác không bị chặn bởi luật này (≠ 403)', oth.status !== 403, oth);
} else ok('tạo kỳ lương để thử', false, per);

// ================= TEST-14: quyền sửa / xoá trong dự án, hợp đồng bán, push token =================
await sleep(61_000);
const twin = `Trùng Tên ${stamp}`;
const X1 = await mkUser(`SEC-${stamp}-X1`, `e2e.sec.x1${stamp}`, ['employee'], MH.e.id, twin);
const X2 = await mkUser(`SEC-${stamp}-X2`, `e2e.sec.x2${stamp}`, ['employee'], MH.e.id, twin);
const prj = await json(MH.cookie, 'POST', '/api/projects', { code: `SEC${stamp}`.toUpperCase(), name: 'Dự án bảo mật', kind: 'Internal', memberIds: [X1.e.id, X2.e.id], sequential: false });
ok('quản lý tạo dự án nội bộ', prj.status === 201, prj);
const tk = await json(X1.cookie, 'POST', `/api/projects/${prj.body}/tasks`, { title: 'Việc của X1' });
ok('X1 tạo việc', tk.status === 201, tk);
const delTwin = await json(X2.cookie, 'DELETE', `/api/projects/tasks/${tk.body}`);
ok('X2 trùng HỌ TÊN với người tạo xoá việc → 403', delTwin.status === 403, delTwin);
ok('X1 (người tạo) xoá việc của mình → 204', (await json(X1.cookie, 'DELETE', `/api/projects/tasks/${tk.body}`)).status === 204);

const cust = (await json(S.cookie, 'POST', '/api/sales/customers', { name: `Khách bảo mật ${stamp}` })).body;
const kc = await json(S.cookie, 'POST', '/api/sales/contracts', { code: `HD-SEC-${stamp}`, customerId: cust, title: 'HĐ bảo mật', valueBeforeTax: 10_000_000, vatRate: 0,
  signedOn: today2, billing: 'Milestone', installments: [{ title: 'Một đợt', dueOn: today2, amount: 10_000_000 }] });
ok('nhân viên S tạo hợp đồng bán (S phụ trách)', kc.status === 201, kc);
const clientPrj = (who: string, code: string) => json(who, 'POST', '/api/projects', { code, name: 'Dự án cho khách', kind: 'Client', salesContractIds: [kc.body], memberIds: [], sequential: false });
const hrLink = await clientPrj(H.cookie, `SECH${stamp}`.toUpperCase());
ok('HR (không có quyền Sales với HĐ) gắn hợp đồng → 400', hrLink.status === 400 && /quyền/.test(JSON.stringify(hrLink.body?.errors?.salesContractIds)), hrLink.body);
const hrSearch = (await json(H.cookie, 'GET', `/api/projects/sales-contracts?search=HD-SEC-${stamp}`)).body as any[];
ok('HR không thấy HĐ của người khác trong ô tìm', Array.isArray(hrSearch) && hrSearch.length === 0, hrSearch);
const mhSearch = (await json(MH.cookie, 'GET', `/api/projects/sales-contracts?search=HD-SEC-${stamp}`)).body as any[];
ok('quản lý của người phụ trách thấy HĐ', Array.isArray(mhSearch) && mhSearch.length === 1, mhSearch);
ok('quản lý của người phụ trách gắn HĐ → 201', (await clientPrj(MH.cookie, `SECM${stamp}`.toUpperCase())).status === 201);

const ptok = `fcm-sec-${stamp}`;
ok('X1 đăng ký push token', (await json(X1.cookie, 'PUT', '/api/notifications/push-tokens', { token: ptok })).status === 204);
await json(X2.cookie, 'DELETE', '/api/notifications/push-tokens', { token: ptok });
ok('người khác gỡ push token của X1 → token vẫn còn', (await sql(`SELECT count(*) FROM notifications.push_tokens WHERE "Token" = '${ptok}'`)).trim() === '1');
await json(X1.cookie, 'DELETE', '/api/notifications/push-tokens', { token: ptok });
ok('chính chủ gỡ được', (await sql(`SELECT count(*) FROM notifications.push_tokens WHERE "Token" = '${ptok}'`)).trim() === '0');

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
