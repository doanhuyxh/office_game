// E2E TEST-205: job kiểm tra token Facebook BM định kỳ (`SocialTokenCheckJob`, mặc định 5 giờ) — token đúng → TokenCheckedAt + trang + quyền
// được làm mới; Facebook trả 190 → BM "Token lỗi" + chuông / email cho người giữ + HR + Quản trị viên (một lần mỗi lần chuyển sang lỗi);
// chạy lần nữa không báo lại; lỗi mạng / lỗi tạm thời của Facebook không đổi trạng thái; BM ngừng dùng không bị kiểm tra; job có ở Hệ thống → Vận hành.
// TEST-206: token đúng → job đồng bộ bài viết từng trang (/published_posts), số tương tác cập nhật lần sau, lỗi một trang không chặn trang khác.
// Máy chủ Graph giả trong cùng tiến trình (cổng FAKE_PORT, mặc định 5198). Api rút chu kỳ job bằng cấu hình CHỈ DÙNG KHI TEST:
//   docker run -d --name e2e-tok-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:15462:5432 postgres:18-alpine
//   docker run -d --name e2e-tok-mail -p 127.0.0.1:11062:1025 -p 127.0.0.1:18062:8025 axllent/mailpit
//   Api (từ backend/): env ASPNETCORE_URLS=http://localhost:5187 'ConnectionStrings__Default=Host=127.0.0.1;Port=15462;Database=e2e;Username=e2e;Password=e2e'
//        Smtp__Host=127.0.0.1 Smtp__Port=11062 Smtp__UseSsl=false Smtp__Username= Smtp__Password= Telegram__ApiUrl=http://127.0.0.1:9 Firebase__CredentialsPath=
//        Facebook__GraphUrl=http://localhost:5198 Facebook__VideoUrl=http://localhost:5198 Facebook__TokenCheckInterval=00:00:05
//        Seed__AdminEmail=tok-admin@officehub-e2e.vn Seed__AdminPassword=Tok-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5187 MAILPIT_URL=http://127.0.0.1:18062 bun scripts/dev/social-token-check-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5187';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:18062';
const FAKE_PORT = Number(process.env.FAKE_PORT ?? 5198);
const ADMIN_LOGIN = process.env.ADMIN_LOGIN ?? 'tok-admin@officehub-e2e.vn', ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Tok-Admin-2026';
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 700) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------- Máy chủ Graph giả ----------------
const SU = 'EAAGsuTOKENcheck00000000000000001', PT1 = 'EAAGpageTOKcheck00000000000000001';
// mode: ok | revoked (190) | transient (500, mã 2)
const fake = { mode: 'ok' as 'ok' | 'revoked' | 'transient', extraPage: false, extraPerm: false, meCalls: 0, likes: 1, postCalls: 0 };
const err = (status: number, code: number, message: string) => Response.json({ error: { message, type: 'OAuthException', code } }, { status });
const serve = () => Bun.serve({
  port: FAKE_PORT,
  fetch(req) {
    const u = new URL(req.url);
    const token = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    const p = u.pathname.replace(/^\/v23\.0\//, '');
    // TEST-206: bài viết của trang — 2001 có 3 bài, 2002 thiếu quyền đọc (#10)
    if (p === '2001/published_posts' && token === PT1) {
      fake.postCalls++;
      return Response.json({ data: [3, 2, 1].map((n) => ({ id: `2001_${n}`, message: `Bài job ${n}`, created_time: `2026-11-0${n}T03:00:00+0000`,
        reactions: { data: [], summary: { total_count: fake.likes * n } }, comments: { data: [], summary: { total_count: n } } })) });
    }
    if (p === '2002/published_posts' && token === PT1) return err(403, 10, '(#10) This endpoint requires the pages_read_engagement permission');
    if (token !== SU) return err(400, 190, 'Invalid OAuth access token');
    if (p === 'me') {
      fake.meCalls++;
      if (fake.mode === 'revoked') return err(400, 190, 'Error validating access token: The session has been invalidated');
      if (fake.mode === 'transient') return err(500, 2, 'An unexpected error has occurred. Please retry your request later.');
      return Response.json({ id: 'su1', name: 'OfficeHub Bot' });
    }
    if (p === 'me/permissions') return Response.json({ data: [
      ...['pages_show_list', 'pages_manage_posts', 'pages_read_engagement', 'business_management'].map((permission) => ({ permission, status: 'granted' })),
      ...(fake.extraPerm ? [{ permission: 'read_insights', status: 'granted' }] : [])] });
    if (p === 'me/accounts') return Response.json({ data: [
      { id: '2001', name: 'Trang Job Một', category: 'Company', access_token: PT1 },
      ...(fake.extraPage ? [{ id: '2002', name: 'Trang Job Mới', category: 'Shop', access_token: PT1 }] : [])] });
    return err(404, 803, `Không hỗ trợ: ${req.method} ${u.pathname}`);
  },
});
let server = serve();

// ---------------- Đăng nhập (giống social-e2e.ts) ----------------
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
const json = async (cookie: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* rỗng */ }
  return { status: r.status, body: parsed, text };
};

const PW = 'E2e-Local-2026';
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const stamp = Date.now().toString(36).slice(-5);
const pos = (await json(admin, 'GET', '/api/org/positions')).body[0].id;
const mkEmp = async (code: string, name: string, departmentId: string, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@officehub-e2e.vn`, phone: null, dateOfBirth: null,
    departmentId, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, email: `${user}@officehub-e2e.vn`, cookie: await login(user, PW) };
};
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Token E2E ${stamp}`, code: `TK${stamp}` })).body;
const holder = await mkEmp(`TH${stamp}`, 'Người Giữ BM Job', dept, `e2e.tok.holder.${stamp}`, ['employee']);
const hr = await mkEmp(`TR${stamp}`, 'HR Job Token', dept, `e2e.tok.hr.${stamp}`, ['hr']);
const outsider = await mkEmp(`TO${stamp}`, 'Người Ngoài Token', dept, `e2e.tok.out.${stamp}`, ['employee']);
ok('Người giữ, HR, người ngoài đăng nhập', !!holder.cookie && !!hr.cookie && !!outsider.cookie);

const getBm = async (id: string) => (await json(admin, 'GET', `/api/assets/social/facebook/accounts/${id}`)).body;
/** Đợi job chạy xong ít nhất `runs` lần nữa (TokenCheckedAt của BM tăng). */
const waitChecked = async (id: string, runs = 1) => {
  let last = (await getBm(id))?.account.tokenCheckedAt ?? '';
  for (let i = 0; i < runs; i++) {
    const until = Date.now() + 30_000;
    let next = last;
    while (next === last && Date.now() < until) { await sleep(500); next = (await getBm(id))?.account.tokenCheckedAt ?? ''; }
    if (next === last) return null;
    last = next;
  }
  await sleep(300); // thông báo ghi sau SaveChanges
  return getBm(id);
};
const tokenNotes = async (cookie: string, name: string) =>
  ((await json(cookie, 'GET', '/api/notifications?take=50')).body?.items ?? [])
    .filter((n: any) => n.category === 'social_post' && n.title?.includes('Token BM') && n.title?.includes(name));

// ---------------- Job có ở Hệ thống → Vận hành ----------------
const ops = await json(admin, 'GET', '/api/system/ops');
const job = (ops.body?.jobs ?? []).find((j: any) => j.key === 'assets.social-token-check');
ok('Hệ thống → Vận hành có job "Tài sản: kiểm tra token Facebook BM"', job?.name === 'Tài sản: kiểm tra token Facebook BM', ops.body?.jobs?.map((j: any) => j.key));

// ---------------- Token đúng → làm mới ----------------
const name = `BM Job ${stamp}`;
const c = await json(admin, 'POST', '/api/assets/social/facebook/accounts', { name, externalId: `8${Date.now()}`.slice(0, 15), loginHint: null, ownerDepartmentId: dept,
  note: null, token: SU });
const bm = c.body?.account;
ok('Tạo BM token đúng → Valid, 1 trang, 4 quyền (thiếu pages_read_user_content)', bm?.tokenStatus === 'Valid' && c.body.pages.length === 1 && bm.tokenPermissions?.length === 4, c.body);
await json(admin, 'POST', `/api/assets/social/facebook/accounts/${bm.id}/assign`, { employeeId: holder.e.id });
fake.extraPage = true; fake.extraPerm = true;
const r1 = await waitChecked(bm.id);
ok('Job chạy → TokenCheckedAt cập nhật, trang mới + quyền mới được làm mới', r1?.account.tokenStatus === 'Valid' && r1.account.tokenCheckedAt > bm.tokenCheckedAt
  && r1.pages.length === 2 && r1.account.tokenPermissions?.some((p: any) => p.permission === 'read_insights'), r1?.account);
const pageOf = (detail: any, ext: string) => detail?.pages.find((x: any) => x.externalId === ext)?.id as string;
const pd1 = (await json(admin, 'GET', `/api/assets/social/facebook/pages/${pageOf(r1, '2001')}`)).body;
const pd2 = (await json(admin, 'GET', `/api/assets/social/facebook/pages/${pageOf(r1, '2002')}`)).body;
ok('TEST-206: job token đúng → đồng bộ bài viết trang 2001 (3 bài); trang 2002 thiếu quyền chỉ ghi lỗi, không chặn trang khác',
  pd1?.postCount === 3 && !!pd1.postsSyncedAt && pd1.postsSyncError === null && pd2?.postCount === 0 && /#10/.test(pd2?.postsSyncError ?? ''), { pd1, pd2 });
fake.likes = 5;
const r1b = await waitChecked(bm.id);
const posts1 = (await json(admin, 'GET', `/api/assets/social/facebook/pages/${pageOf(r1, '2001')}/posts?page=1`)).body;
ok('TEST-206: lần chạy sau cập nhật số thích, không trùng bài', !!r1b && posts1?.total === 3 && posts1.items[0].externalPostId === '2001_3'
  && posts1.items[0].reactionCount === 15 && posts1.items[0].commentCount === 3, posts1);
ok('Token đúng → không ai nhận chuông token hỏng', (await tokenNotes(admin, name)).length === 0 && (await tokenNotes(hr.cookie, name)).length === 0);

// ---------------- Lỗi tạm thời / lỗi mạng → giữ nguyên ----------------
fake.mode = 'transient';
const r2 = await waitChecked(bm.id);
ok('Facebook lỗi tạm thời (500, mã 2) → token vẫn Valid, không lỗi', r2?.account.tokenStatus === 'Valid' && !r2.account.tokenError, r2?.account);
fake.mode = 'ok';
server.stop(true);
const postCallsBefore = fake.postCalls;
const before = fake.meCalls;
await sleep(12_000); // ≥ 2 chu kỳ 5 giây khi máy chủ Graph tắt
const r3 = await getBm(bm.id);
ok('Không kết nối được Facebook → trạng thái không đổi, không đồng bộ bài', before === fake.meCalls && postCallsBefore === fake.postCalls && r3?.account.tokenStatus === 'Valid' && !r3.account.tokenError, r3?.account);
server = serve();
ok('Lỗi mạng / tạm thời → không báo token hỏng', (await tokenNotes(admin, name)).length === 0);

// ---------------- Token bị thu hồi (190) ----------------
await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });
fake.mode = 'revoked';
const r4 = await waitChecked(bm.id);
ok('Facebook trả 190 → BM "Token lỗi" kèm lý do', r4?.account.tokenStatus === 'Invalid' && /invalidated/.test(r4.account.tokenError ?? ''), r4?.account);
ok('Token lỗi → giữ danh sách quyền cũ', r4?.account.tokenPermissions?.length === 5, r4?.account.tokenPermissions);
const [nh, nr, na, no] = [await tokenNotes(holder.cookie, name), await tokenNotes(hr.cookie, name), await tokenNotes(admin, name), await tokenNotes(outsider.cookie, name)];
ok('Người giữ + HR + Quản trị viên mỗi người đúng 1 chuông, link /assets?tab=social&platform=facebook; người ngoài không',
  nh.length === 1 && nr.length === 1 && na.length === 1 && no.length === 0 && nh[0].link === '/assets?tab=social&platform=facebook', { nh, nr, na, no });
let mails: any[] = [];
for (let i = 0; i < 40; i++) {
  mails = ((await (await fetch(`${MAILPIT}/api/v1/messages?limit=100`)).json()) as any).messages ?? [];
  if (mails.filter((m) => m.Subject?.includes(name)).length >= 3) break;
  await sleep(500);
}
const to = mails.filter((m) => m.Subject?.includes(name)).flatMap((m) => m.To.map((t: any) => t.Address.toLowerCase()));
ok('Email token hỏng tới người giữ + HR + Quản trị viên (Mailpit)', [holder.email, hr.email, ADMIN_LOGIN].every((e) => to.includes(e.toLowerCase())), to);

const r5 = await waitChecked(bm.id, 2);
ok('Job chạy thêm 2 lần khi token vẫn lỗi → không báo lại', r5?.account.tokenStatus === 'Invalid'
  && (await tokenNotes(holder.cookie, name)).length === 1 && (await tokenNotes(hr.cookie, name)).length === 1 && (await tokenNotes(admin, name)).length === 1);

// ---------------- HR thay token → hợp lệ (không báo); hỏng lần sau → báo lại ----------------
fake.mode = 'ok';
const fix = await json(hr.cookie, 'PUT', `/api/assets/social/facebook/accounts/${bm.id}/token`, { token: SU });
ok('HR thay token → Valid, không có chuông mới', fix.body?.account.tokenStatus === 'Valid' && (await tokenNotes(admin, name)).length === 1, fix.body?.account);
fake.mode = 'revoked';
const r6 = await waitChecked(bm.id);
ok('Hỏng lần sau → báo lại (người giữ, HR, admin: 2 chuông)', r6?.account.tokenStatus === 'Invalid'
  && (await tokenNotes(holder.cookie, name)).length === 2 && (await tokenNotes(hr.cookie, name)).length === 2 && (await tokenNotes(admin, name)).length === 2);

// ---------------- BM ngừng dùng không bị kiểm tra ----------------
fake.mode = 'ok';
await json(admin, 'POST', `/api/assets/social/facebook/accounts/${bm.id}/return`, { note: null });
await json(admin, 'POST', `/api/assets/social/facebook/accounts/${bm.id}/status`, { status: 'Disabled' });
const calls = fake.meCalls, dis = (await getBm(bm.id))?.account.tokenCheckedAt;
await sleep(12_000);
const r7 = await getBm(bm.id);
ok('BM ngừng dùng → job bỏ qua (không gọi Facebook, giữ trạng thái)', fake.meCalls === calls && r7?.account.tokenCheckedAt === dis
  && r7.account.tokenStatus === 'Invalid', { calls, now: fake.meCalls });

const ops2 = (await json(admin, 'GET', '/api/system/ops')).body?.jobs?.find((j: any) => j.key === 'assets.social-token-check');
ok('Vận hành: job đã chạy nhiều lần, lần cuối thành công', ops2?.runs >= 5 && ops2.lastSucceeded === true, ops2);
ok('Nhân viên không gọi được /api/system/ops (403)', (await json(outsider.cookie, 'GET', '/api/system/ops')).status === 403);

server.stop(true);
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
