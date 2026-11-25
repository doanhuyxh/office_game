// E2E TEST-228: chia sẻ công khai trang sổ tay có thời hạn — /api/projects/{id}/wiki/shares + /api/projects/public/wiki-shares/{token}.
// Quyền tạo (quản lý dự án / HR được; thành viên thường + token AI 403; người ngoài 404), mở ẩn danh (chỉ gốc / kèm con, trang con thêm sau tự hiện,
// đổi link Markdown), mật khẩu đúng / sai + giới hạn nhập sai, nhật ký IP + trình duyệt, thông báo lần đầu / thiết bị mới (không lặp trong 1 giờ),
// thu hồi / hết hạn / trang gốc xoá / dự án đóng → 410. TẠO DỮ LIỆU THẬT + SỬA DB BẰNG SQL → CHỈ DB tạm (không cần S3):
//   docker run -d --name e2e228-pg -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=e2e -p 15428:5432 postgres:17-alpine
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5228
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=15428;Database=e2e;Username=e2e;Password=e2e' Encryption__Key=<base64 32 byte>
//        Smtp__Host=127.0.0.1 Smtp__Port=1 Sentry__Dsn= Seq__Url= Chat__InternalKey=<≥32> (+ các Chat__*Key cùng giá trị)
//        Telegram__ApiUrl=http://127.0.0.1:9 Firebase__CredentialsPath= Database__MigrateOnStartup=true   (.env nạp NoClobber — không để Telegram / FCM thật)
//        Seed__AdminEmail=e2e228-admin@officehub-e2e.vn Seed__AdminPassword=E2e228-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5228 PG_CONTAINER=e2e228-pg ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/wiki-share-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5228';
const PG = process.env.PG_CONTAINER ?? 'e2e228-pg'; // container Postgres tạm — chỉnh hạn / lần báo bằng SQL để thử 410 / chống báo lặp
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
type Res = { status: number; body: any };
const json = async (cookie: string, method: string, path: string, body?: unknown): Promise<Res> => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const bearer = async (token: string, method: string, path: string, body?: unknown): Promise<Res> => {
  const r = await fetch(API + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};

const PW = 'E2e-Local-2026';
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const stamp = Date.now().toString(36).slice(-5);
const sql = (q: string) => {
  const r = Bun.spawnSync(['docker', 'exec', PG, 'psql', '-U', 'e2e', '-d', 'e2e', '-v', 'ON_ERROR_STOP=1', '-c', q]);
  if (r.exitCode !== 0) throw new Error(`psql lỗi: ${r.stderr.toString()}`);
};
// Mở công khai: không cookie đăng nhập; tuỳ chọn cookie mở khoá + User-Agent (thiết bị)
const pub = async (method: string, path: string, opts: { cookie?: string; ua?: string; body?: unknown } = {}) => {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'user-agent': opts.ua ?? 'E2E-Browser/1.0' };
  if (opts.cookie) headers.cookie = opts.cookie;
  const r = await fetch(`${API}/api/projects/public/wiki-shares/${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  return { status: r.status, body: await r.json().catch(() => null) as any, headers: r.headers, setCookie: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]) };
};

// ---------- Chuẩn bị: PM (quản lý dự án), M (thành viên), X (người ngoài) ----------
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV share ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Share đội ${stamp}`, code: `SD${stamp}` })).body;
const mkEmp = async (code: string, name: string, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW) };
};
const PM = await mkEmp(`SM${stamp}`, 'Quản Lý Chia Sẻ', `e2e.share.pm.${stamp}`, ['employee', 'manager']);
const M = await mkEmp(`S1${stamp}`, 'Thành Viên Chia Sẻ', `e2e.share.m.${stamp}`, ['employee']);
const X = await mkEmp(`SX${stamp}`, 'Người Ngoài Chia Sẻ', `e2e.share.x.${stamp}`, ['employee']);
ok('3 nhân viên đăng nhập', [PM, M, X].every((x) => !!x.cookie));
const base = { code: `SHR${stamp}`.toUpperCase(), name: `Chia sẻ ${stamp}`, kind: 'Internal', sequential: false };
const created = await json(PM.cookie, 'POST', '/api/projects', { ...base, memberIds: [M.e.id] });
const P = created.body?.id ?? created.body;
ok('PM tạo dự án + thành viên', created.status === 201 || created.status === 200, created);
const W = `/api/projects/${P}/wiki`;
const S = `${W}/shares`;
const mk = async (title: string, parentId?: string, content = '') => (await json(M.cookie, 'POST', `${W}/pages`, { title, parentId, content })).body.id as string;
const R = await mk('Tài liệu cho khách');
const A = await mk('Phạm vi', R);
const A1 = await mk('Chi tiết phạm vi', A);
const OUT = await mk('Nội bộ — không chia sẻ', undefined, 'Bí mật nội bộ');
const rootPage = (await json(M.cookie, 'GET', `${W}/pages/${R}`)).body;
const withLinks = `Xem [Phạm vi](/projects/${P}?tab=wiki&page=${A}) và [Nội bộ](https://office.lokid.me/projects/${P}?tab=wiki&page=${OUT}) hoặc [web](https://example.com).`;
ok('Gắn link Markdown vào trang gốc', (await json(M.cookie, 'PUT', `${W}/pages/${R}`, { baseVersion: rootPage.version, content: withLinks })).status === 200);

// ---------- Quyền tạo ----------
const mDeny = await json(M.cookie, 'POST', S, { pageId: R });
ok('Thành viên thường tạo link → 403', mDeny.status === 403, mDeny);
ok('Thành viên thường xem danh sách → 403', (await json(M.cookie, 'GET', S)).status === 403);
ok('Người ngoài → 404', (await json(X.cookie, 'POST', S, { pageId: R })).status === 404 && (await json(X.cookie, 'GET', S)).status === 404);
const tokRes = await json(PM.cookie, 'POST', '/api/auth/access-tokens', { name: `e2e share ${stamp}`, expiresInDays: 30 });
const tok = tokRes.body?.token as string;
ok('Tạo token AI cho PM', !!tok, tokRes);
if (tok) {
  ok('Token AI (của quản lý) tạo link → 403', (await bearer(tok, 'POST', S, { pageId: R })).status === 403);
  ok('Token AI xem danh sách → 403', (await bearer(tok, 'GET', S)).status === 403);
}
ok('Hạn 2 ngày → 400', (await json(PM.cookie, 'POST', S, { pageId: R, days: 2 })).status === 400);
ok('Ngày tự chọn quá 90 ngày → 400', (await json(PM.cookie, 'POST', S, { pageId: R, expiresOn: '2030-01-01' })).status === 400);
ok('Mật khẩu 3 ký tự → 400', (await json(PM.cookie, 'POST', S, { pageId: R, password: 'abc' })).status === 400);
ok('Trang không thuộc dự án → 400', (await json(PM.cookie, 'POST', S, { pageId: crypto.randomUUID() })).status === 400);

// ---------- Link chỉ trang gốc (PM tạo) ----------
const l1 = await json(PM.cookie, 'POST', S, { pageId: R, days: 7, label: 'Gửi khách', recipientName: 'Anh Khách' });
ok('PM tạo link 7 ngày → token 43 ký tự, trạng thái active', l1.status === 200 && l1.body.token?.length === 43 && l1.body.share.status === 'active'
  && l1.body.share.hasPassword === false && l1.body.share.recipientName === 'Anh Khách', l1);
const T1 = l1.body.token as string;
const i1 = await pub('GET', T1);
ok('Mở ẩn danh → tên dự án + chỉ trang gốc, không cần mật khẩu', i1.status === 200 && i1.body.projectName === base.name && i1.body.pages.length === 1
  && i1.body.pages[0].id === R && i1.body.requiresPassword === false && i1.body.locked === false && i1.body.recipientName === 'Anh Khách', i1.body);
ok('Header X-Robots-Tag noindex + Cache-Control no-store', (i1.headers.get('x-robots-tag') ?? '').includes('noindex') && i1.headers.get('cache-control') === 'no-store');
const p1 = await pub('GET', `${T1}/pages/${R}`);
ok('Nội dung trang gốc: link trang ngoài bản chia sẻ → wiki-share:not-shared, không lộ id', p1.status === 200
  && p1.body.content.includes('[Nội bộ](wiki-share:not-shared)') && p1.body.content.includes('[Phạm vi](wiki-share:not-shared)')
  && !p1.body.content.includes(OUT) && p1.body.content.includes('(https://example.com)'), p1.body);
ok('Trang con không kèm → 404', (await pub('GET', `${T1}/pages/${A}`)).status === 404);
ok('Trang ngoài → 404', (await pub('GET', `${T1}/pages/${OUT}`)).status === 404);
ok('Token sai dạng → 404', (await pub('GET', 'abc')).status === 404);
ok('Token không tồn tại → 404', (await pub('GET', 'x'.repeat(43))).status === 404);

// ---------- HR tạo link kèm trang con ----------
const l2 = await json(admin, 'POST', S, { pageId: R, includeChildren: true, expiresOn: '2026-12-31' });
ok('HR tạo link kèm trang con, ngày tự chọn', l2.status === 200 && l2.body.share.includeChildren === true, l2);
const T2 = l2.body.token as string;
const i2 = await pub('GET', T2);
ok('Kèm trang con: cây gốc → Phạm vi → Chi tiết', i2.status === 200 && i2.body.pages.map((x: any) => x.id).join(',') === [R, A, A1].join(',')
  && i2.body.pages[0].parentId === null, i2.body);
const p2 = await pub('GET', `${T2}/pages/${R}`);
ok('Link tới trang trong bản chia sẻ → /w/{token}?page=', p2.body?.content?.includes(`[Phạm vi](/w/${T2}?page=${A})`) && p2.body.content.includes('wiki-share:not-shared'), p2.body);
const pa1 = await pub('GET', `${T2}/pages/${A1}`);
ok('Trang cháu: path từ gốc', pa1.status === 200 && pa1.body.path.map((x: any) => x.id).join(',') === [R, A].join(','), pa1.body);
const NEW = await mk('Trang thêm sau', R);
ok('Trang con thêm sau tự hiện', (await pub('GET', T2)).body.pages.some((x: any) => x.id === NEW));
ok('Xoá trang con → tự ẩn', (await json(PM.cookie, 'DELETE', `${W}/pages/${NEW}`)).status === 204 && !(await pub('GET', T2)).body.pages.some((x: any) => x.id === NEW));
const curRoot = (await json(M.cookie, 'GET', `${W}/pages/${R}`)).body;
await json(M.cookie, 'POST', `${W}/pages/${R}/append`, { text: 'Cập nhật mới nhất.' });
ok('Luôn hiện bản mới nhất', (await pub('GET', `${T2}/pages/${R}`)).body.content.endsWith('Cập nhật mới nhất.') && curRoot.version > 0);

// ---------- Mật khẩu ----------
const l3 = await json(PM.cookie, 'POST', S, { pageId: R, days: 1, password: 'mat-khau-1' });
ok('Tạo link có mật khẩu', l3.status === 200 && l3.body.share.hasPassword === true, l3);
const T3 = l3.body.token as string;
const i3 = await pub('GET', T3);
ok('Chưa mở khoá: không trả cây', i3.status === 200 && i3.body.locked === true && i3.body.requiresPassword === true && i3.body.pages.length === 0 && i3.body.rootPageId === null, i3.body);
ok('Chưa mở khoá: trang → 401', (await pub('GET', `${T3}/pages/${R}`)).status === 401);
const bad = await pub('POST', `${T3}/unlock`, { body: { password: 'sai' }, ua: 'Probe/1' });
ok('Mật khẩu sai → 400 "Mật khẩu không đúng"', bad.status === 400 && !!bad.body?.errors?.password, bad.body);
const good = await pub('POST', `${T3}/unlock`, { body: { password: 'mat-khau-1' } });
const unlockCookie = good.setCookie.find((c) => c.startsWith('oh_wshare_')) ?? '';
ok('Mật khẩu đúng → 204 + cookie riêng của link', good.status === 204 && !!unlockCookie, good);
const sc = (good.headers.getSetCookie?.() ?? []).join(' ').toLowerCase();
ok('Cookie HttpOnly, path wiki-shares, có expires', sc.includes('httponly') && sc.includes('path=/api/projects/public/wiki-shares') && sc.includes('expires='), sc);
const i3b = await pub('GET', T3, { cookie: unlockCookie });
ok('Có cookie: trả cây + nội dung', i3b.body?.locked === false && i3b.body.pages.length === 1 && (await pub('GET', `${T3}/pages/${R}`, { cookie: unlockCookie })).status === 200, i3b.body);
const l3b = await json(PM.cookie, 'POST', S, { pageId: R, days: 1, password: 'mat-khau-2' });
const T3b = l3b.body.token as string;
ok('Cookie link A không mở link B', (await pub('GET', `${T3b}/pages/${R}`, { cookie: unlockCookie.replace(/^oh_wshare_[0-9a-f]+/, `oh_wshare_${l3b.body.id.replaceAll('-', '')}`) })).status === 401);
for (let i = 0; i < 4; i++) await pub('POST', `${T3}/unlock`, { body: { password: `sai-${i}` }, ua: 'Probe/1' });
const blocked = await pub('POST', `${T3}/unlock`, { body: { password: 'mat-khau-1' }, ua: 'Probe/1' });
ok('Sai 5 lần → lần sau 429 (kể cả đúng)', blocked.status === 429, blocked);

// ---------- Nhật ký + thông báo ----------
const notifs = async () => ((await json(PM.cookie, 'GET', '/api/notifications?take=50')).body?.items ?? []).filter((n: any) => n.category === 'wiki_share_viewed') as any[];
const n1 = await notifs();
ok('Mở lần đầu link 1 → PM có 1 thông báo (HR tạo link 2 thì PM không nhận của link 2)', n1.filter((n: any) => n.title.includes('lần đầu')).length === 2, n1);
// link 1: PM tạo; link 3 (mật khẩu, PM tạo) mở lần đầu khi có cookie → 2 thông báo "lần đầu" của PM
await pub('GET', T1, { ua: 'E2E-Browser/1.0' });
await pub('GET', T1, { ua: 'OtherDevice/2.0' });
ok('Thiết bị mới trong vòng 1 giờ → không báo thêm', (await notifs()).length === n1.length);
sql(`update projects.wiki_share_links set "LastNotifiedAt" = now() - interval '2 hours' where "Id" = '${l1.body.id}'`);
await pub('GET', T1, { ua: 'OtherDevice/2.0' });
ok('Thiết bị đã gặp (sau 1 giờ) → không báo', (await notifs()).length === n1.length);
await pub('GET', T1, { ua: 'ThirdDevice/3.0' });
const n2 = await notifs();
ok('Thiết bị mới sau 1 giờ → báo "thiết bị mới"', n2.length === n1.length + 1 && n2.some((n: any) => n.title.includes('thiết bị mới')), n2);
const views = await json(PM.cookie, 'GET', `${S}/${l1.body.id}/views?pageSize=2`);
ok('Nhật ký: tổng 5 lần mở, mới nhất trước, có IP + UA, phân trang', views.status === 200 && views.body.total === 5 && views.body.items.length === 2
  && views.body.items[0].userAgent === 'ThirdDevice/3.0' && !!views.body.items[0].ip, views.body);
ok('HR xem nhật ký được', (await json(admin, 'GET', `${S}/${l1.body.id}/views`)).status === 200);
ok('Thành viên thường xem nhật ký → 403', (await json(M.cookie, 'GET', `${S}/${l1.body.id}/views`)).status === 403);
const list = await json(PM.cookie, 'GET', `${S}?pageId=${R}`);
const l1Row = list.body?.find((x: any) => x.id === l1.body.id);
ok('Danh sách: lọc theo trang, viewCount + lastViewedAt, không có token', list.status === 200 && list.body.length === 4 && l1Row?.viewCount === 5 && !!l1Row.lastViewedAt
  && l1Row.token === undefined, list.body);
ok('Lọc trang khác → rỗng', (await json(PM.cookie, 'GET', `${S}?pageId=${OUT}`)).body.length === 0);

// ---------- Thu hồi / hết hạn / trang gốc xoá / dự án đóng → 410 ----------
ok('Thành viên thu hồi → 403', (await json(M.cookie, 'DELETE', `${S}/${l1.body.id}`)).status === 403);
ok('PM thu hồi → 204', (await json(PM.cookie, 'DELETE', `${S}/${l1.body.id}`)).status === 204);
const g1 = await pub('GET', T1);
ok('Link thu hồi → 410 "Link đã hết hạn hoặc bị thu hồi"', g1.status === 410 && g1.body?.detail === 'Link đã hết hạn hoặc bị thu hồi', g1);
ok('Danh sách: status revoked', (await json(PM.cookie, 'GET', S)).body.find((x: any) => x.id === l1.body.id)?.status === 'revoked');
sql(`update projects.wiki_share_links set "ExpiresAt" = now() - interval '1 minute' where "Id" = '${l3b.body.id}'`);
ok('Link hết hạn → 410', (await pub('GET', T3b)).status === 410);
ok('Danh sách: status expired', (await json(PM.cookie, 'GET', S)).body.find((x: any) => x.id === l3b.body.id)?.status === 'expired');
const lA = await json(PM.cookie, 'POST', S, { pageId: A1, days: 1 });
ok('Xoá trang gốc của link → 410', (await json(PM.cookie, 'DELETE', `${W}/pages/${A1}`)).status === 204 && (await pub('GET', lA.body.token)).status === 410);
ok('Đóng dự án', (await json(PM.cookie, 'PUT', `/api/projects/${P}`, { ...base, status: 'Closed' })).status === 204);
ok('Dự án đóng → 410', (await pub('GET', T2)).status === 410 && (await pub('GET', `${T2}/pages/${R}`)).status === 410);
ok('Dự án đóng: không tạo link mới → 409', (await json(PM.cookie, 'POST', S, { pageId: R })).status === 409);
ok('Mở lại dự án → link còn hạn dùng lại được', (await json(PM.cookie, 'PUT', `/api/projects/${P}`, { ...base, status: 'Active' })).status === 204
  && (await pub('GET', T2)).status === 200);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
