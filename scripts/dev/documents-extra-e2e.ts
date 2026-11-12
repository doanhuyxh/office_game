// E2E TEST-54 (kho tài liệu): mức Hạn chế / Mật (chỉ admin, HR, người tạo; người cùng kho 404; PDF trả bản đóng dấu qua Api, tải về attachment,
// không chiếu TV, token AI 403; hạ / nâng mức), tạo tài liệu chữ qua token (md / txt / csv → S3), gửi duyệt qua token luôn PendingApproval kể cả chức vụ
// tự ban hành (đối chứng web → Published). GHI FILE NHỎ LÊN S3 THẬT (documents/, nháp được xoá hẳn cuối bài; bản chờ duyệt / đã ban hành giữ lại)
// → CHỈ chạy trên DB tạm (Api như chat-e2e.ts):
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 ADMIN_LOGIN=e2e.admin@officehub.test ADMIN_PASSWORD='E2e-Admin-2026!' bun scripts/dev/documents-extra-e2e.ts
// MCP thật (tuỳ chọn): host Mcp `Mcp__ApiBaseUrl=http://localhost:5180 ASPNETCORE_URLS=http://localhost:5200` → thêm MCP_URL=http://localhost:5200/mcp
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';
if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5180';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
if (!ADMIN_LOGIN || !ADMIN_PASSWORD) throw new Error('Đặt ADMIN_LOGIN / ADMIN_PASSWORD của DB tạm');
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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
const json = async (cookie: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const PW = 'E2e-Local-2026';
const MAIL = 'officehub.test';
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');

const stamp = Date.now().toString(36);
const mkEmp = async (code: string, name: string, user: string, positionId?: string) => {
  const r = await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@${MAIL}`, phone: null, dateOfBirth: null,
    departmentId: null, positionId: positionId ?? null, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null });
  if (r.status >= 300) throw new Error(`Tạo ${code} lỗi: ${JSON.stringify(r.body)}`);
  const e = r.body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const me = (await json(cookie, 'GET', '/api/auth/me')).body;
  return { e, cookie, userId: me.id as string, name };
};
const selfPos = (await json(admin, 'POST', '/api/org/positions', { name: `Chuyên viên tự ban hành ${stamp}`, level: 6, selfPublishDocuments: true })).body as string;
const A = await mkEmp(`ND${stamp.slice(-4)}1`, 'Nguyễn Tài Liệu', `e2e.nd.a.${stamp}`, selfPos);
const B = await mkEmp(`ND${stamp.slice(-4)}2`, 'Trần Đọc Thử', `e2e.nd.b.${stamp}`);
ok('2 tài khoản + chức vụ tự ban hành', !!selfPos && !!A.cookie && !!B.cookie, selfPos);

// PDF tối giản hợp lệ (xref đúng offset) để đóng dấu
const pdfBytes = (() => {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>'];
  const stream = 'BT /F1 12 Tf 72 720 Td (E2E) Tj ET';
  objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return new TextEncoder().encode(out);
})();
const upload = async (cookie: string, name: string, bytes: Uint8Array) => {
  const t = await json(cookie, 'POST', '/api/documents/uploads', { fileName: name, contentType: null, size: bytes.length });
  if (t.status !== 200) throw new Error('Không xin được vé: ' + JSON.stringify(t.body));
  const put = await fetch(t.body.url, { method: 'PUT', headers: { 'Content-Type': t.body.contentType }, body: bytes });
  if (!put.ok) throw new Error('PUT S3 lỗi ' + put.status);
  return t.body.ticketId as string;
};
const created: string[] = [];

// ---------- Mức Hạn chế / Mật ----------
const bad = await json(A.cookie, 'POST', '/api/documents/assets', { ticketId: crypto.randomUUID(), spaceKind: 'Company', classification: 7 });
ok('mức bảo mật số lạ → 400 (trước khi nhận vé)', bad.status === 400 && !!bad.body?.errors?.classification, bad);
const pdf = await json(A.cookie, 'POST', '/api/documents/assets', { ticketId: await upload(A.cookie, 'bao-cao-mat.pdf', pdfBytes), spaceKind: 'Company',
  title: `Báo cáo mật ${stamp}`, classification: 'Restricted' });
ok('A tạo tài liệu Hạn chế', pdf.status === 200 && pdf.body.asset.classification === 'Restricted', pdf.body);
const P = pdf.body.asset.id as string;
created.push(P);
ok('B (cùng kho Công ty) không thấy: chi tiết 404', (await json(B.cookie, 'GET', `/api/documents/assets/${P}`)).status === 404);
const listB = (await json(B.cookie, 'GET', `/api/documents/assets?spaceKind=Company&search=${encodeURIComponent(stamp)}`)).body?.items ?? [];
ok('B không thấy trong danh sách / tìm', !listB.some((x: any) => x.id === P), listB.length);
ok('B xin link file → 404', (await json(B.cookie, 'GET', `/api/documents/assets/${P}/file`)).status === 404);
ok('B gọi thẳng protected-file → 404', (await fetch(`${API}/api/documents/assets/${P}/protected-file`, { headers: { cookie: B.cookie } })).status === 404);
const listA = (await json(A.cookie, 'GET', `/api/documents/assets?spaceKind=Company&search=${encodeURIComponent(stamp)}`)).body?.items ?? [];
ok('người tạo thấy trong danh sách', listA.some((x: any) => x.id === P && x.classification === 'Restricted'));
const fa = await json(A.cookie, 'GET', `/api/documents/assets/${P}/file`);
ok('người tạo xin link → link Api đóng dấu (không phải S3)', fa.status === 200 && fa.body.watermarked === true && fa.body.url.startsWith(`/api/documents/assets/${P}/protected-file`), fa.body);
const wm = await fetch(API + fa.body.url, { headers: { cookie: A.cookie } });
const wmBytes = new Uint8Array(await wm.arrayBuffer());
ok('protected-file trả PDF đã đóng dấu (lớn hơn bản gốc, inline)', wm.status === 200 && wm.headers.get('content-type') === 'application/pdf'
  && new TextDecoder().decode(wmBytes.slice(0, 5)) === '%PDF-' && wmBytes.length > pdfBytes.length && !(wm.headers.get('content-disposition') ?? '').includes('attachment'),
  { status: wm.status, ct: wm.headers.get('content-type'), len: wmBytes.length });
const dl = await json(A.cookie, 'GET', `/api/documents/assets/${P}/file?download=true`);
const dlr = await fetch(API + dl.body.url, { headers: { cookie: A.cookie } });
ok('tải về → attachment kèm tên file', dlr.status === 200 && (dlr.headers.get('content-disposition') ?? '').includes('attachment'), dlr.headers.get('content-disposition'));
const fh = await json(admin, 'GET', `/api/documents/assets/${P}/file`);
ok('admin / HR xem được (bản đóng dấu)', fh.status === 200 && fh.body.watermarked === true);
ok('chiếu lên TV phòng họp → 403', (await json(A.cookie, 'GET', `/api/documents/assets/${P}/file?present=true`)).status === 403);
const log = (await json(A.cookie, 'GET', `/api/documents/assets/${P}/access-log`)).body?.items ?? [];
ok('nhật ký ghi lượt xem / tải khi thật sự lấy bản đóng dấu (xin link thôi không tính)', log.filter((l: any) => l.action === 'View').length === 1 && log.filter((l: any) => l.action === 'Download').length === 1, log.map((l: any) => l.action));

const tok = (await json(A.cookie, 'POST', '/api/auth/access-tokens', { name: 'e2e-nd', expiresInDays: 30 })).body?.token;
const tk = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
ok('token AI của người tạo: link file Hạn chế → 403', !!tok && (await tk('GET', `/api/documents/assets/${P}/file`)).status === 403);
ok('token AI: protected-file → 403', (await tk('GET', `/api/documents/assets/${P}/protected-file`)).status === 403);

const up = await json(A.cookie, 'PUT', `/api/documents/assets/${P}`, { title: `Báo cáo mật ${stamp}`, description: null, tags: [], docTypeId: pdf.body.asset.docTypeId,
  folderId: null, classification: 'Internal' });
ok('hạ về Nội bộ → B thấy, link presigned bình thường', up.status === 200 && (await json(B.cookie, 'GET', `/api/documents/assets/${P}`)).status === 200
  && (await json(B.cookie, 'GET', `/api/documents/assets/${P}/file`)).body?.watermarked !== true, up.body);
const up2 = await json(A.cookie, 'PUT', `/api/documents/assets/${P}`, { title: `Báo cáo mật ${stamp}`, description: null, tags: [], docTypeId: pdf.body.asset.docTypeId,
  folderId: null, classification: 'Confidential' });
ok('nâng lên Mật → B lại 404', up2.status === 200 && (await json(B.cookie, 'GET', `/api/documents/assets/${P}`)).status === 404);
const img = await json(A.cookie, 'POST', '/api/documents/assets', { ticketId: await upload(A.cookie, 'ghi-chu.txt', new TextEncoder().encode('ghi chú mật')), spaceKind: 'Company',
  title: `Ghi chú mật ${stamp}`, classification: 'Confidential' });
created.push(img.body?.asset?.id);
const fi = await json(A.cookie, 'GET', `/api/documents/assets/${img.body.asset.id}/file`);
ok('file Mật không phải PDF → link gốc, watermarked = false (ghi nhật ký)', fi.status === 200 && fi.body.watermarked !== true && !fi.body.url.startsWith('/api/'), fi.body);

// ---------- Tạo tài liệu chữ + gửi duyệt qua token ----------
const md = `# Biên bản họp ${stamp}\n\n- Nội dung 1\n- Nội dung 2\n`;
const ct = await tk('POST', '/api/documents/assets/text', { spaceKind: 'Company', title: `Biên bản AI ${stamp}`, format: 'md', content: md });
ok('token tạo tài liệu chữ → Nháp, Nội bộ, ghi chú "Tạo qua trợ lý AI"', ct.status === 200 && ct.body.asset.status === 'Draft' && ct.body.asset.classification === 'Internal'
  && ct.body.versions?.[0]?.fileName === `Biên bản AI ${stamp}.md` && ct.body.versions?.[0]?.note === 'Tạo qua trợ lý AI', ct.body);
const T = ct.body.asset.id as string;
const link = await json(A.cookie, 'GET', `/api/documents/assets/${T}/file?download=true`);
const got = await (await fetch(link.body.url)).text();
ok('nội dung file trên S3 đúng như gửi', got === md, got.slice(0, 80));
ok('định dạng lạ → 400', (await tk('POST', '/api/documents/assets/text', { spaceKind: 'Company', title: 'x', format: 'exe', content: 'x' })).status === 400);
ok('thiếu nội dung → 400', (await tk('POST', '/api/documents/assets/text', { spaceKind: 'Company', title: 'x', format: 'md', content: ' ' })).status === 400);
ok('kho không có quyền ghi → 403 / 404', [403, 404].includes((await tk('POST', '/api/documents/assets/text', { spaceKind: 'Department', spaceId: crypto.randomUUID(), title: 'x', content: 'x' })).status));
ok('token vẫn không tải file / sửa / xoá', (await tk('POST', '/api/documents/uploads', { fileName: 'a.pdf', size: 10 })).status === 403
  && (await tk('DELETE', `/api/documents/assets/${T}`)).status === 403);
const sub = await tk('POST', `/api/documents/assets/${T}/submit`);
ok('token gửi duyệt (chức vụ được tự ban hành) → vẫn PendingApproval, có đơn duyệt', sub.status === 200 && sub.body.asset.status === 'PendingApproval', sub.body?.asset?.status ?? sub);
const web = await json(A.cookie, 'POST', '/api/documents/assets/text', { spaceKind: 'Company', title: `Web tự ban hành ${stamp}`, format: 'txt', content: 'abc' });
const ws = await json(A.cookie, 'POST', `/api/documents/assets/${web.body.asset.id}/submit`);
ok('đối chứng: cùng người trên web → tự ban hành ngay (Published)', ws.status === 200 && ws.body.asset.status === 'Published', ws.body?.asset?.status ?? ws);

// ---------- MCP thật (tuỳ chọn: MCP_URL, host Mcp chạy Mcp__ApiBaseUrl = API_URL) ----------
const MCP = process.env.MCP_URL;
if (MCP) {
  let rid = 0;
  const rpc = async (method: string, params: unknown = {}) => {
    const res = await fetch(MCP, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
    const text = await res.text();
    const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? text;
    try { return JSON.parse(data); } catch { return text; }
  };
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
  const tools = ((await rpc('tools/list'))?.result?.tools ?? []) as any[];
  ok('tools/list có create_document + submit_document (78 tool), không read-only', tools.length === 78
    && ['create_document', 'submit_document'].every((n) => tools.some((t) => t.name === n && t.annotations?.readOnlyHint !== true)), tools.length);
  const call = async (name: string, args: Record<string, unknown>) => {
    const x = await rpc('tools/call', { name, arguments: args });
    const text = x?.result?.content?.[0]?.text ?? '';
    let body: any = null; try { body = JSON.parse(text); } catch { /* lỗi dạng chữ */ }
    return { err: x?.result?.isError === true, text, body };
  };
  const mc = await call('create_document', { spaceKind: 'company', title: `MCP ghi chú ${stamp}`, content: 'a,b\n1,2\n', format: 'csv' });
  ok('MCP create_document → nháp .csv', !mc.err && mc.body?.asset?.status === 'Draft' && mc.body?.versions?.[0]?.fileName === `MCP ghi chú ${stamp}.csv`, mc.text.slice(0, 300));
  const ms = await call('submit_document', { document: mc.body?.asset?.code ?? '' });
  ok('MCP submit_document (theo mã TL-…) → PendingApproval', !ms.err && ms.body?.asset?.status === 'PendingApproval', ms.text.slice(0, 300));
  const ml = await call('get_document_link', { document: P });
  ok('MCP get_document_link tài liệu Mật → lỗi', ml.err, ml.text.slice(0, 200));
} else console.log('(bỏ qua phần MCP — đặt MCP_URL)');

// ---------- Dọn: nháp → thùng rác → xoá hẳn (xoá file S3) ----------
for (const id of created.filter(Boolean)) {
  await json(A.cookie, 'PUT', `/api/documents/assets/${id}`, { title: 'x', description: null, tags: [], docTypeId: pdf.body.asset.docTypeId, folderId: null });
  await json(A.cookie, 'DELETE', `/api/documents/assets/${id}`);
  await json(A.cookie, 'DELETE', `/api/documents/assets/${id}/purge`);
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
