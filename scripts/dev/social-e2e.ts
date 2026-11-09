// E2E: tài khoản mạng xã hội (Facebook Business Manager) + đăng bài lên Fanpage — module Assets.
// Chạy kèm MÁY CHỦ GRAPH GIẢ (cổng FAKE_PORT, mặc định 5199) trong cùng tiến trình: Api phải khởi động với
//   Facebook__GraphUrl=http://localhost:5199 Facebook__VideoUrl=http://localhost:5199
// Kiểm tra: token sai / đúng (mã hoá, không bao giờ trả ra API, lịch sử sửa che), đồng bộ trang (phân trang, trang thiếu quyền), token gửi qua header
// (không nằm trong URL), quyền (HR / người giữ BM / người ngoài), bàn giao / thu hồi (huỷ bài chờ), đăng chữ + link, nhiều ảnh (attached_media),
// video (file_url, permalink tương đối), Facebook tự tải ảnh / video từ link S3 (PUT S3 THẬT `assets/social/` — file giữ lại), lỗi tạm thời → thử lại,
// token bị thu hồi (190) → BM "Token lỗi" + chuông, hẹn giờ + huỷ, ngừng dùng BM, tài sản đang giữ (+ nghỉ việc), kiểm tra dữ liệu.
// TẠO NHÂN VIÊN THẬT → CHỈ chạy trên DB tạm:
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/social-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5180';
const FAKE_PORT = Number(process.env.FAKE_PORT ?? 5199);
const envFile = Bun.file(new URL('../../.env', import.meta.url));
const env: Record<string, string> = (await envFile.exists()) ? Object.fromEntries((await envFile.text()).split('\n')
  .filter((l) => /^[A-Za-z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])) : {};
const ADMIN_LOGIN = process.env.ADMIN_LOGIN ?? env.Seed__AdminEmail, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? env.Seed__AdminPassword;
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 700) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------- Máy chủ Graph giả ----------------
const SU_GOOD = 'EAAGsuGOODtoken000000000000000001', SU_BAD = 'EAAGsuBADtoken0000000000000000002';
const PT1 = 'EAAGpageONEtoken00000000000000001', PT2 = 'EAAGpageTWOtoken00000000000000002';
interface Req { method: string; path: string; search: string; auth: string | null; form: Record<string, string> }
const log: Req[] = [];
const fake = { transient1002: 1, revoked1001: false, s3Fetch: [] as number[] };
let seq = 100;
const err = (status: number, code: number, message: string) => Response.json({ error: { message, type: 'OAuthException', code } }, { status });
Bun.serve({
  port: FAKE_PORT,
  async fetch(req) {
    const u = new URL(req.url);
    const form: Record<string, string> = req.method === 'POST' ? Object.fromEntries(new URLSearchParams(await req.text())) : {};
    const auth = req.headers.get('authorization');
    log.push({ method: req.method, path: u.pathname, search: u.search, auth, form });
    const token = auth?.replace(/^Bearer /, '') ?? '';
    const p = u.pathname.replace(/^\/v23\.0\//, '');
    if (p === 'me') return token === SU_GOOD ? Response.json({ id: 'su1', name: 'OfficeHub Bot' }) : err(400, 190, 'Error validating access token: Session has expired');
    if (p === 'me/accounts') {
      if (token !== SU_GOOD) return err(400, 190, 'Invalid OAuth access token');
      const pic = (id: string) => ({ data: { url: `https://example.test/pic/${id}.jpg` } });
      return u.searchParams.get('after') === 'c1'
        ? Response.json({ data: [{ id: '1003', name: 'Trang Thiếu Quyền', category: 'Brand', picture: pic('1003') }] })
        : Response.json({
          data: [
            { id: '1001', name: 'Trang Một', category: 'Company', link: 'https://facebook.com/1001', picture: pic('1001'), access_token: PT1 },
            { id: '1002', name: 'Trang Hai', category: 'Shop', picture: pic('1002'), access_token: PT2 },
          ],
          paging: { cursors: { before: 'c0', after: 'c1' }, next: `http://localhost:${FAKE_PORT}/v23.0/me/accounts?after=c1&access_token=LEAK` },
        });
    }
    const m = p.match(/^(\d+)\/(feed|photos|videos)$/);
    if (m && req.method === 'POST') {
      const [, page, edge] = m;
      if (token !== (page === '1001' ? PT1 : page === '1002' ? PT2 : '-')) return err(400, 190, 'Invalid page token');
      if (page === '1001' && fake.revoked1001) return err(400, 190, 'The session has been invalidated because the user changed their password');
      if (page === '1002' && edge === 'feed' && fake.transient1002 > 0) { fake.transient1002--; return err(500, 2, 'An unexpected error has occurred. Please retry your request later.'); }
      const src = form.url ?? form.file_url;
      if (src) fake.s3Fetch.push((await fetch(src)).status); // Facebook tự tải tệp từ link S3
      const id = `${page}_${++seq}`;
      if (edge === 'photos') return Response.json(form.published === 'false' ? { id: `ph${seq}` } : { id: `ph${seq}`, post_id: id });
      if (edge === 'videos') return Response.json({ id: `vid${seq}` });
      return Response.json({ id });
    }
    if (req.method === 'GET' && u.searchParams.get('fields') === 'permalink_url') {
      return Response.json({ permalink_url: p.startsWith('vid') ? `/1001/videos/${p}/` : `https://www.facebook.com/${p}` });
    }
    return err(404, 803, `Không hỗ trợ: ${req.method} ${u.pathname}`);
  },
});

// ---------------- Đăng nhập (giống assets-handover-e2e.ts) ----------------
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
const noSecrets = (text: string) => ![SU_GOOD, SU_BAD, PT1, PT2].some((t) => text.includes(t));

const PW = 'E2e-Local-2026';
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const stamp = Date.now().toString(36).slice(-5);
const pos = (await json(admin, 'GET', '/api/org/positions')).body[0].id;
const mkEmp = async (code: string, name: string, departmentId: string, user: string) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW) };
};
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `MXH E2E ${stamp}`, code: `MX${stamp}` })).body;
const holder = await mkEmp(`MH${stamp}`, 'Người Giữ BM', dept, `e2e.mxh.holder.${stamp}`);
const outsider = await mkEmp(`MO${stamp}`, 'Người Ngoài MXH', dept, `e2e.mxh.out.${stamp}`);
ok('2 nhân viên đăng nhập', !!holder.cookie && !!outsider.cookie);

// ---------------- BM: token sai → đúng ----------------
const bmId = `9${Date.now()}`.slice(0, 15);
const c1 = await json(admin, 'POST', '/api/assets/social/accounts', { name: `BM E2E ${stamp}`, externalId: bmId, loginHint: 'mkt@e2e.test', ownerDepartmentId: dept,
  note: null, token: SU_BAD });
const bm = c1.body?.account;
ok('Tạo BM với token sai → lưu, trạng thái "Invalid" + lý do của Facebook', c1.status === 200 && bm.hasToken && bm.tokenStatus === 'Invalid'
  && /expired/.test(bm.tokenError ?? '') && c1.body.pages.length === 0, c1.body);
ok('Phản hồi không chứa token', noSecrets(c1.text));
ok('Trùng ID Business Manager → 400', (await json(admin, 'POST', '/api/assets/social/accounts', { name: 'Trùng', externalId: bmId })).status === 400);
ok('ID BM có chữ → 400', (await json(admin, 'POST', '/api/assets/social/accounts', { name: 'Sai', externalId: '12ab' })).status === 400);
ok('Nhân viên không xem / tạo được BM (403)', (await json(holder.cookie, 'GET', '/api/assets/social/accounts')).status === 403
  && (await json(holder.cookie, 'POST', '/api/assets/social/accounts', { name: 'x' })).status === 403);
ok('Token có khoảng trắng → 400', (await json(admin, 'PUT', `/api/assets/social/accounts/${bm.id}/token`, { token: 'abc def' })).status === 400);

log.length = 0;
const t1 = await json(admin, 'PUT', `/api/assets/social/accounts/${bm.id}/token`, { token: SU_GOOD });
ok('Token đúng → Valid, tên System User, 3 trang (qua 2 trang kết quả)', t1.status === 200 && t1.body.account.tokenStatus === 'Valid'
  && t1.body.account.tokenOwnerName === 'OfficeHub Bot' && t1.body.pages.length === 3 && t1.body.account.pageCount === 3, t1.body);
const p1003 = t1.body.pages.find((p: any) => p.externalId === '1003');
ok('Trang không có page token → canPost = false', p1003 && !p1003.canPost && t1.body.pages.filter((p: any) => p.canPost).length === 2, t1.body.pages);
ok('Gọi Graph bằng header Bearer, không đặt token trong URL, không dùng link "next" chứa token',
  log.length >= 3 && log.every((r) => r.auth === `Bearer ${SU_GOOD}` && !/[?&]access_token=/.test(r.search) && !r.search.includes('LEAK')), log);
ok('Phản hồi không chứa token System User / page token', noSecrets(t1.text));
const audit = await json(admin, 'GET', `/api/audit/changes?entity=SocialAccount&entityId=${bm.id}`);
ok('Lịch sử sửa có BM nhưng che token', audit.status === 200 && audit.text.includes('TokenEncrypted') && noSecrets(audit.text)
  && !/"(old|new)":"[A-Za-z0-9+/=]{40,}"/.test(audit.text), audit.text.slice(0, 500));
const pageId = (ext: string) => t1.body.pages.find((p: any) => p.externalId === ext).id as string;
const P1 = pageId('1001'), P2 = pageId('1002'), P3 = pageId('1003');

// ---------------- Quyền trước khi bàn giao ----------------
ok('Nhân viên chưa được giao: không có trang', (await json(holder.cookie, 'GET', '/api/assets/social/pages')).body?.length === 0);
ok('Nhân viên chưa được giao: đăng bài 403', (await json(holder.cookie, 'POST', '/api/assets/social/posts', { message: 'x', pageIds: [P1] })).status === 403);
ok('Nhân viên chưa được giao: xin link tải tệp 403', (await json(holder.cookie, 'POST', '/api/assets/social/media', { fileName: 'a.png', size: 10 })).status === 403);

// ---------------- Bàn giao ----------------
const as = await json(admin, 'POST', `/api/assets/social/accounts/${bm.id}/assign`, { employeeId: holder.e.id, note: 'Phụ trách fanpage' });
ok('Bàn giao BM → người giữ + lịch sử', as.status === 200 && as.body.account.holderEmployeeId === holder.e.id && as.body.history.length === 1, as.body);
ok('Bàn giao lần nữa khi đang có người giữ → 409', (await json(admin, 'POST', `/api/assets/social/accounts/${bm.id}/assign`, { employeeId: outsider.e.id })).status === 409);
const nAssign = (await json(holder.cookie, 'GET', '/api/notifications?take=10')).body?.items?.find((n: any) => n.category === 'asset_assigned');
ok('Người giữ nhận chuông bàn giao (link /social)', !!nAssign && nAssign.link === '/social' && nAssign.title.includes(`BM E2E ${stamp}`), nAssign);
const my = await json(holder.cookie, 'GET', '/api/assets/my');
ok('Tài sản của tôi có BM (3 trang, không token)', my.body?.socials?.length === 1 && my.body.socials[0].pageCount === 3 && noSecrets(my.text), my.body);
const hp = await json(holder.cookie, 'GET', '/api/assets/social/pages');
ok('Người giữ thấy 3 trang của BM', hp.status === 200 && hp.body.length === 3 && noSecrets(hp.text), hp.body);
ok('Người ngoài vẫn không có trang', (await json(outsider.cookie, 'GET', '/api/assets/social/pages')).body?.length === 0);

// ---------------- Kiểm tra dữ liệu ----------------
const bad = async (body: unknown) => (await json(holder.cookie, 'POST', '/api/assets/social/posts', body)).status;
ok('Bài rỗng → 400', (await bad({ message: ' ', pageIds: [P1] })) === 400);
ok('Không chọn trang → 400', (await bad({ message: 'x', pageIds: [] })) === 400);
ok('Trang thiếu quyền đăng → 400', (await bad({ message: 'x', pageIds: [P3] })) === 400);
ok('Link không phải http(s) → 400', (await bad({ message: 'x', link: 'ftp://a.b', pageIds: [P1] })) === 400);
ok('Hẹn giờ sau 1 phút → 400', (await bad({ message: 'x', pageIds: [P1], scheduledAt: new Date(Date.now() + 60_000).toISOString() })) === 400);
ok('Hẹn giờ quá 180 ngày → 400', (await bad({ message: 'x', pageIds: [P1], scheduledAt: new Date(Date.now() + 200 * 86400_000).toISOString() })) === 400);
ok('Tệp không phải ảnh / video → 400', (await json(holder.cookie, 'POST', '/api/assets/social/media', { fileName: 'a.pdf', size: 10 })).status === 400);
ok('Ảnh > 10 MB → 400', (await json(holder.cookie, 'POST', '/api/assets/social/media', { fileName: 'a.jpg', size: 11 * 1024 * 1024 })).status === 400);

const waitPost = async (cookie: string, id: string, done: (p: any) => boolean, ms = 30_000) => {
  const until = Date.now() + ms;
  let p: any = null;
  while (Date.now() < until) {
    p = (await json(cookie, 'GET', `/api/assets/social/posts/${id}`)).body;
    if (p && done(p)) return p;
    await sleep(1000);
  }
  return p;
};

// ---------------- Đăng chữ + link lên 2 trang (trang 2 lỗi tạm thời 1 lần) ----------------
log.length = 0;
const text = await json(holder.cookie, 'POST', '/api/assets/social/posts', { message: `Xin chào từ OfficeHub ${stamp}`, link: 'https://example.com/a', pageIds: [P1, P2] });
ok('Đăng ngay → 200, 2 đích Chờ', text.status === 200 && text.body.targets.length === 2 && text.body.scheduledAt == null, text.body);
let tp = await waitPost(holder.cookie, text.body.id, (p) => p.targets.find((t: any) => t.pageId === P1).status === 'Published'
  && p.targets.find((t: any) => t.pageId === P2).attempts >= 1 && p.targets.find((t: any) => t.pageId === P2).status === 'Pending');
const tP1 = tp?.targets.find((t: any) => t.pageId === P1), tP2 = tp?.targets.find((t: any) => t.pageId === P2);
ok('Trang 1 đã đăng ngay (job được đánh thức), có link bài', tP1?.status === 'Published' && tP1.permalink?.startsWith('https://www.facebook.com/1001_'), tp);
ok('Trang 2 lỗi tạm thời → chờ thử lại (lần 2) kèm lý do', tP2?.status === 'Pending' && tP2.attempts === 1 && /Thử lại lần 2/.test(tP2.error ?? ''), tP2);
const feed1 = log.find((r) => r.path === '/v23.0/1001/feed');
ok('Graph nhận /feed với message + link, header page token', feed1?.form.message === `Xin chào từ OfficeHub ${stamp}` && feed1.form.link === 'https://example.com/a'
  && feed1.auth === `Bearer ${PT1}` && !('access_token' in feed1.form), feed1);
ok('Trạng thái bài lúc này: Chờ đăng (còn trang 2)', tp?.status === 'Scheduled', tp?.status);
console.log('  … đợi job thử lại trang 2 (≤ 100 giây)');
tp = await waitPost(holder.cookie, text.body.id, (p) => p.targets.every((t: any) => t.status === 'Published'), 100_000);
ok('Thử lại sau 1 phút → trang 2 đã đăng, bài "Đã đăng"', tp?.status === 'Published' && tp.targets.find((t: any) => t.pageId === P2).attempts === 2, tp);

// ---------------- Ảnh (S3 thật) → attached_media ----------------
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const upload = async (cookie: string, name: string, bytes: Uint8Array) => {
  const t = await json(cookie, 'POST', '/api/assets/social/media', { fileName: name, size: bytes.length });
  if (t.status !== 200) return { status: t.status, body: t.body };
  const put = await fetch(t.body.uploadUrl, { method: 'PUT', headers: { 'Content-Type': t.body.contentType }, body: bytes });
  const c = await json(cookie, 'POST', `/api/assets/social/media/${t.body.id}/confirm`, {});
  return { status: put.ok ? c.status : put.status, body: c.body, ticket: t.body };
};
const early = await json(holder.cookie, 'POST', '/api/assets/social/media', { fileName: 'chua-put.png', size: png.length });
ok('Xác nhận khi chưa PUT → 409', (await json(holder.cookie, 'POST', `/api/assets/social/media/${early.body.id}/confirm`, {})).status === 409);
const i1 = await upload(holder.cookie, 'anh 1.png', png), i2 = await upload(holder.cookie, 'anh-2.png', png);
ok('Tải 2 ảnh lên S3 + xác nhận', i1.status === 200 && i2.status === 200 && i1.body.kind === 'Image' && i1.ticket?.uploadUrl.includes('assets/social/'), [i1, i2]);
ok('Người khác không xác nhận được tệp của mình (404)', (await json(outsider.cookie, 'POST', `/api/assets/social/media/${i1.body.id}/confirm`, {})).status === 404);
ok('Bài có ảnh không gắn được link xem trước → 400', (await bad({ message: 'x', link: 'https://a.b', pageIds: [P1], mediaIds: [i1.body.id] })) === 400);
log.length = 0;
fake.s3Fetch.length = 0;
const pic = await json(holder.cookie, 'POST', '/api/assets/social/posts', { message: 'Album', pageIds: [P1], mediaIds: [i2.body.id, i1.body.id] });
const picDone = await waitPost(holder.cookie, pic.body.id, (p) => p.status === 'Published');
const photos = log.filter((r) => r.path === '/v23.0/1001/photos'), albumFeed = log.find((r) => r.path === '/v23.0/1001/feed');
ok('2 ảnh: tải ẩn từng ảnh (published=false) rồi /feed + attached_media đúng thứ tự', picDone?.status === 'Published' && photos.length === 2
  && photos.every((r) => r.form.published === 'false') && albumFeed?.form['attached_media[0]']?.includes('media_fbid') && albumFeed.form['attached_media[1]'] != null
  && albumFeed.form.message === 'Album', { picDone, photos, albumFeed });
ok('Facebook tải được ảnh từ link S3 (200)', fake.s3Fetch.length === 2 && fake.s3Fetch.every((s) => s === 200), fake.s3Fetch);
ok('Bài có 2 ảnh trả về theo thứ tự chọn', picDone?.media.map((m: any) => m.id).join() === [i2.body.id, i1.body.id].join(), picDone?.media);
ok('Dùng lại ảnh đã gắn bài khác → 400', (await bad({ message: 'x', pageIds: [P1], mediaIds: [i1.body.id] })) === 400);
const mu = await json(holder.cookie, 'GET', `/api/assets/social/media/${i1.body.id}/url`);
ok('Xem ảnh: người đăng được, người ngoài 404', mu.status === 200 && mu.body.url.startsWith('http')
  && (await json(outsider.cookie, 'GET', `/api/assets/social/media/${i1.body.id}/url`)).status === 404);

// ---------------- Video ----------------
const vid = await upload(holder.cookie, 'clip.mp4', new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]));
ok('Video + ảnh cùng bài → 400', (await bad({ message: 'x', pageIds: [P1], mediaIds: [vid.body.id, (await upload(holder.cookie, 'a3.png', png)).body.id] })) === 400);
log.length = 0;
const vp = await json(holder.cookie, 'POST', '/api/assets/social/posts', { message: 'Video mới', pageIds: [P1], mediaIds: [vid.body.id] });
const vDone = await waitPost(holder.cookie, vp.body.id, (p) => p.status === 'Published');
const vreq = log.find((r) => r.path === '/v23.0/1001/videos');
ok('Video: /videos với file_url (S3) + description; permalink tương đối → tuyệt đối', vDone?.status === 'Published' && vreq?.form.description === 'Video mới'
  && vreq.form.file_url?.includes('assets/social/') && vDone.targets[0].permalink?.startsWith('https://www.facebook.com/1001/videos/vid'), { vDone, vreq });

// ---------------- Xem bài: người ngoài ----------------
ok('Người ngoài không xem được bài (404) / danh sách rỗng', (await json(outsider.cookie, 'GET', `/api/assets/social/posts/${text.body.id}`)).status === 404
  && (await json(outsider.cookie, 'GET', '/api/assets/social/posts?page=1')).body?.total === 0);
const hrList = await json(admin, 'GET', '/api/assets/social/posts?page=1&pageSize=50');
ok('HR thấy mọi bài (phân trang)', hrList.status === 200 && hrList.body.total >= 3 && hrList.body.items.some((p: any) => p.id === vp.body.id), hrList.body?.total);

// ---------------- Hẹn giờ + huỷ ----------------
const at = new Date(Date.now() + 10 * 60_000).toISOString();
const sch = await json(holder.cookie, 'POST', '/api/assets/social/posts', { message: 'Hẹn giờ', pageIds: [P1, P2], scheduledAt: at });
ok('Hẹn giờ 10 phút → Chờ đăng, có nút huỷ', sch.status === 200 && sch.body.status === 'Scheduled' && sch.body.canCancel, sch.body);
ok('Người ngoài không huỷ được (404)', (await json(outsider.cookie, 'POST', `/api/assets/social/posts/${sch.body.id}/cancel`)).status === 404);
const cc = await json(holder.cookie, 'POST', `/api/assets/social/posts/${sch.body.id}/cancel`);
ok('Người đăng huỷ → Đã huỷ', cc.status === 200 && cc.body.status === 'Cancelled' && cc.body.targets.every((t: any) => t.cancelledByName), cc.body);
ok('Huỷ lần nữa → 409', (await json(holder.cookie, 'POST', `/api/assets/social/posts/${sch.body.id}/cancel`)).status === 409);
ok('Đăng lại trang không lỗi → 409', (await json(holder.cookie, 'POST', `/api/assets/social/targets/${cc.body.targets[0].id}/retry`)).status === 409);

// ---------------- Thu hồi BM → huỷ bài chờ của người giữ ----------------
const sch2 = await json(holder.cookie, 'POST', '/api/assets/social/posts', { message: 'Hẹn giờ 2', pageIds: [P1], scheduledAt: at });
const hrSch = await json(admin, 'POST', '/api/assets/social/posts', { message: 'HR hẹn giờ', pageIds: [P2], scheduledAt: at });
const ret = await json(admin, 'POST', `/api/assets/social/accounts/${bm.id}/return`, { note: 'Đổi người phụ trách' });
ok('Thu hồi BM → không còn người giữ, lịch sử đóng', ret.status === 200 && ret.body.account.holderEmployeeId == null && ret.body.history[0].returnedAt, ret.body);
const s2 = (await json(admin, 'GET', `/api/assets/social/posts/${sch2.body.id}`)).body;
const hs = (await json(admin, 'GET', `/api/assets/social/posts/${hrSch.body.id}`)).body;
ok('Bài hẹn giờ của người giữ bị huỷ (ghi lý do); bài của HR vẫn chờ', s2?.status === 'Cancelled' && /thu hồi/.test(s2.targets[0].error ?? '')
  && hs?.status === 'Scheduled', { s2, hs });
ok('Người bị thu hồi: không còn trang, đăng 403, tài sản không còn BM', (await json(holder.cookie, 'GET', '/api/assets/social/pages')).body?.length === 0
  && (await bad({ message: 'x', pageIds: [P1] })) === 403 && (await json(holder.cookie, 'GET', '/api/assets/my')).body?.socials?.length === 0);
ok('Người bị thu hồi vẫn xem được bài mình đã đăng', (await json(holder.cookie, 'GET', `/api/assets/social/posts/${text.body.id}`)).status === 200);
const nRet = (await json(holder.cookie, 'GET', '/api/notifications?take=10')).body?.items?.find((n: any) => n.category === 'asset_returned');
ok('Người bị thu hồi nhận chuông', !!nRet, nRet);
await json(admin, 'POST', `/api/assets/social/posts/${hrSch.body.id}/cancel`);

// ---------------- Token bị thu hồi (190) ----------------
fake.revoked1001 = true;
const rv = await json(admin, 'POST', '/api/assets/social/posts', { message: 'Sau khi đổi mật khẩu', pageIds: [P1] });
const rvDone = await waitPost(admin, rv.body.id, (p) => p.status === 'Failed');
ok('Lỗi 190 → đích Lỗi (không thử lại), có nút đăng lại', rvDone?.status === 'Failed' && rvDone.targets[0].attempts === 1 && rvDone.targets[0].canRetry
  && /password/.test(rvDone.targets[0].error ?? ''), rvDone);
const bmAfter = (await json(admin, 'GET', `/api/assets/social/accounts/${bm.id}`)).body;
ok('BM chuyển "Token lỗi" kèm lý do', bmAfter?.account.tokenStatus === 'Invalid' && /password/.test(bmAfter.account.tokenError ?? ''), bmAfter?.account);
const adminNotes = (await json(admin, 'GET', '/api/notifications?take=20')).body?.items ?? [];
ok('Chuông social_post: đăng thất bại + token BM hỏng', adminNotes.filter((n: any) => n.category === 'social_post').length >= 2, adminNotes.map((n: any) => n.title));
fake.revoked1001 = false;
const rs = await json(admin, 'POST', `/api/assets/social/accounts/${bm.id}/sync`);
ok('Đồng bộ lại → token Valid', rs.body?.account.tokenStatus === 'Valid', rs.body?.account);
const rt = await json(admin, 'POST', `/api/assets/social/targets/${rvDone.targets[0].id}/retry`);
const rtDone = await waitPost(admin, rv.body.id, (p) => p.status === 'Published');
ok('Đăng lại trang lỗi → Đã đăng', rt.status === 200 && rtDone?.status === 'Published', rtDone);

// ---------------- Nghỉ việc còn giữ BM ----------------
await json(admin, 'POST', `/api/assets/social/accounts/${bm.id}/assign`, { employeeId: outsider.e.id });
const hold = await json(admin, 'GET', `/api/assets/employees/${outsider.e.id}/holdings`);
ok('HR xem tài sản nhân viên: có BM', hold.body?.socials?.length === 1, hold.body);

// ---------------- Ngừng dùng ----------------
ok('Ngừng dùng khi còn người giữ → 409', (await json(admin, 'POST', `/api/assets/social/accounts/${bm.id}/status`, { status: 'Disabled' })).status === 409);
await json(admin, 'POST', `/api/assets/social/accounts/${bm.id}/return`, { note: null });
const dis = await json(admin, 'POST', `/api/assets/social/accounts/${bm.id}/status`, { status: 'Disabled' });
ok('Ngừng dùng → HR không còn trang để đăng, đăng bị chặn (400 / 403 khi không còn BM nào)', dis.body?.account.status === 'Disabled'
  && !(await json(admin, 'GET', '/api/assets/social/pages')).body.some((p: any) => p.accountId === bm.id)
  && [400, 403].includes((await json(admin, 'POST', '/api/assets/social/posts', { message: 'x', pageIds: [P1] })).status));
ok('Bàn giao BM ngừng dùng → 409', (await json(admin, 'POST', `/api/assets/social/accounts/${bm.id}/assign`, { employeeId: holder.e.id })).status === 409);
const list = await json(admin, 'GET', '/api/assets/social/accounts');
ok('Danh sách BM không chứa token', list.status === 200 && list.body.some((a: any) => a.id === bm.id) && noSecrets(list.text));

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
