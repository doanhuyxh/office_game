// E2E TEST-71: tìm người trong gợi ý @nhắc cho công ty ~100 nhân viên — server (/api/news/people, /api/chat/people, mention-candidates Office):
// bỏ dấu, tách từ (gõ họ tên có dấu cách), mọi từ phải khớp (tên / mã / phòng ban / chức danh), xếp hạng (mã chính xác → tên gọi → đầu từ),
// tối đa 20, chỉ trả trường công khai; giao diện (BASE_URL): gõ "@nguyen van" giữ gợi ý mở, ↑↓ cuộn tới kết quả thứ 15, tô chữ khớp,
// dòng phụ phân biệt người trùng tên, "Không tìm thấy ai", chọn vẫn chèn như cũ.
// TẠO ~100 NHÂN VIÊN THẬT → CHỈ DB tạm (container riêng):
//   docker run -d --name officehub-e2e-t71-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:55471:5432 postgres:18-alpine
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5189
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=55471;Database=e2e;Username=e2e;Password=e2e'
//        Chat__InternalKey=<≥32 ký tự> Chat__RealtimeToApiKey=<cùng giá trị> Smtp__Host=127.0.0.1 Smtp__Port=11071 Smtp__UseSsl=false Smtp__Username= Smtp__Password=
//        Seed__AdminEmail=t71-admin@officehub-e2e.vn Seed__AdminPassword=T71-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   Giao diện (tuỳ chọn): frontend/: VITE_API_TARGET=http://localhost:5189 bunx vite --port 5176 --strictPort
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5189 BASE_URL=http://localhost:5176 bun scripts/dev/mention-search-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';
import { launch } from './cdp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5189';
const BASE = process.env.BASE_URL ?? '';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN ?? 't71-admin@officehub-e2e.vn', ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'T71-Admin-2026';
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();

// ---- đăng nhập ----
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith(name + '=')).at(-1) ?? '';
const post = (path: string, body: unknown, cookie = '') =>
  fetch(API + path, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const login = async (user: string, password: string): Promise<string> => {
  const r = await post('/api/auth/login', { login: user, password });
  const body = await r.json().catch(() => null) as any;
  if (r.status === 403 && body?.title === '2fa_required') {
    const r2 = await post('/api/auth/login/2fa', { code: totp(keys[user]), isRecoveryCode: false, rememberMe: true }, cookieOf(r, 'officehub.2fa'));
    return cookieOf(r2, 'officehub.auth');
  }
  let cookie = cookieOf(r, 'officehub.auth');
  if (r.ok && body?.mustSetupTwoFactor) {
    const sr = await post('/api/auth/2fa/setup', {}, cookie);
    cookie = cookieOf(sr, 'officehub.auth') || cookie;
    const s = await sr.json() as any;
    const code = totp(s.sharedKey);
    if (!(await post('/api/auth/2fa/enable', { code }, cookie)).ok) throw new Error(`Không bật được 2FA cho ${user}`);
    keys[user] = s.sharedKey;
    writeFileSync(KEYS_FILE, JSON.stringify(keys));
    while (totp(s.sharedKey) === code) await Bun.sleep(1000);
    return login(user, password);
  }
  return cookie;
};
const json = async (cookie: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* không phải JSON */ }
  return { status: r.status, body: parsed, text };
};

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const stamp = Date.now().toString(36).slice(-4).toUpperCase();
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `Nhân viên MS ${stamp}`, level: 7, financePermissions: 0 })).body;
const mkDept = async (name: string) => (await json(admin, 'POST', '/api/org/departments', { name: `${name} ${stamp}`, code: `${name.slice(0, 2).toUpperCase()}${stamp}` })).body as string;
const KT = await mkDept('Kế toán'), KD = await mkDept('Kinh doanh'), DEV = await mkDept('Phát triển');
const depts = [KT, KD, DEV];

type Emp = { id: string; code: string; name: string; dept: string; temp?: string };
const mk = async (code: string, name: string, dept: string, jobTitle: string | null = null): Promise<Emp> => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${code.toLowerCase()}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle })).body?.employee;
  if (!e) throw new Error(`Không tạo được ${code}`);
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: `ms.${code.toLowerCase()}` })).body;
  return { id: e.id, code, name, dept, temp: acc?.tempPassword };
};

// ~100 người: họ / đệm / tên phổ biến (nhiều "Nguyễn Văn …", nhiều tên "Huy" / "Anh") + vài người cố định để kiểm tra
const HO = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng'];
const DEM = ['Văn', 'Thị', 'Minh', 'Thanh', 'Quang'];
const TEN = ['Huy', 'Anh', 'An', 'Hùng', 'Mai', 'Lan', 'Huyền', 'Tuấn', 'Linh', 'Dũng'];
const all: Emp[] = [];
for (let i = 0; i < 92; i++) {
  const name = `${HO[i % HO.length]} ${DEM[(i * 3) % DEM.length]} ${TEN[(i * 7) % TEN.length]}`;
  if (name === 'Nguyễn Văn Huy' || name === 'Đoàn Quang Huy') continue;
  all.push(await mk(`S${stamp}${String(i).padStart(3, '0')}`, name, depts[i % 3]));
}
const DQH = await mk(`S${stamp}DQH`, 'Đoàn Quang Huy', DEV, 'Lập trình viên');
const NVH1 = await mk(`S${stamp}H01`, 'Nguyễn Văn Huy', KT);
const NVH2 = await mk(`S${stamp}H02`, 'Nguyễn Văn Huy', KD, 'Trưởng nhóm bán hàng');
const BOT = await mk(`S${stamp}BOT`, 'Trợ lý Huy Bot', DEV);
all.push(DQH, NVH1, NVH2, BOT);
const botUser = (await json(admin, 'PUT', `/api/org/employees/${BOT.id}/account/bot`, { isBot: true })).status;
ok(`Tạo ${all.length} nhân viên có tài khoản (+ 1 bot)`, all.length >= 85 && botUser < 300, botUser);

// Người xem: tài khoản thường
const PW = 'E2e-Local-2026';
const viewer = await mk(`S${stamp}VIEW`, 'Người Xem Thử', KD);
let V = '';
if (viewer.temp) {
  const user = `ms.${viewer.code.toLowerCase()}`;
  const c0 = await login(user, viewer.temp);
  await json(c0, 'POST', '/api/auth/change-password', { currentPassword: viewer.temp, newPassword: PW });
  V = await login(user, PW);
}
if (!V) throw new Error('Không đăng nhập được người xem');
const me = (await json(V, 'GET', '/api/auth/me')).body?.id as string;

const people = async (base: 'news' | 'chat', q: string) => (await json(V, 'GET', `/api/${base}/people?search=${encodeURIComponent(q)}`)).body as any[];
const names = (rs: any[]) => rs.map((x) => x.fullName as string);
// DB tạm có thể còn người của lần chạy trước (trùng họ tên) → đếm / so riêng người của lần này theo tiền tố mã
const mine = (rs: any[]) => rs.filter((x) => String(x.code).startsWith(`S${stamp}`));

// ---- Server ----
for (const base of ['news', 'chat'] as const) {
  const nv = await people(base, 'nguyen van');
  ok(`[${base}] "nguyen van": ≥ 2 người, ai cũng có "nguyen" và "van" trong họ tên`, nv.length >= 2 && nv.every((x) => fold(x.fullName).includes('nguyen') && fold(x.fullName).includes('van')), names(nv));
  const hd = await people(base, 'huy doan');
  // "doan" cũng khớp đầu từ phòng "Kinh doanh" (tìm theo phòng ban) — nhưng người khớp cả hai từ trong họ tên đứng đầu
  ok(`[${base}] "huy doan" → Đoàn Quang Huy đứng đầu (từ đảo thứ tự)`, hd[0]?.fullName === 'Đoàn Quang Huy' && mine(hd).find((x) => fold(x.fullName).includes('doan'))?.code === DQH.code
    && hd.findIndex((x) => x.fullName !== 'Đoàn Quang Huy') > hd.findLastIndex((x) => x.fullName === 'Đoàn Quang Huy'), names(hd));
  const code = await people(base, DQH.code.toLowerCase());
  ok(`[${base}] gõ đúng mã (chữ thường) → đúng người đứng đầu`, code[0]?.code === DQH.code, code.map((x) => x.code));
  const nvh = mine(await people(base, 'Nguyễn Văn Huy'));
  ok(`[${base}] trùng tên "Nguyễn Văn Huy" → 2 người, phân biệt bằng mã / phòng ban / chức danh`, nvh.length === 2
    && new Set(nvh.map((x) => `${x.code}|${x.departmentName}|${x.title}`)).size === 2 && nvh.some((x) => x.title === 'Trưởng nhóm bán hàng'), nvh);
  const kt = await people(base, 'huy ke toan');
  ok(`[${base}] "huy ke toan" (lọc theo phòng ban) → chỉ Nguyễn Văn Huy phòng Kế toán`, kt.length >= 1 && kt.every((x) => fold(x.departmentName ?? '').includes('ke toan')) && kt.some((x) => x.code === NVH1.code), kt);
  const title = await people(base, 'huy lap trinh');
  ok(`[${base}] "huy lap trinh" (lọc theo chức danh) → Đoàn Quang Huy`, title.every((x) => x.title === 'Lập trình viên') && mine(title).length === 1 && mine(title)[0].code === DQH.code, title);
  const huy = await people(base, 'huy');
  ok(`[${base}] "huy": người có tên gọi Huy… đứng trước người chỉ có chữ "Huy" ở giữa`, huy.length === 20
    && fold(huy[0].fullName).split(' ').at(-1)!.startsWith('huy') && huy.findIndex((x) => !fold(x.fullName).split(' ').at(-1)!.startsWith('huy')) !== 0, names(huy));
  ok(`[${base}] tối đa 20 kết quả, không có chính mình`, (await people(base, '')).length === 20 && !(await people(base, 'nguoi xem')).some((x) => x.userId === me));
  ok(`[${base}] không ai khớp → []`, (await people(base, 'zzqqxx')).length === 0);
  ok(`[${base}] ký tự đặc biệt (% _) không làm lỗi / không khớp tất cả`, (await people(base, '%')).length === 0 && (await people(base, '_')).length === 0);
  const fields = Object.keys(hd[0] ?? {}).sort().join(',');
  ok(`[${base}] chỉ trả trường công khai`, fields === 'avatarUrl,code,departmentName,fullName,isBot,title,userId', fields);
  const bot = await people(base, 'huy bot');
  ok(`[${base}] cờ bot`, mine(bot)[0]?.code === BOT.code && mine(bot)[0].isBot === true && hd[0]?.isBot === false, bot);
}
const office = (await json(V, 'GET', '/api/chat/conversations')).body?.find((c: any) => c.type === 'Office');
const oc = (await json(V, 'GET', `/api/chat/conversations/${office?.id}/mention-candidates?search=${encodeURIComponent('huy doan')}`)).body as any[];
ok('[chat] gợi ý @ kênh Toàn văn phòng dùng chung tìm kiếm: "huy doan" → Đoàn Quang Huy đứng đầu + phòng ban / chức danh', oc?.[0]?.fullName === 'Đoàn Quang Huy'
  && oc[0].title === 'Lập trình viên' && !!oc[0].departmentName && mine(oc).some((x) => x.code === DQH.code), oc);
const oc20 = (await json(V, 'GET', `/api/chat/conversations/${office?.id}/mention-candidates?search=`)).body as any[];
ok('[chat] gợi ý @ kênh Toàn văn phòng: tối đa 20', oc20?.length === 20, oc20?.length);

// ---- Giao diện ----
if (BASE) {
  const postId = (await json(admin, 'POST', '/api/news/posts', { contentHtml: `<p>Bai thu goi y nhac ${stamp}</p>`, audience: 'Company', targets: [], uploadIds: [], sendEmail: false, commentsDisabled: false })).body?.id;
  ok('admin đăng bài để bình luận', !!postId);
  const b = await launch(9371, `${tmpdir()}/chr-ms-${stamp}`);
  try {
    ok('Chrome đăng nhập người xem', (await b.login(`ms.${viewer.code.toLowerCase()}`, PW)) === 200);
    const keyDown = async (key: string, code: string, vk: number) => {
      await b.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk });
      await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
    };
    const type = async (s: string) => { for (const ch of s) await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch }); };
    const open = async () => {
      await b.go(`${BASE}/news/${postId}`, 3500);
      // trang chi tiết có thể đã mở sẵn bình luận — chỉ bấm "Bình luận" khi chưa thấy ô nhập
      await b.evalJs(`(() => { if (!document.querySelector('[data-testid="comment-input"]')) document.querySelector('[data-testid="toggle-comments"]')?.click(); return true; })()`);
      await b.sleep(800);
      await b.evalJs(`document.querySelector('[data-testid="comment-input"]').focus()`);
    };
    const opts = async () => (await b.evalJs(`[...document.querySelectorAll('[data-testid="mention-list"] [role=option]')].map(li => li.innerText)`)) as string[];

    await open();
    await type('@nguyen van');
    await b.sleep(1200);
    let o = await opts();
    ok('gõ "@nguyen van" (có dấu cách) → gợi ý vẫn mở, toàn người Nguyễn Văn …', o.length >= 2 && o.every((t) => fold(t).includes('nguyen van')), o);
    ok('tô phần chữ khớp', ((await b.evalJs(`document.querySelectorAll('[data-testid="mention-list"] mark').length`)) as number) > 0);
    await keyDown('Escape', 'Escape', 27);
    await b.sleep(300);
    ok('Esc đóng gợi ý', (await opts()).length === 0);

    await open();
    await type('@huy');
    await b.sleep(1200);
    o = await opts();
    ok('"@huy" → 20 gợi ý, danh sách cuộn được + nhắc gõ thêm', o.length === 20
      && ((await b.evalJs(`(() => { const u = document.querySelector('[data-testid="mention-list"]'); return u.scrollHeight > u.clientHeight; })()`)) as boolean)
      && ((await b.evalJs(`document.body.innerText`)) as string).includes('Gõ thêm họ tên'), o.length);
    for (let i = 0; i < 14; i++) await keyDown('ArrowDown', 'ArrowDown', 40);
    await b.sleep(400);
    const vis = await b.evalJs(`(() => { const u = document.querySelector('[data-testid="mention-list"]'); const li = u.querySelector('[data-index="14"]');
      const a = u.getBoundingClientRect(), r = li.getBoundingClientRect(); return { sel: li.getAttribute('aria-selected'), inView: r.top >= a.top - 1 && r.bottom <= a.bottom + 1, top: u.scrollTop }; })()`) as any;
    ok('↓ 14 lần → chọn kết quả thứ 15 và cuộn tới (nằm trong khung nhìn)', vis.sel === 'true' && vis.inView && vis.top > 0, vis);
    await b.shot(`${tmpdir()}/ms-${stamp}-scroll.png`);

    await open();
    await type('@Nguyễn Văn Huy');
    await b.sleep(1200);
    o = (await opts()).filter((t) => t.includes(`S${stamp}`));
    ok('trùng tên → 2 dòng, dòng phụ khác nhau (mã · phòng ban · chức danh)', o.length === 2 && o[0] !== o[1] && o.some((t) => t.includes('Trưởng nhóm bán hàng')), o);

    await open();
    await type('@huy doan');
    await b.sleep(1200);
    o = await opts();
    ok('"@huy doan" → Đoàn Quang Huy đứng đầu (đang chọn)', o[0]?.includes('Đoàn Quang Huy'), o);
    await keyDown('Enter', 'Enter', 13);
    await b.sleep(400);
    const val = (await b.evalJs(`document.querySelector('[data-testid="comment-input"]').value`)) as string;
    ok('Enter chọn → chèn "@Đoàn Quang Huy " như cũ (thay cả từ khoá có dấu cách)', val === '@Đoàn Quang Huy ', val);
    await type('cam on');
    await b.sleep(500);
    ok('gõ tiếp câu thường sau khi chọn → không mở lại gợi ý', (await opts()).length === 0
      && ((await b.evalJs(`document.querySelectorAll('[data-testid="mention-list-empty"]').length`)) as number) === 0);
    await b.evalJs(`document.querySelector('[data-testid="comment-send"]').click()`);
    await b.sleep(2000);
    const cs = (await json(admin, 'GET', `/api/news/posts/${postId}/comments`)).body;
    const c = cs?.items?.[0];
    ok('bình luận lưu @nhắc như cũ (Đoàn Quang Huy trong mentions)', JSON.stringify(c ?? {}).includes('Đoàn Quang Huy'), c);

    await open();
    await type('@zzqq');
    await b.sleep(1200);
    ok('không ai khớp (một từ) → "Không tìm thấy ai"', ((await b.evalJs(`document.querySelector('[data-testid="mention-list-empty"]')?.innerText ?? ''`)) as string).includes('Không tìm thấy ai'));
    await open();
    await type('@huy doan xin chao');
    await b.sleep(1200);
    ok('họ tên có dấu cách nhưng hết người khớp → tự đóng (gõ câu thường tiếp)', (await opts()).length === 0
      && ((await b.evalJs(`document.querySelectorAll('[data-testid="mention-list-empty"]').length`)) as number) === 0);
    // Không chạy Realtime trong e2e này → bỏ qua lỗi SignalR negotiate (502)
    const errs = b.errors.filter((e) => !/negotiat|Failed to start the connection/.test(e));
    ok('không có lỗi console', errs.length === 0, errs);
  } finally { b.close(); }
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
