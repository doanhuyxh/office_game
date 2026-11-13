// E2E: tool Nhân sự chỉ đọc cho agent (TEST-79) — hồ sơ cơ bản (DTO riêng, không trường nhạy cảm), quỹ phép một người,
// giải trình / tăng ca đang chờ trong phạm vi (HR mọi người, quản lý bản thân + cấp dưới, nhân viên thường 403), allowlist token
// (GET /employees/{id}, /export, /org/profile, /contracts, /payroll, /leave/balances → 403); MCP thật khi có MCP_URL.
// TẠO NHÂN VIÊN THẬT → CHỈ chạy trên DB tạm:
//   docker run -d --name e2e-hr-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:55479:5432 postgres:18-alpine
//   Api (từ backend/): env ASPNETCORE_URLS=http://localhost:5189 'ConnectionStrings__Default=Host=127.0.0.1;Port=55479;Database=e2e;Username=e2e;Password=e2e'
//        Seed__AdminEmail=hr-admin@officehub-e2e.vn Seed__AdminPassword=Hr-Admin-2026 Smtp__Host=127.0.0.1 Smtp__Port=11025 Smtp__UseSsl=false \
//        dotnet run --project src/OfficeHub.Api --no-launch-profile
//   MCP tuỳ chọn: env Mcp__ApiBaseUrl=http://localhost:5189 ASPNETCORE_URLS=http://localhost:5209 dotnet run --project src/OfficeHub.Mcp --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5189 ADMIN_LOGIN=hr-admin@officehub-e2e.vn ADMIN_PASSWORD=Hr-Admin-2026 MCP_URL=http://localhost:5209/mcp \
//     bun scripts/dev/hr-read-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5180';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
// Đăng nhập trả 2 Set-Cookie cùng tên (đổi security stamp rồi cấp lại) → lấy cái CUỐI như trình duyệt.
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
const PW = 'E2e-Local-2026';
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const stamp = Date.now().toString(36).slice(-5);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const addDays = (d: number) => new Date(Date.parse(today) + d * 86400000).toISOString().slice(0, 10);

// ---------- Nhân viên: M quản lý S, S quản lý S2 (M → S2 gián tiếp); O người ngoài; H là HR ----------
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Nhân sự E2E ${stamp}`, code: `NS${stamp}` })).body;
const mkEmp = async (code: string, name: string, managerId: string | null, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: '0900000000', dateOfBirth: '1990-01-02',
    departmentId: dept, positionId: null, managerId, status: 'Probation', joinedAt: '2026-01-05', note: 'ghi chú riêng HR', jobTitle: 'Lập trình viên' })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const token = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `e2e ${stamp}`, expiresInDays: 30 })).body?.token as string;
  return { e, cookie, token };
};
const M = await mkEmp(`HM${stamp}`, 'Quản Lý HR E2E', null, `e2e.hr.mgr.${stamp}`, ['employee', 'manager']);
const S = await mkEmp(`HS${stamp}`, 'Nhân Viên HR E2E', M.e.id, `e2e.hr.staff.${stamp}`, ['employee', 'manager']);
const S2 = await mkEmp(`HT${stamp}`, 'Cấp Dưới 2 E2E', S.e.id, `e2e.hr.sub.${stamp}`, ['employee']);
const O = await mkEmp(`HO${stamp}`, 'Người Ngoài E2E', null, `e2e.hr.other.${stamp}`, ['employee']);
const H = await mkEmp(`HH${stamp}`, 'Nhân Sự HR E2E', null, `e2e.hr.hr.${stamp}`, ['employee', 'hr']);
ok('5 nhân viên đăng nhập + có token AI', [M, S, S2, O, H].every((x) => !!x.cookie && x.token?.startsWith('ohk_')));
const ai = async (who: { token: string }, path: string, method = 'GET') => {
  const r = await fetch(API + path, { method, headers: { authorization: `Bearer ${who.token}`, 'content-type': 'application/json' } });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};

// ---------- get_employee: GET /api/org/employees/{id}/summary ----------
const sum = (who: { token: string }, id: string) => ai(who, `/api/org/employees/${id}/summary`);
const hs = await sum(H, S.e.id);
const KEYS = ['id', 'code', 'fullName', 'departmentId', 'departmentName', 'positionName', 'positionLevel', 'jobTitle', 'managerId', 'managerCode', 'managerName', 'joinedAt', 'leftAt', 'status'];
ok('HR token xem hồ sơ cơ bản S: đúng trường', hs.status === 200 && hs.body.code === S.e.code && hs.body.managerCode === M.e.code && hs.body.status === 'Probation'
  && hs.body.joinedAt === '2026-01-05' && hs.body.jobTitle === 'Lập trình viên' && hs.body.departmentName?.includes('Nhân sự E2E'), hs);
ok('Phản hồi CHỈ gồm tập trường đã chốt (không email / điện thoại / ngày sinh / ghi chú / tài khoản / CCCD / ngân hàng / địa chỉ / lương)',
  JSON.stringify(Object.keys(hs.body ?? {}).sort()) === JSON.stringify([...KEYS].sort()), Object.keys(hs.body ?? {}));
const raw = JSON.stringify(hs.body);
ok('Không lộ giá trị nhạy cảm trong JSON', !raw.includes('1990-01-02') && !raw.includes('ghi chú riêng') && !raw.includes('0900000000') && !raw.includes('@e2e.test'));
ok('HR token xem người ngoài O → 200', (await sum(H, O.e.id)).status === 200);
ok('Quản lý M: bản thân, cấp dưới trực tiếp S, gián tiếp S2 → 200', [(await sum(M, M.e.id)).status, (await sum(M, S.e.id)).status, (await sum(M, S2.e.id)).status].every((x) => x === 200));
ok('Quản lý M xem O (không phải cấp dưới) → 403', (await sum(M, O.e.id)).status === 403);
ok('Nhân viên thường S2: bản thân 200, quản lý / người khác 403', (await sum(S2, S2.e.id)).status === 200
  && (await sum(S2, S.e.id)).status === 403 && (await sum(S2, O.e.id)).status === 403);
ok('Id không tồn tại → 404', (await sum(H, crypto.randomUUID())).status === 404);

// ---------- get_employee_leave_balance: GET /api/leave/employees/{id}/balance ----------
const bal = (who: { token: string }, id: string) => ai(who, `/api/leave/employees/${id}/balance`);
const hb = await bal(H, O.e.id);
ok('HR xem quỹ phép O → 200 { employee, balance }', hb.status === 200 && hb.body.employee.id === O.e.id && typeof hb.body.balance.available === 'number', hb);
ok('Quản lý M xem quỹ phép S, S2, bản thân → 200', [(await bal(M, S.e.id)).status, (await bal(M, S2.e.id)).status, (await bal(M, M.e.id)).status].every((x) => x === 200));
ok('Quản lý M xem quỹ phép O → 403', (await bal(M, O.e.id)).status === 403);
ok('Nhân viên thường (không vai trò quản lý) → 403', (await bal(S2, S2.e.id)).status === 403);
ok('Id không tồn tại → 404', (await bal(H, crypto.randomUUID())).status === 404);

// ---------- Đơn đang chờ ----------
const corr = (c: string, workDate: string) => json(c, 'POST', '/api/attendance/corrections', { workDate, type: 'In', time: '08:00', workMode: 'Onsite', reason: `Quên chấm ${stamp}` });
const cS2 = await corr(S2.cookie, addDays(-1)), cO = await corr(O.cookie, addDays(-1));
const ot = (c: string) => json(c, 'POST', '/api/attendance/overtime', { workDate: addDays(1), startTime: '18:00', endTime: '20:00', reason: `Tăng ca ${stamp}` });
const oS2 = await ot(S2.cookie), oO = await ot(O.cookie);
ok('Tạo giải trình + tăng ca cho S2, O', [cS2.status, cO.status, oS2.status, oO.status].every((x) => x === 200), [cS2, cO, oS2, oO]);
const ids = (rows: any[], key: 'correction' | 'overtime') => (rows ?? []).map((r) => r[key].id);
const pc = (who: { token: string }) => ai(who, '/api/attendance/corrections/pending');
const po = (who: { token: string }) => ai(who, '/api/attendance/overtime/pending');
let h = await pc(H), m = await pc(M);
ok('HR thấy giải trình chờ của S2 + O (kèm nhân viên)', h.status === 200 && ids(h.body, 'correction').includes(cS2.body.id) && ids(h.body, 'correction').includes(cO.body.id)
  && h.body.find((r: any) => r.correction.id === cS2.body.id).employee.code === S2.e.code, h);
ok('Quản lý M thấy của S2 (gián tiếp), không thấy của O', m.status === 200 && ids(m.body, 'correction').includes(cS2.body.id) && !ids(m.body, 'correction').includes(cO.body.id), m);
ok('Nhân viên thường → 403', (await pc(S2)).status === 403 && (await po(S2)).status === 403);
const ho = await po(H), mo = await po(M);
ok('HR thấy tăng ca chờ của S2 + O (phút, loại ngày, %; không tiền)', ho.status === 200 && ids(ho.body, 'overtime').includes(oS2.body.overtime.id)
  && ids(ho.body, 'overtime').includes(oO.body.overtime.id) && ho.body.every((r: any) => typeof r.overtime.percent === 'number' && r.overtime.minutes === 120)
  && !JSON.stringify(ho.body).toLowerCase().includes('amount'), ho);
ok('Quản lý M thấy tăng ca của S2, không thấy của O', mo.status === 200 && ids(mo.body, 'overtime').includes(oS2.body.overtime.id) && !ids(mo.body, 'overtime').includes(oO.body.overtime.id), mo);
// S (quản lý trực tiếp của S2) duyệt bước 1 trên web → đơn chờ HR: rời hộp duyệt của S nhưng vẫn ở danh sách đang chờ của S / M
const inboxHas = async (c: string, id: string) => ((await json(c, 'GET', '/api/approval/inbox')).body as any[]).some((x) => x.id === id);
ok('Trước duyệt: đơn S2 có trong hộp duyệt của S', await inboxHas(S.cookie, cS2.body.approvalRequestId));
ok('S duyệt bước quản lý (web) → 200', (await json(S.cookie, 'POST', `/api/approval/${cS2.body.approvalRequestId}/approve`, {})).status === 200);
ok('Sau duyệt: không còn trong hộp duyệt của S nhưng vẫn ở list_pending của S và M (chờ HR)', !(await inboxHas(S.cookie, cS2.body.approvalRequestId))
  && ids((await pc(S)).body, 'correction').includes(cS2.body.id) && ids((await pc(M)).body, 'correction').includes(cS2.body.id));
ok('HR duyệt (web) → hết khỏi danh sách đang chờ', (await json(H.cookie, 'POST', `/api/approval/${cS2.body.approvalRequestId}/approve`, {})).status === 200
  && !ids((await pc(H)).body, 'correction').includes(cS2.body.id));

// ---------- Allowlist: route nhạy cảm vẫn chặn ----------
const blocked = [`/api/org/employees/${S.e.id}`, '/api/org/employees/export', '/api/org/employees/next-code', '/api/org/profile/me',
  `/api/org/profile/employees/${S.e.id}`, '/api/contracts', '/api/payroll/periods', '/api/leave/balances', '/api/leave/adjustments'];
const bs = await Promise.all(blocked.map((p) => ai(H, p)));
ok('Token HR: chi tiết đầy đủ / Excel / hồ sơ cá nhân / hợp đồng / lương / quỹ phép mọi người → 403', bs.every((r) => r.status === 403), blocked.map((p, i) => `${p} ${bs[i].status}`));
ok('Token vẫn dùng được danh bạ, /me, /me/role', [(await ai(S2, '/api/org/employees')).status, (await ai(S2, '/api/org/employees/me')).status,
  (await ai(S2, '/api/org/employees/me/role')).status].every((x) => x === 200));
ok('Web (cookie) vẫn xem GET /employees/{id} như cũ', (await json(H.cookie, 'GET', `/api/org/employees/${S.e.id}`)).status === 200);

if (process.env.MCP_URL) {
  let rid = 0;
  const rpc = async (method: string, params: unknown, t: string) => {
    const res = await fetch(process.env.MCP_URL!, { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
    const text = await res.text();
    const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? text;
    try { return JSON.parse(data); } catch { return text as any; }
  };
  const call = async (name: string, args: Record<string, unknown>, t = M.token) => {
    const r = await rpc('tools/call', { name, arguments: args }, t);
    const text = r?.result?.content?.[0]?.text ?? '';
    try { return { err: !!r?.result?.isError, j: JSON.parse(text) as any }; } catch { return { err: true, j: text as any }; }
  };
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } }, M.token);
  const tools = ((await rpc('tools/list', {}, M.token))?.result?.tools ?? []) as any[];
  const hrTools = ['get_employee', 'get_employee_leave_balance', 'list_pending_corrections', 'list_pending_overtime'];
  ok('MCP tools/list có 4 tool Nhân sự mới, đều readOnly; tổng 97 tool', hrTools.every((n) => tools.find((t) => t.name === n)?.annotations?.readOnlyHint === true) && tools.length === 97,
    [tools.length, tools.filter((t) => hrTools.includes(t.name)).map((t) => t.name)]);
  const g = await call('get_employee', { employee: S2.e.code });
  ok('MCP get_employee theo mã (cấp dưới gián tiếp) → hồ sơ', !g.err && g.j.code === S2.e.code && g.j.managerCode === S.e.code, g.j);
  ok('MCP get_employee theo id', !(await call('get_employee', { employee: S.e.id })).err);
  ok('MCP get_employee người ngoài → lỗi (403)', (await call('get_employee', { employee: O.e.code })).err);
  const b = await call('get_employee_leave_balance', { employee: S2.e.code });
  ok('MCP get_employee_leave_balance → quỹ phép', !b.err && b.j.employee.code === S2.e.code && typeof b.j.balance.available === 'number', b.j);
  ok('MCP list_pending_corrections (quản lý: không có đơn của O)', !((await call('list_pending_corrections', {})).j as any[]).some((r) => r.correction.id === cO.body.id));
  const lo = await call('list_pending_overtime', {});
  ok('MCP list_pending_overtime: có đơn của S2', !lo.err && (lo.j as any[]).some((r) => r.overtime.id === oS2.body.overtime.id), lo.j);
  ok('MCP nhân viên thường: list_pending_overtime → lỗi', (await call('list_pending_overtime', {}, S2.token)).err);
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
