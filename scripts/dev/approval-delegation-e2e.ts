// E2E: uỷ quyền duyệt (tạo / chặn tự uỷ quyền, trùng, quá hạn, quá 90 ngày, quyền HR, token AI), duyệt thay → bước HR, không tự duyệt,
// thu hồi → mất quyền, thông báo (chuông + Mailpit); nhắc hết thử việc (7 / 3 ngày, quá hạn, có HĐ tiếp theo thì không nhắc).
// TẠO NHÂN VIÊN THẬT → CHỈ chạy trên DB tạm + SMTP = Mailpit:
//   docker run -d --name e2e-appr-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:55443:5432 postgres:18-alpine
//   docker run -d --name e2e-appr-mail -p 127.0.0.1:11043:1025 -p 127.0.0.1:18043:8025 axllent/mailpit
//   Api: ASPNETCORE_URLS=http://localhost:5183 ConnectionStrings__Default="Host=127.0.0.1;Port=55443;Database=e2e;Username=e2e;Password=e2e"
//        Smtp__Host=127.0.0.1 Smtp__Port=11043 Smtp__UseSsl=false Smtp__Username= Smtp__Password= Seed__AdminEmail=… Seed__AdminPassword=…
//        dotnet run --project src/OfficeHub.Api --no-launch-profile
//   Pha a: E2E_LOCAL_DB=1 API_URL=http://localhost:5183 MAILPIT_URL=http://127.0.0.1:18043 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/approval-delegation-e2e.ts a
//   Pha b (nhắc thử việc — job chạy 30 s sau khi Api khởi động): khởi động lại Api, đợi ≥ 40 s → … approval-delegation-e2e.ts b
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';
if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5183';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:18043';
const phase = process.argv[2] ?? 'a';
// Admin: ADMIN_LOGIN / ADMIN_PASSWORD (khuyên dùng: chạy Api với Seed__AdminEmail / Seed__AdminPassword riêng cho DB tạm), không có thì đọc .env.
const envFile = Bun.file(new URL('../../.env', import.meta.url));
const env: Record<string, string> = (await envFile.exists()) ? Object.fromEntries((await envFile.text()).split('\n')
  .filter((l) => /^[A-Za-z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])) : {};
const ADMIN_LOGIN = process.env.ADMIN_LOGIN ?? env.Seed__AdminEmail, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? env.Seed__AdminPassword;
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Admin / HR bắt buộc 2FA (auth-2fa.md): bị buộc → tự bật; đã bật → nhập mã. Khoá lưu ra file tạm để pha b (tiến trình khác) dùng lại.
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
    // setup / enable cấp lại cookie (RefreshSignIn đổi claim) → luôn lấy cookie mới nhất
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
const json = async (cookie: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const PW = 'E2e-Local-2026';
// Tên miền thường (không phải .test) để email đi vào hàng đợi → Mailpit (Api trỏ SMTP vào Mailpit, không gửi thật).
const MAIL = 'officehub-e2e.vn';
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const bell = async (cookie: string) => ((await json(cookie, 'GET', '/api/notifications?take=100')).body?.items ?? []) as any[];
async function mailTo(to: string, subjectPart: string): Promise<any | null> {
  for (let i = 0; i < 30; i++) { // EmailDispatcher chạy mỗi 5 s
    const list = await (await fetch(`${MAILPIT}/api/v1/messages?limit=100`)).json();
    const m = list.messages?.find((x: any) => x.To?.some((t: any) => t.Address === to) && x.Subject.includes(subjectPart));
    if (m) return m;
    await sleep(500);
  }
  return null;
}

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');

const mkEmp = async (code: string, name: string, managerId: string | null, user: string, roles: string[] = ['employee']) => {
  const r = await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@${MAIL}`, phone: null, dateOfBirth: null,
    departmentId: null, positionId: null, managerId, status: 'Active', joinedAt: '2026-01-05', note: null });
  if (r.status >= 300) throw new Error(`Tạo ${code} lỗi: ${JSON.stringify(r.body)}`);
  const e = r.body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW), email: `${user}@${MAIL}` };
};
const findEmp = async (code: string) => ((await json(admin, 'GET', '/api/org/employees')).body as any[]).find((e) => e.code === code);

if (phase === 'a') {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });
  // ---------- Tổ chức nhỏ: quản lý M → nhân viên S, S2, người duyệt thay D; O không có cấp dưới ----------
  const M = await mkEmp('NV880', 'Quản Lý Uỷ Quyền', null, 'e2e.ql', ['manager']);
  const D = await mkEmp('NV881', 'Người Duyệt Thay', M.e.id, 'e2e.dt');
  const S = await mkEmp('NV882', 'Nhân Viên Một', M.e.id, 'e2e.nv1');
  const S2 = await mkEmp('NV883', 'Nhân Viên Hai', M.e.id, 'e2e.nv2');
  const O = await mkEmp('NV884', 'Người Ngoài', null, 'e2e.ngoai');
  ok('5 tài khoản đăng nhập', [M, D, S, S2, O].every((x) => !!x.cookie));

  // ---------- Kiểm tra hợp lệ ----------
  const create = (c: string, body: Record<string, unknown>) => json(c, 'POST', '/api/approval/delegations',
    { delegatorEmployeeId: null, delegateEmployeeId: D.e.id, fromDate: today, toDate: addDays(today, 6), note: null, ...body });
  const noSub = await create(O.cookie, {});
  ok('không có cấp dưới → 400 delegatorEmployeeId', noSub.status === 400 && !!noSub.body.errors?.delegatorEmployeeId, noSub.body);
  const self = await create(M.cookie, { delegateEmployeeId: M.e.id });
  ok('uỷ quyền cho chính mình → 400', self.status === 400 && self.body.errors?.delegateEmployeeId?.[0] === 'Không thể uỷ quyền cho chính mình', self.body);
  const tooLong = await create(M.cookie, { toDate: addDays(today, 90) });
  ok('quá 90 ngày → 400 toDate', tooLong.status === 400 && /90 ngày/.test(tooLong.body.errors?.toDate?.[0]), tooLong.body);
  const past = await create(M.cookie, { fromDate: addDays(today, -5), toDate: addDays(today, -1) });
  ok('khoảng ngày đã qua → 400', past.status === 400 && /đã qua/.test(past.body.errors?.toDate?.[0]), past.body);
  ok('nhân viên tạo thay người khác → 403', (await create(D.cookie, { delegatorEmployeeId: M.e.id, delegateEmployeeId: S.e.id })).status === 403);
  const tok = (await json(M.cookie, 'POST', '/api/auth/access-tokens', { name: 'e2e-deleg', expiresInDays: 30 })).body?.token;
  const aiRes = await fetch(`${API}/api/approval/delegations`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: JSON.stringify({ delegateEmployeeId: D.e.id, fromDate: today, toDate: today }) });
  ok('token AI không tạo được uỷ quyền', !!tok && [401, 403].includes(aiRes.status), aiRes.status);
  const aiList = await fetch(`${API}/api/approval/delegations`, { headers: { authorization: `Bearer ${tok}` } });
  ok('token AI xem được danh sách uỷ quyền', aiList.status === 200, aiList.status);

  // ---------- Tạo uỷ quyền M → D ----------
  const dg = await create(M.cookie, { note: 'Đi công tác' });
  ok('M uỷ quyền cho D (Active)', dg.status === 200 && dg.body.status === 'Active' && dg.body.canRevoke === true, dg.body);
  const overlap = await create(M.cookie, { delegateEmployeeId: S2.e.id, fromDate: addDays(today, 3), toDate: addDays(today, 10) });
  ok('trùng thời gian → 400 fromDate', overlap.status === 400 && /Trùng thời gian/.test(overlap.body.errors?.fromDate?.[0]), overlap.body);
  const mMine = (await json(M.cookie, 'GET', '/api/approval/delegations')).body;
  const dMine = (await json(D.cookie, 'GET', '/api/approval/delegations')).body;
  ok('M: canDelegate + đã giao 1; D: được nhận 1, không canDelegate', mMine.canDelegate && mMine.given.length === 1 && dMine.received.length === 1
    && !dMine.canDelegate && dMine.received[0].canRevoke === false, { mMine, dMine });
  ok('D: chuông có approval_delegation', (await bell(D.cookie)).some((n) => n.category === 'approval_delegation'));
  ok('D: email "uỷ quyền duyệt" trong Mailpit', !!(await mailTo(D.email, 'uỷ quyền duyệt')));

  // ---------- S gửi đơn → D duyệt thay → bước HR ----------
  const types = (await json(S.cookie, 'GET', '/api/leave/types')).body as any[];
  const unpaid = types.find((t) => t.code === 'unpaid') ?? types[types.length - 1];
  let day = addDays(today, 30);
  const nextWeekday = () => { do day = addDays(day, 1); while ([0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay())); return day; };
  const submit = async (c: string) => {
    const d = nextWeekday();
    const r = await json(c, 'POST', '/api/leave/requests', { leaveTypeId: unpaid.id, startDate: d, endDate: d, period: 'FullDay', reason: 'E2E uỷ quyền' });
    if (r.status >= 300) throw new Error(`Gửi đơn lỗi: ${JSON.stringify(r.body)}`);
    return r.body.approvalRequestId as string;
  };
  const a1 = await submit(S.cookie);
  const dInbox = (await json(D.cookie, 'GET', '/api/approval/inbox')).body as any[];
  const item = dInbox.find((x) => x.id === a1);
  ok('D thấy đơn của S trong hộp duyệt (duyệt thay M)', item?.canDecide === true && item?.decideOnBehalfOfName === 'Quản Lý Uỷ Quyền', dInbox);
  ok('D: số đơn chờ ≥ 1', (await json(D.cookie, 'GET', '/api/approval/inbox/count')).body.count >= 1);
  ok('M vẫn duyệt được (uỷ quyền không tước quyền)', ((await json(M.cookie, 'GET', '/api/approval/inbox')).body as any[]).some((x) => x.id === a1 && !x.decideOnBehalfOfName));
  ok('D: chuông có đơn chờ duyệt', (await bell(D.cookie)).some((n) => n.category === 'approval_requested'));
  ok('D: email "Đơn chờ bạn duyệt"', !!(await mailTo(D.email, 'Đơn chờ bạn duyệt')));
  const apr = await json(D.cookie, 'POST', `/api/approval/${a1}/approve`, { comment: 'OK thay sếp' });
  ok('D duyệt thay → chuyển bước HR, ghi "duyệt thay"', apr.status === 200 && apr.body.status === 'Pending' && apr.body.steps[0].status === 'Approved'
    && apr.body.steps[0].decidedByName === 'Người Duyệt Thay' && apr.body.steps[0].onBehalfOfName === 'Quản Lý Uỷ Quyền' && apr.body.steps[1].status === 'Pending', apr.body);
  ok('S: chuông "… (duyệt thay …) đã duyệt"', (await bell(S.cookie)).some((n) => n.category === 'approval_approved' && n.title.includes('duyệt thay Quản Lý Uỷ Quyền')));
  ok('D không duyệt được bước HR (403)', (await json(D.cookie, 'POST', `/api/approval/${a1}/approve`, {})).status === 403);
  ok('D vẫn xem được đơn đã duyệt thay', (await json(D.cookie, 'GET', `/api/approval/${a1}`)).status === 200);
  const hr = await json(admin, 'POST', `/api/approval/${a1}/approve`, {});
  ok('HR duyệt bước cuối → Approved', hr.status === 200 && hr.body.status === 'Approved', hr.body);

  // ---------- Không tự duyệt: D gửi đơn (quản lý của D = M) ----------
  const a2 = await submit(D.cookie);
  ok('D không thấy đơn của chính mình trong hộp duyệt', !((await json(D.cookie, 'GET', '/api/approval/inbox')).body as any[]).some((x) => x.id === a2));
  ok('D tự duyệt đơn của mình → 403', (await json(D.cookie, 'POST', `/api/approval/${a2}/approve`, {})).status === 403);
  await json(D.cookie, 'POST', `/api/approval/${a2}/cancel`);

  // ---------- Thu hồi ----------
  const a3 = await submit(S2.cookie);
  ok('D thấy đơn của S2', ((await json(D.cookie, 'GET', '/api/approval/inbox')).body as any[]).some((x) => x.id === a3));
  ok('D không thu hồi được (403)', (await json(D.cookie, 'POST', `/api/approval/delegations/${dg.body.id}/revoke`)).status === 403);
  const rv = await json(M.cookie, 'POST', `/api/approval/delegations/${dg.body.id}/revoke`);
  ok('M thu hồi → Revoked', rv.status === 200 && rv.body.status === 'Revoked' && rv.body.revokedByName === 'Quản Lý Uỷ Quyền', rv.body);
  ok('thu hồi lần 2 → 409', (await json(M.cookie, 'POST', `/api/approval/delegations/${dg.body.id}/revoke`)).status === 409);
  ok('D mất đơn của S2 trong hộp duyệt', !((await json(D.cookie, 'GET', '/api/approval/inbox')).body as any[]).some((x) => x.id === a3));
  ok('D duyệt sau khi thu hồi → 403', (await json(D.cookie, 'POST', `/api/approval/${a3}/approve`, {})).status === 403);
  ok('D xem đơn sau khi thu hồi → 403', (await json(D.cookie, 'GET', `/api/approval/${a3}`)).status === 403);
  ok('D: chuông + email "Đã thu hồi uỷ quyền"', (await bell(D.cookie)).some((n) => n.title.startsWith('Đã thu hồi uỷ quyền')) && !!(await mailTo(D.email, 'Đã thu hồi')));
  ok('sau thu hồi: tạo lại cùng khoảng được (không còn trùng)', (await create(M.cookie, { delegateEmployeeId: S.e.id, toDate: today })).status === 200);
  ok('M duyệt đơn của S2 (không ghi duyệt thay)', (await json(M.cookie, 'POST', `/api/approval/${a3}/approve`, {})).body?.steps?.[0]?.onBehalfOfName === null);

  // ---------- HR tạo / thu hồi thay ----------
  const hrDg = await create(admin, { delegatorEmployeeId: M.e.id, fromDate: addDays(today, 10), toDate: addDays(today, 12) });
  ok('HR tạo uỷ quyền thay M (Upcoming)', hrDg.status === 200 && hrDg.body.status === 'Upcoming' && hrDg.body.delegator.id === M.e.id, hrDg.body);
  ok('M: chuông "HR đã đặt uỷ quyền"', (await bell(M.cookie)).some((n) => n.category === 'approval_delegation' && n.title.startsWith('HR đã đặt')));
  ok('chưa tới ngày → D chưa có quyền duyệt', !((await json(D.cookie, 'GET', '/api/approval/inbox')).body as any[]).length);
  const all = (await json(admin, 'GET', '/api/approval/delegations/all')).body as any[];
  ok('HR xem toàn bộ (đang / sắp hiệu lực)', all.some((d) => d.id === hrDg.body.id) && !all.some((d) => d.id === dg.body.id), all.map((d) => d.status));
  ok('HR xem cả đã thu hồi (?status=all)', ((await json(admin, 'GET', '/api/approval/delegations/all?status=all')).body as any[]).some((d) => d.id === dg.body.id));
  ok('nhân viên không xem được toàn bộ (403)', (await json(D.cookie, 'GET', '/api/approval/delegations/all')).status === 403);
  ok('HR thu hồi', (await json(admin, 'POST', `/api/approval/delegations/${hrDg.body.id}/revoke`)).body?.status === 'Revoked');

  // ---------- Chuẩn bị nhắc thử việc (kiểm tra ở pha b) ----------
  const mkContract = (employeeId: string, number: string, type: string, start: string, end: string | null) => json(admin, 'POST', '/api/contracts',
    { employeeId, number, type, signedDate: null, startDate: start, endDate: end, jobTitle: null, salary: null, allowance: null, note: null });
  const p1 = await mkContract(S.e.id, 'E2E-TV-1', 'Probation', addDays(today, -57), addDays(today, 3));      // còn 3 ngày, chưa có HĐ tiếp
  const p2 = await mkContract(S2.e.id, 'E2E-TV-2', 'Probation', addDays(today, -55), addDays(today, 5));     // có HĐ tiếp theo → không nhắc
  const p2n = await mkContract(S2.e.id, 'E2E-HD-2', 'Fixed', addDays(today, 6), addDays(today, 370));
  const p3 = await mkContract(D.e.id, 'E2E-TV-3', 'Probation', addDays(today, -60), addDays(today, -1));     // hết hôm qua → quá hạn
  const f1 = await mkContract(O.e.id, 'E2E-HD-4', 'Fixed', addDays(today, -300), addDays(today, 5));          // HĐ thường → nhắc chung 7 ngày
  ok('tạo 5 hợp đồng cho pha b', [p1, p2, p2n, p3, f1].every((r) => r.status === 200 || r.status === 201), [p1, p2, p2n, p3, f1].map((r) => r.body));
  console.log('→ Khởi động lại Api, đợi ≥ 40 s rồi chạy pha b.');
}

if (phase === 'b') {
  const M = await login('e2e.ql', PW), S = await login('e2e.nv1', PW);
  const bAdmin = await bell(admin), bM = await bell(M);
  const prob = (rows: any[]) => rows.filter((n) => n.category === 'probation_ending');
  const t1 = prob(bAdmin).filter((n) => n.title.includes('Nhân Viên Một'));
  ok('HR: nhắc thử việc NV1 (còn 3 ngày) đúng 1 lần, có Điều 27', t1.length === 1 && t1[0].title.includes('còn 3 ngày') && t1[0].body.includes('Điều 27')
    && t1[0].body.includes('Đánh giá kết quả thử việc'), prob(bAdmin));
  ok('quản lý trực tiếp cũng nhận', prob(bM).some((n) => n.title.includes('Nhân Viên Một')));
  ok('có HĐ tiếp theo → không nhắc NV2', !prob(bAdmin).some((n) => n.title.includes('Nhân Viên Hai')));
  const over = prob(bAdmin).filter((n) => n.title.startsWith('Quá hạn') && n.title.includes('Người Duyệt Thay'));
  ok('thử việc hết hôm qua → cảnh báo quá hạn đúng 1 lần', over.length === 1, prob(bAdmin));
  ok('nhân viên không nhận nhắc thử việc của chính mình', !prob(await bell(S)).length);
  ok('HĐ thử việc không còn nhắc chung contract_expiring', !bAdmin.some((n) => n.category === 'contract_expiring' && /E2E-TV/.test(n.title)));
  ok('HĐ thường vẫn nhắc chung (7 ngày)', bAdmin.some((n) => n.category === 'contract_expiring' && n.title.includes('E2E-HD-4')));
  const m = await mailTo(`e2e.ql@${MAIL}`, 'Thử việc của Nhân Viên Một');
  ok('email nhắc thử việc tới quản lý (Mailpit)', !!m);
  const nv1 = await findEmp('NV882');
  ok('dữ liệu pha a còn', !!nv1);
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
