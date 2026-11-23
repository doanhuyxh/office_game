// E2E TEST-215: sổ tay dự án (wiki) — API /api/projects/{id}/wiki: cây trang, phiên bản, sửa đồng thời (baseVersion → 409), tìm theo nội dung,
// quyền (thành viên / người xem nhờ phòng ban / người ngoài / quản lý / HR / token AI), khoá trang, khôi phục, xoá, di chuyển, dự án đóng, giới hạn.
// TẠO DỮ LIỆU THẬT → CHỈ DB tạm (không cần S3). Dựng như closed-project-e2e.ts (bỏ phần S3):
//   docker run -d --name e2e215-pg -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=e2e -p 15475:5432 postgres:17-alpine
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5195
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=15475;Database=e2e;Username=e2e;Password=e2e' Encryption__Key=<base64 32 byte>
//        Smtp__Host=127.0.0.1 Smtp__Port=1 Sentry__Dsn= Seq__Url= Chat__InternalKey=<≥32> (+ các Chat__*Key cùng giá trị)
//        Telegram__ApiUrl=http://127.0.0.1:9 Firebase__CredentialsPath= Database__MigrateOnStartup=true   (.env nạp NoClobber — không để Telegram / FCM thật)
//        Seed__AdminEmail=e2e215-admin@officehub-e2e.vn Seed__AdminPassword=E2e215-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5195 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/project-wiki-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5195';
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

// ---------- Chuẩn bị: PM (quản lý), M + M2 (thành viên), V (phòng ban tham gia), X (người ngoài) ----------
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV wiki ${stamp}`, level: 7, financePermissions: 0 })).body;
const deptTeam = (await json(admin, 'POST', '/api/org/departments', { name: `Wiki đội ${stamp}`, code: `WD${stamp}` })).body;
const deptView = (await json(admin, 'POST', '/api/org/departments', { name: `Wiki xem ${stamp}`, code: `WV${stamp}` })).body;
const deptOut = (await json(admin, 'POST', '/api/org/departments', { name: `Wiki ngoài ${stamp}`, code: `WN${stamp}` })).body;
const mkEmp = async (code: string, name: string, user: string, roles: string[], departmentId: string) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW) };
};
const PM = await mkEmp(`WM${stamp}`, 'Quản Lý Sổ Tay', `e2e.wiki.pm.${stamp}`, ['employee', 'manager'], deptTeam);
const M = await mkEmp(`W1${stamp}`, 'Thành Viên Một', `e2e.wiki.m1.${stamp}`, ['employee'], deptTeam);
const M2 = await mkEmp(`W2${stamp}`, 'Thành Viên Hai', `e2e.wiki.m2.${stamp}`, ['employee'], deptTeam);
const V = await mkEmp(`WV${stamp}`, 'Người Xem Phòng Ban', `e2e.wiki.v.${stamp}`, ['employee'], deptView);
const X = await mkEmp(`WX${stamp}`, 'Người Ngoài', `e2e.wiki.x.${stamp}`, ['employee'], deptOut);
ok('5 nhân viên đăng nhập', [PM, M, M2, V, X].every((x) => !!x.cookie));

const base = { code: `WIKI${stamp}`.toUpperCase(), name: `Sổ tay ${stamp}`, kind: 'Internal', sequential: false, departmentIds: [deptView] };
const created = await json(PM.cookie, 'POST', '/api/projects', { ...base, memberIds: [M.e.id, M2.e.id] });
const P = created.body?.id ?? created.body;
ok('PM tạo dự án + 2 thành viên + phòng ban tham gia', created.status === 201 || created.status === 200, created);
const other = await json(PM.cookie, 'POST', '/api/projects', { code: `WIKO${stamp}`.toUpperCase(), name: `Dự án khác ${stamp}`, kind: 'Internal', sequential: false });
const P2 = other.body?.id ?? other.body;
const W = `/api/projects/${P}/wiki`;

// ---------- Thành viên tạo trang gốc + trang con, sửa → phiên bản ----------
const tree0 = await json(M.cookie, 'GET', W);
ok('Cây trống, cờ quyền thành viên: canEdit, không canManage', tree0.status === 200 && tree0.body.pages.length === 0 && tree0.body.canEdit === true
  && tree0.body.canManage === false && tree0.body.maxPages === 500 && tree0.body.maxDepth === 4, tree0);
const root = await json(M.cookie, 'POST', `${W}/pages`, { title: 'Quy trình triển khai', summary: 'Cách deploy\nlên máy chủ', content: 'Bước 1: build.\r\nBước 2: kubectl apply.' });
ok('Thành viên tạo trang gốc → 201, version 1, tóm tắt một dòng, CRLF → LF', root.status === 201 && root.body.version === 1 && root.body.summary === 'Cách deploy lên máy chủ'
  && root.body.content === 'Bước 1: build.\nBước 2: kubectl apply.' && root.body.updatedByBot === false && root.body.canEdit === true, root);
const R = root.body.id as string;
const child = await json(M.cookie, 'POST', `${W}/pages`, { title: 'Máy chủ staging', parentId: R, content: 'Địa chỉ staging ở mục DNS.' });
ok('Tạo trang con → path có trang cha', child.status === 201 && child.body.parentId === R && child.body.path?.[0]?.title === 'Quy trình triển khai', child);
const C = child.body.id as string;
const dup = await json(M2.cookie, 'POST', `${W}/pages`, { title: 'quy trình TRIỂN KHAI' });
ok('Tên trùng trong cùng cha (không phân biệt hoa thường) → 400', dup.status === 400 && !!dup.body?.errors?.title, dup);
ok('Tên trùng nhưng khác cha → 201', (await json(M2.cookie, 'POST', `${W}/pages`, { title: 'Máy chủ staging' })).status === 201);

const e1 = await json(M.cookie, 'PUT', `${W}/pages/${R}`, { baseVersion: 1, content: 'Bước 1: build.\nBước 2: kubectl apply.\nBước 3: kiểm tra.', note: 'thêm bước 3' });
ok('Sửa → version 2', e1.status === 200 && e1.body.version === 2, e1);
const same = await json(M.cookie, 'PUT', `${W}/pages/${R}`, { baseVersion: 2, title: 'Quy trình triển khai', content: e1.body.content });
ok('Lưu không đổi gì → vẫn version 2', same.status === 200 && same.body.version === 2, same);
const hist = await json(M.cookie, 'GET', `${W}/pages/${R}/versions`);
ok('Lịch sử có 2 bản (mới nhất trước, không kèm nội dung, có ghi chú)', hist.status === 200 && hist.body.total === 2 && hist.body.items[0].version === 2
  && hist.body.items[0].note === 'thêm bước 3' && hist.body.items[0].content === undefined && hist.body.items[0].contentLength > 0, hist);
const v1 = await json(M.cookie, 'GET', `${W}/pages/${R}/versions/1`);
ok('Xem phiên bản 1 → nội dung cũ', v1.status === 200 && v1.body.content === 'Bước 1: build.\nBước 2: kubectl apply.', v1);

// ---------- Sửa đồng thời ----------
const a = await json(M.cookie, 'PUT', `${W}/pages/${C}`, { baseVersion: 1, content: 'Bản của M' });
const b = await json(M2.cookie, 'PUT', `${W}/pages/${C}`, { baseVersion: 1, content: 'Bản của M2' });
ok('Người trước lưu được', a.status === 200 && a.body.version === 2, a);
ok('Người sau cùng baseVersion → 409 kèm version + người sửa', b.status === 409 && b.body?.version === 2 && b.body?.updatedByName === 'Thành Viên Một', b);
ok('Nội dung người trước còn nguyên', (await json(M2.cookie, 'GET', `${W}/pages/${C}`)).body?.content === 'Bản của M');

// ---------- Người xem nhờ phòng ban / người ngoài ----------
ok('Phòng ban tham gia: đọc cây', (await json(V.cookie, 'GET', W)).body?.pages?.length === 3);
const vSearch = await json(V.cookie, 'GET', `${W}/search?q=kubectl`);
ok('Phòng ban tham gia: tìm được', vSearch.status === 200 && vSearch.body.length === 1, vSearch);
const vPage = await json(V.cookie, 'GET', `${W}/pages/${R}`);
ok('Phòng ban tham gia: đọc trang, canEdit = false', vPage.status === 200 && vPage.body.canEdit === false && vPage.body.canManage === false, vPage);
ok('Phòng ban tham gia: tạo trang → 403', (await json(V.cookie, 'POST', `${W}/pages`, { title: 'V tạo' })).status === 403);
ok('Phòng ban tham gia: sửa trang → 403', (await json(V.cookie, 'PUT', `${W}/pages/${R}`, { baseVersion: 2, content: 'V sửa' })).status === 403);
ok('Người ngoài: cây → 404', (await json(X.cookie, 'GET', W)).status === 404);
ok('Người ngoài: trang → 404', (await json(X.cookie, 'GET', `${W}/pages/${R}`)).status === 404);
ok('Người ngoài: tìm → 404', (await json(X.cookie, 'GET', `${W}/search?q=kubectl`)).status === 404);
ok('Trang của dự án khác qua đường dẫn dự án khác → 404', (await json(PM.cookie, 'GET', `/api/projects/${P2}/wiki/pages/${R}`)).status === 404);

// ---------- Tìm ----------
await json(PM.cookie, 'POST', `/api/projects/${P2}/wiki/pages`, { title: 'Trang dự án khác', content: 'kubectl ở dự án khác' });
const s1 = await json(M.cookie, 'GET', `${W}/search?q=KUBECTL`);
ok('Tìm từ nằm trong nội dung (không phân biệt hoa thường) → trang + đoạn trích', s1.status === 200 && s1.body.length === 1 && s1.body[0].id === R
  && s1.body[0].snippet.includes('kubectl apply'), s1);
ok('Không lộ trang dự án khác', !s1.body.some((h: any) => h.title === 'Trang dự án khác'));
const s2 = await json(M.cookie, 'GET', `${W}/search?q=${encodeURIComponent('100%_')}`);
ok('% và _ là ký tự thường', s2.status === 200 && s2.body.length === 0, s2);
ok('Từ khoá trống → 400', (await json(M.cookie, 'GET', `${W}/search?q=%20`)).status === 400);

// ---------- Token AI (của thành viên M) ----------
const tokRes = await json(M.cookie, 'POST', '/api/auth/access-tokens', { name: `e2e wiki ${stamp}`, expiresInDays: 30 });
const tok = tokRes.body?.token as string;
ok('Tạo token AI cho M', !!tok, tokRes);
let botPage = '';
if (tok) {
  ok('Token: đọc cây', (await bearer(tok, 'GET', W)).status === 200);
  ok('Token: tìm', (await bearer(tok, 'GET', `${W}/search?q=staging`)).status === 200);
  const tc = await bearer(tok, 'POST', `${W}/pages`, { title: 'Ghi chú của bot', content: 'Bot ghi.' });
  ok('Token tạo trang → 201, updatedByBot = true', tc.status === 201 && tc.body.updatedByBot === true && tc.body.createdByBot === true, tc);
  botPage = tc.body?.id;
  const tu = await bearer(tok, 'PUT', `${W}/pages/${botPage}`, { baseVersion: 1, content: 'Bot sửa.' });
  ok('Token sửa trang → 200, version 2, updatedByBot', tu.status === 200 && tu.body.version === 2 && tu.body.updatedByBot === true, tu);
  const ta = await bearer(tok, 'POST', `${W}/pages/${R}/append`, { text: '## Ghi thêm\nBot nối thêm.' });
  ok('Token nối thêm → 200, cuối trang, version tăng, updatedByBot', ta.status === 200 && ta.body.content.endsWith('kiểm tra.\n\n## Ghi thêm\nBot nối thêm.')
    && ta.body.version === 3 && ta.body.updatedByBot === true, ta);
  const tree = await json(M.cookie, 'GET', W);
  ok('Cây: trang bot có updatedByBot', tree.body.pages.find((p: any) => p.id === botPage)?.updatedByBot === true && tree.body.pages.every((p: any) => p.content === undefined), tree.body);
  ok('Token xoá trang → 403', (await bearer(tok, 'DELETE', `${W}/pages/${botPage}`)).status === 403);
  ok('Token khoá trang → 403', (await bearer(tok, 'POST', `${W}/pages/${botPage}/lock`)).status === 403);
  ok('Token khôi phục phiên bản → 403', (await bearer(tok, 'POST', `${W}/pages/${botPage}/versions/1/restore`)).status === 403);
  ok('Token di chuyển → 403', (await bearer(tok, 'PUT', `${W}/pages/${botPage}/move`, { parentId: R, position: 0 })).status === 403);
}

// ---------- Khoá trang ----------
ok('Thành viên khoá trang → 403', (await json(M.cookie, 'POST', `${W}/pages/${R}/lock`)).status === 403);
const lock = await json(PM.cookie, 'POST', `${W}/pages/${R}/lock`);
ok('Quản lý dự án khoá trang → 204', lock.status === 204, lock);
const cur = (await json(M.cookie, 'GET', `${W}/pages/${R}`)).body;
ok('Trang khoá: locked + người khoá, thành viên canEdit = false', cur.locked === true && cur.lockedByName === 'Quản Lý Sổ Tay' && cur.canEdit === false, cur);
const lm = await json(M.cookie, 'PUT', `${W}/pages/${R}`, { baseVersion: cur.version, content: 'M sửa trang khoá' });
ok('Trang khoá: thành viên sửa → 403 kèm lý do', lm.status === 403 && String(lm.body?.detail).includes('khoá'), lm);
ok('Trang khoá: thành viên nối thêm → 403', (await json(M.cookie, 'POST', `${W}/pages/${R}/append`, { text: 'x' })).status === 403);
if (tok) ok('Trang khoá: token sửa → 403', (await bearer(tok, 'PUT', `${W}/pages/${R}`, { baseVersion: cur.version, content: 'bot' })).status === 403);
const lpm = await json(PM.cookie, 'PUT', `${W}/pages/${R}`, { baseVersion: cur.version, content: cur.content + '\nPM sửa.' });
ok('Trang khoá: quản lý dự án sửa được', lpm.status === 200 && lpm.body.version === cur.version + 1, lpm);
ok('HR (admin) sửa trang khoá được', (await json(admin, 'PUT', `${W}/pages/${R}`, { baseVersion: lpm.body.version, summary: 'HR sửa tóm tắt' })).status === 200);
ok('Mở khoá → 204', (await json(PM.cookie, 'POST', `${W}/pages/${R}/unlock`)).status === 204);
ok('Sau mở khoá thành viên sửa được', (await json(M.cookie, 'POST', `${W}/pages/${R}/append`, { text: 'M nối sau mở khoá.' })).status === 200);

// ---------- Khôi phục phiên bản ----------
const before = (await json(PM.cookie, 'GET', `${W}/pages/${R}`)).body;
ok('Thành viên khôi phục → 403', (await json(M.cookie, 'POST', `${W}/pages/${R}/versions/1/restore`)).status === 403);
const rs = await json(PM.cookie, 'POST', `${W}/pages/${R}/versions/1/restore`);
ok('Khôi phục bản 1 → phiên bản mới có nội dung cũ', rs.status === 200 && rs.body.version === before.version + 1 && rs.body.content === 'Bước 1: build.\nBước 2: kubectl apply.'
  && rs.body.summary === 'Cách deploy lên máy chủ', rs);
const h2 = (await json(PM.cookie, 'GET', `${W}/pages/${R}/versions?pageSize=2`)).body;
ok('Lịch sử ghi "Khôi phục phiên bản 1", phân trang', h2.items.length === 2 && h2.items[0].note === 'Khôi phục phiên bản 1' && h2.total === before.version + 1, h2);
ok('Phiên bản không có → 404', (await json(PM.cookie, 'GET', `${W}/pages/${R}/versions/999`)).status === 404);

// ---------- Di chuyển ----------
const D3 = (await json(M.cookie, 'POST', `${W}/pages`, { title: 'Cấp 3', parentId: C })).body.id;
const D4 = (await json(M.cookie, 'POST', `${W}/pages`, { title: 'Cấp 4', parentId: D3 })).body.id;
const deep = await json(M.cookie, 'POST', `${W}/pages`, { title: 'Cấp 5', parentId: D4 });
ok('Quá 4 cấp → 400', deep.status === 400 && !!deep.body?.errors?.parentId, deep);
ok('Di chuyển trang làm con của con cháu nó → 400', (await json(M.cookie, 'PUT', `${W}/pages/${R}/move`, { parentId: D3, position: 0 })).status === 400);
ok('Di chuyển làm con của chính nó → 400', (await json(M.cookie, 'PUT', `${W}/pages/${R}/move`, { parentId: R, position: 0 })).status === 400);
const mv = await json(M.cookie, 'PUT', `${W}/pages/${D3}/move`, { parentId: null, position: 0 });
ok('Di chuyển "Cấp 3" (kèm con) lên gốc, đầu danh sách', mv.status === 200 && mv.body.parentId === null && mv.body.position === 0, mv);
const roots = (await json(M.cookie, 'GET', W)).body.pages.filter((p: any) => p.parentId === null).sort((x: any, y: any) => x.position - y.position);
ok('Thứ tự gốc đánh lại 0..n', roots[0].id === D3 && roots.map((p: any) => p.position).join(',') === roots.map((_: any, i: number) => i).join(','), roots);

// ---------- Xoá ----------
ok('Thành viên xoá → 403', (await json(M.cookie, 'DELETE', `${W}/pages/${C}`)).status === 403);
const delParent = await json(PM.cookie, 'DELETE', `${W}/pages/${D3}`);
ok('Xoá trang còn con → 409', delParent.status === 409, delParent);
ok('Xoá trang lá → 204', (await json(PM.cookie, 'DELETE', `${W}/pages/${D4}`)).status === 204);
ok('Trang đã xoá → 404', (await json(M.cookie, 'GET', `${W}/pages/${D4}`)).status === 404);
ok('Xoá trang cha sau khi hết con → 204', (await json(PM.cookie, 'DELETE', `${W}/pages/${D3}`)).status === 204);
ok('Tạo lại tên trang đã xoá được', (await json(M.cookie, 'POST', `${W}/pages`, { title: 'Cấp 3' })).status === 201);

// ---------- Giới hạn ----------
const big = await json(M.cookie, 'POST', `${W}/pages`, { title: 'Quá dài', content: 'x'.repeat(50_001) });
ok('Nội dung > 50 000 ký tự → 400', big.status === 400 && !!big.body?.errors?.content, big);
ok('Đúng 50 000 ký tự → 201', (await json(M.cookie, 'POST', `${W}/pages`, { title: 'Vừa đủ', content: 'x'.repeat(50_000) })).status === 201);
ok('Tên trống → 400', (await json(M.cookie, 'POST', `${W}/pages`, { title: '  ' })).status === 400);

// ---------- DTO dự án + phụ lục quyền ----------
const det = (await json(M.cookie, 'GET', `/api/projects/${P}`)).body;
const live = (await json(M.cookie, 'GET', W)).body.pages.length;
ok('DTO dự án có wikiPages', det.project.wikiPages === live && live > 0, det.project);
ok('myAccess thành viên có wiki + wikiEdit, không wikiManage', det.myAccess.includes('wiki') && det.myAccess.includes('wikiEdit') && !det.myAccess.includes('wikiManage'), det.myAccess);
const vAccess = (await json(V.cookie, 'GET', `/api/projects/${P}`)).body.myAccess;
ok('myAccess phòng ban tham gia: wiki, không wikiEdit', vAccess.includes('wiki') && !vAccess.includes('wikiEdit'), vAccess);

// ---------- Dự án đóng ----------
const cur2 = (await json(M.cookie, 'GET', `${W}/pages/${C}`)).body;
ok('Đóng dự án', (await json(PM.cookie, 'PUT', `/api/projects/${P}`, { ...base, status: 'Closed' })).status === 204);
const cm = await json(M.cookie, 'PUT', `${W}/pages/${C}`, { baseVersion: cur2.version, content: 'M sửa khi đóng' });
ok('Dự án đóng: thành viên sửa → 409', cm.status === 409, cm);
ok('Dự án đóng: thành viên tạo → 409', (await json(M.cookie, 'POST', `${W}/pages`, { title: 'Khi đóng' })).status === 409);
ok('Dự án đóng: thành viên vẫn đọc + tìm', (await json(M.cookie, 'GET', `${W}/pages/${C}`)).status === 200 && (await json(M.cookie, 'GET', `${W}/search?q=M`)).status === 200);
ok('Dự án đóng: cây thành viên canEdit = false', (await json(M.cookie, 'GET', W)).body.canEdit === false);
if (tok) ok('Dự án đóng: token sửa → 409', (await bearer(tok, 'PUT', `${W}/pages/${C}`, { baseVersion: cur2.version, content: 'bot khi đóng' })).status === 409);
const cpm = await json(PM.cookie, 'PUT', `${W}/pages/${C}`, { baseVersion: cur2.version, content: 'PM sửa khi đóng' });
ok('Dự án đóng: quản lý dự án sửa được', cpm.status === 200 && cpm.body.version === cur2.version + 1, cpm);
ok('Dự án đóng: quản lý dự án khoá được', (await json(PM.cookie, 'POST', `${W}/pages/${C}/lock`)).status === 204);
ok('Dự án đóng: quản lý dự án mở khoá được', (await json(PM.cookie, 'POST', `${W}/pages/${C}/unlock`)).status === 204);
ok('Mở lại dự án', (await json(PM.cookie, 'PUT', `/api/projects/${P}`, { ...base, status: 'Active' })).status === 204);
const reopen = await json(M.cookie, 'PUT', `${W}/pages/${C}`, { baseVersion: cpm.body.version, content: 'M sửa sau khi mở lại' });
ok('Mở lại: thành viên sửa lại được', reopen.status === 200, reopen);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
