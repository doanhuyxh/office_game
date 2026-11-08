// E2E: chứng từ tài chính + Excel sổ thu chi — quyền (dòng sổ: Ghi sổ thêm / xoá, Xem đọc; đề nghị chi: người gửi + quản lý trực tiếp + Xem tài chính đọc,
// người gửi thêm khi chưa chi, Ghi sổ luôn được), loại / dung lượng, xin link → PUT S3 thật → xác nhận (chưa PUT → 409, người khác → 404), xem / tải (presigned),
// xoá mềm, dòng sổ chi theo đề nghị kèm chứng từ của đề nghị (không xoá từ dòng sổ), đếm trên danh sách, kỳ đã khoá (thêm được, không xoá), Excel 3 sheet, token AI.
// TẠO DỮ LIỆU THẬT + FILE S3 THẬT (thư mục finance/, vài trăm byte, xoá mềm nên file giữ lại) → CHỈ chạy trên DB tạm.
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/finance-docs-e2e.ts
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
const VIEW = 1, RECORD = 2, APPROVE = 4, ADMIN = 8;
const mkPos = async (name: string, level: number, fin: number) => (await json(admin, 'POST', '/api/org/positions', { name: `${name} ${stamp}`, level, financePermissions: fin })).body;
const pDir = await mkPos('TGĐ', 1, VIEW | APPROVE | ADMIN), pAcc = await mkPos('TKT', 3, RECORD), pPlain = await mkPos('TNV', 7, 0);
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Chứng từ ${stamp}`, code: `CT${stamp}` })).body;
const mkEmp = async (key: string, name: string, posId: string, managerId: string | null, roles: string[]) => {
  const user = `e2e.doc.${key}.${stamp}`;
  const e = (await json(admin, 'POST', '/api/org/employees', { code: `T${key.toUpperCase()}${stamp}`, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: posId, managerId, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW) };
};
const D = await mkEmp('dir', 'Giám Đốc CT', pDir, null, ['employee']);
const A = await mkEmp('acc', 'Kế Toán CT', pAcc, null, ['employee']);
const M = await mkEmp('mgr', 'Quản Lý CT', pPlain, null, ['employee', 'manager']);
const S = await mkEmp('staff', 'Nhân Viên CT', pPlain, M.e.id, ['employee']);
const O = await mkEmp('out', 'Người Ngoài CT', pPlain, null, ['employee']);
ok('5 nhân viên đăng nhập', [D, A, M, S, O].every((x) => !!x.cookie));

const cash = (await json(D.cookie, 'POST', '/api/finance/accounts', { name: `Quỹ CT ${stamp}`, kind: 'Cash', bankName: null, last4: null, openingBalance: 50_000_000, openingDate: '2026-01-01' })).body;
const entry = (await json(A.cookie, 'POST', '/api/finance/entries', { kind: 'Expense', date: today, amount: 1_200_000, accountId: cash, description: 'Mua mực in', counterparty: 'Cửa hàng X' })).body;

const PDF = new TextEncoder().encode(`%PDF-1.4\n% hoa don e2e ${stamp}\n%%EOF\n`);
const ask = (c: string, ownerType: string, ownerId: string, fileName = 'hoa-don.pdf', size = PDF.length, contentType = 'application/pdf') =>
  json(c, 'POST', '/api/finance/attachments', { ownerType, ownerId, fileName, contentType, size });
const upload = async (c: string, ownerType: string, ownerId: string, name = 'hoa-don.pdf') => {
  const t = await ask(c, ownerType, ownerId, name);
  if (t.status !== 200) return { status: t.status, body: t.body };
  const put = await fetch(t.body.uploadUrl, { method: 'PUT', headers: { 'Content-Type': t.body.contentType }, body: PDF });
  if (!put.ok) return { status: 900 + put.status, body: null };
  return json(c, 'POST', `/api/finance/attachments/${t.body.id}/confirm`, {});
};
const list = (c: string, ownerType: string, ownerId: string) => json(c, 'GET', `/api/finance/attachments?ownerType=${ownerType}&ownerId=${ownerId}`);

// ---------- Dòng sổ ----------
ok('Nhân viên không có quyền tài chính xem chứng từ dòng sổ → 404', (await list(S.cookie, 'Entry', entry)).status === 404);
ok('Giám đốc (Xem, không Ghi sổ) thêm chứng từ → 403', (await ask(D.cookie, 'Entry', entry)).status === 403);
ok('Tệp .exe → 400; 21 MB → 400', (await ask(A.cookie, 'Entry', entry, 'x.exe')).status === 400 && (await ask(A.cookie, 'Entry', entry, 'a.pdf', 21 * 1024 * 1024)).status === 400);
const pending = await ask(A.cookie, 'Entry', entry);
ok('Xác nhận khi chưa PUT → 409; người khác xác nhận → 404', (await json(A.cookie, 'POST', `/api/finance/attachments/${pending.body.id}/confirm`, {})).status === 409
  && (await json(D.cookie, 'POST', `/api/finance/attachments/${pending.body.id}/confirm`, {})).status === 404);
const up1 = await upload(A.cookie, 'Entry', entry);
ok('Kế toán tải chứng từ lên S3 + xác nhận (kích thước thật)', up1.status === 200 && up1.body.size === PDF.length, up1);
ok('Link chưa xác nhận không hiện trong danh sách', ((await list(A.cookie, 'Entry', entry)).body as any[]).length === 1);
const ents = (await json(D.cookie, 'GET', `/api/finance/entries?page=1&search=${encodeURIComponent('Mua mực in')}`)).body;
ok('Danh sách sổ: đếm 1 chứng từ', ents.items.find((e: any) => e.id === entry)?.attachmentCount === 1, ents.items);
const url = await json(D.cookie, 'GET', `/api/finance/attachments/${up1.body.id}/url`);
ok('Giám đốc xem được (presigned GET trả đúng nội dung)', url.status === 200 && (await (await fetch(url.body.url)).text()).includes(`hoa don e2e ${stamp}`), url);
ok('Người ngoài lấy link → 404', (await json(O.cookie, 'GET', `/api/finance/attachments/${up1.body.id}/url`)).status === 404);

// ---------- Đề nghị chi ----------
const ex = await json(S.cookie, 'POST', '/api/finance/expenses', { amount: 800_000, reason: `Taxi gặp khách ${stamp}` });
const exId = ex.body;
ok('Nhân viên gửi đề nghị + tải chứng từ', ex.status === 201 && (await upload(S.cookie, 'Expense', exId, 'bien-nhan.pdf')).status === 200);
const extra = await upload(S.cookie, 'Expense', exId, 'anh-hoa-don.pdf');
ok('Quản lý trực tiếp + giám đốc xem; người ngoài 404', (await list(M.cookie, 'Expense', exId)).body.length === 2 && (await list(D.cookie, 'Expense', exId)).status === 200
  && (await list(O.cookie, 'Expense', exId)).status === 404);
ok('Quản lý không thêm được → 403', (await ask(M.cookie, 'Expense', exId)).status === 403);
ok('Người gửi xoá chứng từ (xoá mềm) → còn 1', (await json(S.cookie, 'DELETE', `/api/finance/attachments/${extra.body.id}`)).status === 204
  && (await list(S.cookie, 'Expense', exId)).body.length === 1 && (await json(S.cookie, 'GET', `/api/finance/attachments/${extra.body.id}/url`)).status === 404);
const myExp = (await json(S.cookie, 'GET', '/api/finance/expenses?scope=mine&page=1')).body.items.find((x: any) => x.id === exId);
ok('Danh sách đề nghị: đếm 1 chứng từ', myExp.attachmentCount === 1, myExp);
await json(M.cookie, 'POST', `/api/approval/${myExp.approvalRequestId}/approve`, {});
ok('Duyệt đủ 2 bước', (await json(D.cookie, 'POST', `/api/approval/${myExp.approvalRequestId}/approve`, {})).status === 200);
ok('Kế toán chi tiền', (await json(A.cookie, 'POST', `/api/finance/expenses/${exId}/pay`, { accountId: cash, date: today })).status === 204);
ok('Đã chi: người gửi thêm chứng từ → 403; kế toán thêm được', (await ask(S.cookie, 'Expense', exId)).status === 403 && (await upload(A.cookie, 'Expense', exId, 'bo-sung.pdf')).status === 200);
const paidEntry = (await json(A.cookie, 'GET', `/api/finance/entries?page=1&search=${encodeURIComponent(stamp)}`)).body.items.find((e: any) => e.sourceId === exId);
const pl = (await list(A.cookie, 'Entry', paidEntry.id)).body as any[];
ok('Dòng sổ chi theo đề nghị hiện 2 chứng từ của đề nghị, không xoá từ dòng sổ', paidEntry.attachmentCount === 2 && pl.length === 2
  && pl.every((a) => a.ownerType === 'Expense' && a.canDelete === false), [paidEntry, pl]);

// ---------- Khoá sổ ----------
ok('Khoá sổ đến hôm nay', (await json(D.cookie, 'PUT', '/api/finance/lock', { lockedThrough: today })).status === 204);
ok('Kỳ đã khoá: vẫn thêm chứng từ, không xoá (409)', (await upload(A.cookie, 'Entry', entry, 'sao-ke.pdf')).status === 200
  && (await json(A.cookie, 'DELETE', `/api/finance/attachments/${up1.body.id}`)).status === 409
  && ((await list(A.cookie, 'Entry', entry)).body as any[]).every((a) => a.canDelete === false));
await json(D.cookie, 'PUT', '/api/finance/lock', { lockedThrough: null });
ok('Mở khoá → xoá được', (await json(A.cookie, 'DELETE', `/api/finance/attachments/${up1.body.id}`)).status === 204);

// ---------- Excel ----------
const xl = await fetch(`${API}/api/finance/entries/export.xlsx?from=${today.slice(0, 8)}01&to=${today}`, { headers: { cookie: D.cookie } });
const bytes = new Uint8Array(await xl.arrayBuffer());
ok('Excel: 200, xlsx, tên file theo kỳ', xl.status === 200 && (xl.headers.get('content-type') ?? '').includes('spreadsheetml') && bytes[0] === 0x50 && bytes[1] === 0x4b
  && (xl.headers.get('content-disposition') ?? '').includes('so-thu-chi-'), [xl.status, xl.headers.get('content-type')]);
ok('Excel: nhân viên → 403; đến ngày < từ ngày → 400', (await fetch(`${API}/api/finance/entries/export.xlsx`, { headers: { cookie: S.cookie } })).status === 403
  && (await fetch(`${API}/api/finance/entries/export.xlsx?from=${today}&to=2020-01-01`, { headers: { cookie: D.cookie } })).status === 400);
const tok = (await json(A.cookie, 'POST', '/api/auth/access-tokens', { name: `e2e doc ${stamp}`, expiresInDays: 30 })).body?.token as string;
ok('Token AI: chứng từ / Excel → 403', (await fetch(`${API}/api/finance/attachments?ownerType=Entry&ownerId=${entry}`, { headers: { authorization: `Bearer ${tok}` } })).status === 403
  && (await fetch(`${API}/api/finance/entries/export.xlsx`, { headers: { authorization: `Bearer ${tok}` } })).status === 403);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
