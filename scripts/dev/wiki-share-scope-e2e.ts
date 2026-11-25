// E2E TEST-230: chia sẻ sổ tay theo phạm vi — toàn bộ sổ tay (`scope: all`) hoặc chọn nhiều trang (`scope: pages`, mỗi trang tuỳ chọn kèm cây con).
// Toàn bộ: sổ tay trống → cây rỗng (không 410), trang tạo sau tự hiện. Chọn trang: trang rải rác ở nhiều nhánh nối vào tổ tiên gần nhất có trong bản chia sẻ,
// trang con tạo sau dưới trang "kèm con" tự hiện, trang ngoài phạm vi 404, xoá hết trang đã chọn → 410. Kiểm tra dữ liệu vào (400), danh sách (scope, pageCount,
// pages, lọc theo trang), chuông (tên phạm vi + link), và link CŨ (trước migration WikiShareScope) vẫn mở được: hạ migration → chèn link kiểu cũ bằng SQL →
// nâng lại → mở bằng token cũ. TẠO DỮ LIỆU THẬT + SỬA SCHEMA → CHỈ DB tạm:
//   docker run -d --name e2e230-pg -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=e2e -p 15430:5432 postgres:17-alpine
//   Api (từ backend/): như đầu scripts/dev/wiki-share-e2e.ts, cổng 5230 + 'ConnectionStrings__Default=Host=127.0.0.1;Port=15430;Database=e2e;Username=e2e;Password=e2e'
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5230 PG_CONTAINER=e2e230-pg PG_PORT=15430 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/wiki-share-scope-e2e.ts
//   (bước link cũ chạy `dotnet ef database update` từ backend/ — cần DOTNET_ROOT / PATH có SDK 10; Api đã build sẵn → `--no-build`)
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5230';
const PG = process.env.PG_CONTAINER ?? 'e2e230-pg';
const PG_PORT = process.env.PG_PORT ?? '15430';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 700) : ''}`);
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
const sql = (q: string) => {
  const r = Bun.spawnSync(['docker', 'exec', PG, 'psql', '-U', 'e2e', '-d', 'e2e', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', q]);
  if (r.exitCode !== 0) throw new Error(`psql lỗi: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
};
const pub = async (path: string, ua = 'E2E-Browser/1.0') => {
  const r = await fetch(`${API}/api/projects/public/wiki-shares/${path}`, { headers: { 'user-agent': ua } });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const ids = (r: { body: any }) => (r.body?.pages ?? []).map((x: any) => x.id).join(',');

const PW = 'E2e-Local-2026';
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const stamp = Date.now().toString(36).slice(-5);

// ---------- Chuẩn bị: PM (quản lý dự án), M (thành viên) ----------
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV scope ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Scope đội ${stamp}`, code: `SC${stamp}` })).body;
const mkEmp = async (code: string, name: string, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW) };
};
const PM = await mkEmp(`CM${stamp}`, 'Quản Lý Phạm Vi', `e2e.scope.pm.${stamp}`, ['employee', 'manager']);
const M = await mkEmp(`C1${stamp}`, 'Thành Viên Phạm Vi', `e2e.scope.m.${stamp}`, ['employee']);
ok('2 nhân viên đăng nhập', [PM, M].every((x) => !!x.cookie));
const base = { code: `SCP${stamp}`.toUpperCase(), name: `Phạm vi ${stamp}`, kind: 'Internal', sequential: false };
const mkProject = async (b: object) => { const r = await json(PM.cookie, 'POST', '/api/projects', b); return (r.body?.id ?? r.body) as string; };
const P = await mkProject({ ...base, memberIds: [M.e.id] });
const P2 = await mkProject({ ...base, code: `SCQ${stamp}`.toUpperCase(), name: `Khác ${stamp}`, memberIds: [] });
ok('PM tạo 2 dự án', !!P && !!P2);
const W = `/api/projects/${P}/wiki`;
const S = `${W}/shares`;
const mk = async (title: string, parentId?: string, content = '', project = P) =>
  (await json(project === P ? M.cookie : PM.cookie, 'POST', `/api/projects/${project}/wiki/pages`, { title, parentId, content })).body.id as string;

// ---------- Toàn bộ sổ tay khi sổ tay còn trống ----------
const la = await json(PM.cookie, 'POST', S, { scope: 'all', days: 7, recipientName: 'Khách Toàn Bộ' });
ok('Tạo link toàn bộ sổ tay khi sổ tay trống → 200, active, pageCount 0', la.status === 200 && la.body.share.scope === 'all' && la.body.share.pageCount === 0
  && la.body.share.pages.length === 0 && la.body.share.status === 'active', la);
const TA = la.body.token as string;
const ea = await pub(TA);
ok('Khách mở link toàn bộ + sổ tay trống → 200 cây rỗng (không 410)', ea.status === 200 && ea.body.pages.length === 0 && ea.body.rootPageId === null && ea.body.locked === false, ea);

// ---------- Dựng cây: R1 → R1a → R1a1 ; R2 → R2a, R2b ; R3 ----------
const R1 = await mk('Một — Tổng quan');
const R1a = await mk('Một A', R1);
const R1a1 = await mk('Một A 1', R1a);
const R2 = await mk('Hai — Đặc tả');
const R2a = await mk('Hai A', R2);
const R2b = await mk('Hai B', R2);
const R3 = await mk('Ba — Phụ lục');
const OTHER = await mk('Trang dự án khác', undefined, '', P2);
const r1 = (await json(M.cookie, 'GET', `${W}/pages/${R1}`)).body;
await json(M.cookie, 'PUT', `${W}/pages/${R1}`, { baseVersion: r1.version,
  content: `Xem [cháu](/projects/${P}?tab=wiki&page=${R1a1}) và [con](/projects/${P}?tab=wiki&page=${R1a}) và [phụ lục](?tab=wiki&page=${R3}).` });

const ta = await pub(TA);
ok('Toàn bộ sổ tay: mọi trang, thứ tự sổ tay, trang đầu = R1', ids(ta) === [R1, R1a, R1a1, R2, R2a, R2b, R3].join(',') && ta.body.rootPageId === R1, ta.body);
ok('Toàn bộ sổ tay: cha giữ nguyên (R1a dưới R1, R2 ở gốc)', ta.body.pages.find((x: any) => x.id === R1a)?.parentId === R1
  && ta.body.pages.find((x: any) => x.id === R2)?.parentId === null);
const R4 = await mk('Bốn — tạo sau');
ok('Toàn bộ sổ tay: trang tạo sau tự hiện', (await pub(TA)).body.pages.some((x: any) => x.id === R4));
ok('Toàn bộ sổ tay: trang dự án khác → 404', (await pub(`${TA}/pages/${OTHER}`)).status === 404);

// ---------- Kiểm tra dữ liệu vào ----------
const bad = async (body: unknown) => json(PM.cookie, 'POST', S, body);
const b1 = await bad({ scope: 'pages', pages: [] });
ok('scope pages + pages rỗng → 400 errors.pages', b1.status === 400 && !!b1.body?.errors?.pages, b1.body);
ok('Trang trùng → 400', (await bad({ scope: 'pages', pages: [{ pageId: R1 }, { pageId: R1, includeChildren: true }] })).status === 400);
const b3 = await bad({ scope: 'pages', pages: [{ pageId: R1 }, { pageId: OTHER }] });
ok('Trang của dự án khác → 400 errors.pages', b3.status === 400 && !!b3.body?.errors?.pages, b3.body);
ok('Phạm vi lạ → 400 errors.scope', (await bad({ scope: 'x', pages: [{ pageId: R1 }] })).body?.errors?.scope !== undefined);
ok('201 trang → 400', (await bad({ scope: 'pages', pages: Array.from({ length: 201 }, () => ({ pageId: crypto.randomUUID() })) })).status === 400);
ok('Thành viên thường tạo link toàn bộ → 403', (await json(M.cookie, 'POST', S, { scope: 'all' })).status === 403);

// ---------- Chọn trang rải rác ở nhiều nhánh ----------
const lp = await json(PM.cookie, 'POST', S, {
  scope: 'pages', days: 7, recipientName: 'Khách Chọn Trang',
  pages: [{ pageId: R3, includeChildren: true }, { pageId: R2b }, { pageId: R1a1 }, { pageId: R1 }],
});
ok('Tạo link chọn 4 trang → scope pages, pageCount 4, trang theo thứ tự sổ tay', lp.status === 200 && lp.body.share.scope === 'pages' && lp.body.share.pageCount === 4
  && lp.body.share.pages.map((x: any) => x.id).join(',') === [R1, R1a1, R2b, R3].join(',') && lp.body.share.pages.find((x: any) => x.id === R3)?.includeChildren === true, lp.body);
const TP = lp.body.token as string;
const tp = await pub(TP);
const node = (id: string) => tp.body.pages.find((x: any) => x.id === id);
ok('Cây: R1, R1a1, R2b, R3 (thứ tự sổ tay), trang đầu R1', ids(tp) === [R1, R1a1, R2b, R3].join(',') && tp.body.rootPageId === R1, tp.body);
ok('R1a1 nối vào tổ tiên gần nhất có trong bản chia sẻ (R1); R2b, R3 đứng ở gốc', node(R1a1)?.parentId === R1 && node(R2b)?.parentId === null && node(R3)?.parentId === null, tp.body);
const pa = await pub(`${TP}/pages/${R1a1}`);
ok('Trang R1a1: parentId R1 + path chỉ gồm trang trong bản chia sẻ', pa.status === 200 && pa.body.parentId === R1 && pa.body.path.map((x: any) => x.id).join(',') === R1, pa.body);
ok('Trang ngoài phạm vi (R1a, R2, R2a) → 404', (await pub(`${TP}/pages/${R1a}`)).status === 404 && (await pub(`${TP}/pages/${R2}`)).status === 404
  && (await pub(`${TP}/pages/${R2a}`)).status === 404);
const c1 = (await pub(`${TP}/pages/${R1}`)).body?.content ?? '';
ok('Link Markdown theo tập trang mới: cháu + phụ lục mở trong link, con R1a → not-shared', c1.includes(`[cháu](/s/${TP}?page=${R1a1})`)
  && c1.includes(`[phụ lục](/s/${TP}?page=${R3})`) && c1.includes('[con](wiki-share:not-shared)') && !c1.includes(R1a), c1);
const R3x = await mk('Ba X — con tạo sau', R3);
const R2bx = await mk('Hai B X — con tạo sau', R2b);
const tp2 = await pub(TP);
ok('Trang con tạo sau dưới R3 (kèm con) tự hiện, nối vào R3', tp2.body.pages.find((x: any) => x.id === R3x)?.parentId === R3, tp2.body);
ok('Trang con tạo sau dưới R2b (không kèm con) không hiện', !tp2.body.pages.some((x: any) => x.id === R2bx));

// ---------- Danh sách + lọc theo trang ----------
const all = await json(PM.cookie, 'GET', S);
const rowP = all.body?.find((x: any) => x.id === lp.body.id);
const rowA = all.body?.find((x: any) => x.id === la.body.id);
ok('Danh sách mọi link: scope / pageCount / pages (tên, kèm con)', all.status === 200 && rowA?.scope === 'all' && rowA.pageCount === 0 && rowP?.scope === 'pages'
  && rowP.pageCount === 4 && rowP.pages.find((x: any) => x.id === R2b)?.title === 'Hai B' && rowP.token === undefined, all.body);
const f1 = await json(PM.cookie, 'GET', `${S}?pageId=${R3x}`);
ok('Lọc theo trang con tạo sau (qua "kèm con") → link chọn trang + link toàn bộ', f1.body?.map((x: any) => x.id).sort().join(',') === [la.body.id, lp.body.id].sort().join(','), f1.body);
const f2 = await json(PM.cookie, 'GET', `${S}?pageId=${R1a}`);
ok('Lọc theo trang ngoài phạm vi chọn → chỉ link toàn bộ', f2.body?.map((x: any) => x.id).join(',') === la.body.id, f2.body);

// ---------- Chuông người tạo: tên phạm vi + link ----------
const notifs = async () => ((await json(PM.cookie, 'GET', '/api/notifications?take=50')).body?.items ?? []).filter((n: any) => n.category === 'wiki_share_viewed') as any[];
const ns = await notifs();
const nAll = ns.find((n: any) => n.title.includes('toàn bộ sổ tay'));
const nPages = ns.find((n: any) => n.title.includes('"Một — Tổng quan" và 3 trang khác'));
ok('Chuông link toàn bộ → /projects/{id}?tab=wiki', nAll?.link === `/projects/${P}?tab=wiki`, ns);
ok('Chuông link chọn trang → trang được chọn đầu tiên', nPages?.link === `/projects/${P}?tab=wiki&page=${R1}`, ns);

// ---------- Xoá hết trang đã chọn → 410 ----------
const ld = await json(PM.cookie, 'POST', S, { scope: 'pages', pages: [{ pageId: R2a }, { pageId: R2bx }], days: 1 });
const TD = ld.body.token as string;
ok('Link 2 trang (R2a, R2bx) mở được', ld.status === 200 && ids(await pub(TD)) === [R2a, R2bx].join(','));
await json(PM.cookie, 'DELETE', `${W}/pages/${R2a}`);
ok('Xoá 1 trong 2 trang → vẫn mở được, còn 1 trang', ids(await pub(TD)) === R2bx);
await json(PM.cookie, 'DELETE', `${W}/pages/${R2bx}`);
const gd = await pub(TD);
ok('Xoá hết trang đã chọn → 410', gd.status === 410 && gd.body?.detail === 'Link đã hết hạn hoặc bị thu hồi', gd);
const rowD = (await json(PM.cookie, 'GET', S)).body.find((x: any) => x.id === ld.body.id);
ok('Danh sách: status gone, trang đánh dấu đã xoá', rowD?.status === 'gone' && rowD.pages.every((x: any) => x.deleted && x.title === '(trang đã xoá)'), rowD);
ok('Tạo link với trang đã xoá → 400', (await bad({ scope: 'pages', pages: [{ pageId: R2a }] })).status === 400);
ok('Link toàn bộ vẫn mở được sau khi xoá trang', (await pub(TA)).status === 200 && !(await pub(TA)).body.pages.some((x: any) => x.id === R2a));

// ---------- Cách viết tắt cũ {pageId, includeChildren} ----------
const ll = await json(PM.cookie, 'POST', S, { pageId: R1, includeChildren: true, days: 7 });
const TL = ll.body.token as string;
ok('Viết tắt cũ pageId + includeChildren → scope pages 1 trang kèm con', ll.status === 200 && ll.body.share.pageCount === 1 && ll.body.share.pages[0].includeChildren === true
  && ids(await pub(TL)) === [R1, R1a, R1a1].join(','), ll.body);

// ---------- Link cũ trước migration vẫn mở được ----------
const backend = join(import.meta.dir, '..', '..', 'backend');
const cs = `Host=127.0.0.1;Port=${PG_PORT};Database=e2e;Username=e2e;Password=e2e`;
if (!cs.includes('127.0.0.1')) throw new Error('Chỉ hạ / nâng migration trên DB tạm');
const ef = (target: string) => {
  const r = Bun.spawnSync(['dotnet', 'ef', 'database', 'update', target, '--project', 'src/Modules/Projects/OfficeHub.Modules.Projects', '--startup-project', 'src/OfficeHub.Api',
    '--context', 'ProjectsDbContext', '--connection', cs, '--no-build'], { cwd: backend, env: process.env });
  if (r.exitCode !== 0) throw new Error(`dotnet ef ${target} lỗi: ${r.stdout.toString().slice(-1500)} ${r.stderr.toString().slice(-800)}`);
};
ef('WikiShareLinks'); // về schema TEST-228: một trang gốc + IncludeChildren / link
const cols = sql(`select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema='projects' and table_name='wiki_share_links'`);
ok('Đã hạ về schema cũ (có IncludeChildren, không Scope)', cols.includes('IncludeChildren') && !cols.includes('Scope'), cols);
ok('Hạ migration: link viết tắt (1 trang kèm con) giữ RootPageId + IncludeChildren; link toàn bộ bị bỏ',
  sql(`select "RootPageId" || '|' || "IncludeChildren" from projects.wiki_share_links where "Id"='${ll.body.id}'`) === `${R1}|true`
  && sql(`select count(*) from projects.wiki_share_links where "Id"='${la.body.id}'`) === '0');
const legacyToken = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const legacyHash = createHash('sha256').update(legacyToken).digest('hex');
sql(`insert into projects.wiki_share_links ("Id","ProjectId","RootPageId","IncludeChildren","Label","RecipientName","TokenHash","PasswordHash","ExpiresAt","CreatedAt",
  "CreatedByUserId","CreatedByName","ViewCount")
  select gen_random_uuid(), "ProjectId", '${R1}', true, 'Link kiểu cũ', 'Khách Cũ', '${legacyHash}', null, now() + interval '3 days', now(), "CreatedByUserId", "CreatedByName", 0
  from projects.wiki_share_links where "Id"='${ll.body.id}'`);
ef('WikiShareScope');
const cols2 = sql(`select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema='projects' and table_name='wiki_share_links'`);
ok('Nâng lại migration: có Scope, bỏ IncludeChildren', cols2.includes('Scope') && !cols2.includes('IncludeChildren'), cols2);
const lg = await pub(legacyToken);
ok('Link cũ (chèn trước migration) mở được bằng token cũ: R1 kèm cây con', lg.status === 200 && ids(lg) === [R1, R1a, R1a1].join(',') && lg.body.recipientName === 'Khách Cũ', lg);
ok('Link cũ: nội dung trang con mở được', (await pub(`${legacyToken}/pages/${R1a1}`)).status === 200);
ok('Link viết tắt qua hạ + nâng migration: vẫn mở được, cùng nội dung', ids(await pub(TL)) === [R1, R1a, R1a1].join(','));
const rowL = (await json(PM.cookie, 'GET', S)).body.find((x: any) => x.label === 'Link kiểu cũ');
ok('Danh sách: link cũ thành scope pages, 1 trang kèm con', rowL?.scope === 'pages' && rowL.pageCount === 1 && rowL.pages[0].id === R1 && rowL.pages[0].includeChildren === true, rowL);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
