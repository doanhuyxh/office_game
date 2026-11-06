// E2E: bảng lương (kỳ, khoản cộng/trừ, chốt, phiếu của tôi, Excel, chặn token AI) + ký hợp đồng điện tử (OTP email, ký, PDF đã ký).
// TẠO DỮ LIỆU THẬT (nhân viên không xoá được) → CHỈ chạy với Api trỏ vào Postgres tạm + SMTP = Mailpit (đọc OTP qua API Mailpit):
//   docker run -d --name officehub-e2e-mail -p 127.0.0.1:11025:1025 -p 127.0.0.1:18025:8025 axllent/mailpit
//   Api: ConnectionStrings__Default=<DB tạm> Smtp__Host=127.0.0.1 Smtp__Port=11025 Smtp__UseSsl=false Smtp__Username= Smtp__Password=
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 MAILPIT_URL=http://127.0.0.1:18025 bun scripts/dev/payroll-sign-e2e.ts
if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5080';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:18025';
const env = Object.fromEntries((await Bun.file(new URL('../../.env', import.meta.url)).text()).split('\n')
  .filter((l) => /^[A-Za-z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const login = async (login: string, password: string) => {
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password }) });
  return { status: r.status, cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] };
};
const call = (cookie: string, method: string, path: string, body?: unknown) =>
  fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (cookie: string, method: string, path: string, body?: unknown) => {
  const r = await call(cookie, method, path, body);
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PW = 'E2e-Local-2026';

/** PDF 1 trang tối thiểu (xref tính đúng offset) để làm bản hợp đồng gốc. */
function minimalPdf(text: string) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${`BT /F1 18 Tf 72 760 Td (${text}) Tj ET`.length} >>\nstream\nBT /F1 18 Tf 72 760 Td (${text}) Tj ET\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([out], { type: 'application/pdf' });
}
/** PNG chữ ký 200×60 (đường chéo, nền trong suốt) — BE từ chối ảnh < 100 byte (khung trống). */
function signaturePng() {
  const { deflateSync } = require('node:zlib') as typeof import('node:zlib');
  const w = 200, h = 60, raw = Buffer.alloc((w * 4 + 1) * h);
  for (let x = 0; x < w; x++) for (let t = -1; t <= 1; t++) {
    const y = Math.round(30 + 20 * Math.sin(x / 15)) + t;
    if (y >= 0 && y < h) raw.set([30, 58, 138, 255], y * (w * 4 + 1) + 1 + x * 4);
  }
  const crc = (b: Buffer) => { let c = ~0; for (const v of b) { c ^= v; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const td = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(td.length + 8);
    out.writeUInt32BE(data.length, 0); td.copy(out, 4); out.writeUInt32BE(crc(td), td.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString('base64')}`;
}
const SIGNATURE = signaturePng();

async function latestOtp(to: string): Promise<string | null> {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/messages?limit=20`)).json();
    const m = list.messages?.find((x: any) => x.To?.some((t: any) => t.Address === to) && x.Subject.includes('Mã xác nhận'));
    if (m) {
      const msg = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
      return /letter-spacing:6px">(\d{6})</.exec(msg.HTML)?.[1] ?? null;
    }
    await sleep(500);
  }
  return null;
}

const admin = await login(env.Seed__AdminEmail, env.Seed__AdminPassword);
if (admin.status !== 200) throw new Error('Không đăng nhập được admin seed');
await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });

// ---------- Chuẩn bị: nhân viên + tài khoản + hợp đồng ----------
const dept = await json(admin.cookie, 'POST', '/api/org/departments', { name: 'Kế toán E2E', code: 'KTE' });
const empRes = await json(admin.cookie, 'POST', '/api/org/employees', { code: 'NV950', fullName: 'Phạm Ký Số', email: 'kyso@e2e.test', phone: null,
  dateOfBirth: null, departmentId: dept.body?.id ?? null, positionId: null, managerId: null, status: 'Active', joinedAt: '2026-09-01', note: null });
ok('tạo nhân viên NV950', empRes.status === 200 || empRes.status === 201, empRes);
const emp = empRes.body?.employee ?? empRes.body; // POST trả EmployeeDetail { employee, … }
const acc = await json(admin.cookie, 'POST', `/api/org/employees/${emp.id}/account`, { mode: 'password', roles: ['employee'], userName: 'e2e.kyso' });
const first = await login('e2e.kyso', acc.body.tempPassword);
await call(first.cookie, 'POST', '/api/auth/change-password', { currentPassword: acc.body.tempPassword, newPassword: PW });
const nv = await login('e2e.kyso', PW);
ok('nhân viên đăng nhập', nv.status === 200);

const contract = await json(admin.cookie, 'POST', '/api/contracts', { employeeId: emp.id, number: 'E2E-KY-01', type: 'Indefinite', signedDate: null,
  startDate: '2026-09-01', endDate: null, jobTitle: 'Kế toán viên', salary: 20000000, allowance: null, note: null });
ok('tạo hợp đồng 20 triệu', contract.status === 200 || contract.status === 201, contract);
const cid = contract.body.id;

// ---------- Ký điện tử ----------
ok('chưa có file PDF → 409', (await call(admin.cookie, 'POST', `/api/contracts/${cid}/sign-requests`)).status === 409);
const fd = new FormData();
fd.append('file', minimalPdf('HOP DONG LAO DONG E2E-KY-01'), 'hop-dong.pdf');
const up = await fetch(`${API}/api/contracts/${cid}/file`, { method: 'POST', headers: { cookie: admin.cookie }, body: fd });
ok('tải PDF hợp đồng', up.ok, await up.text());
ok('nhân viên không tạo được yêu cầu ký (403)', (await call(nv.cookie, 'POST', `/api/contracts/${cid}/sign-requests`)).status === 403);
const req = await json(admin.cookie, 'POST', `/api/contracts/${cid}/sign-requests`);
ok('HR gửi yêu cầu ký', req.status === 200 && req.body.status === 'Pending' && req.body.originalSha256?.length === 64, req);
const rid = req.body.id;
ok('gửi trùng khi đang chờ → 409', (await call(admin.cookie, 'POST', `/api/contracts/${cid}/sign-requests`)).status === 409);
await sleep(1000);
const bell = await json(nv.cookie, 'GET', '/api/notifications');
ok('nhân viên nhận thông báo chờ ký', JSON.stringify(bell.body).includes('contract_sign_requested'), bell.body);
const mine = await json(nv.cookie, 'GET', '/api/contracts/sign-requests');
ok('nhân viên thấy yêu cầu, canSign', mine.body?.length === 1 && mine.body[0].canSign === true, mine.body);
ok('HR không gửi OTP thay nhân viên (404)', (await call(admin.cookie, 'POST', `/api/contracts/sign-requests/${rid}/otp`)).status === 404);
const doc = await json(nv.cookie, 'GET', `/api/contracts/sign-requests/${rid}/document`);
ok('nhân viên mở bản gốc (presigned)', doc.status === 200 && doc.body.url?.startsWith('http'), doc);

ok('ký khi chưa có OTP → lỗi', !(await call(nv.cookie, 'POST', `/api/contracts/sign-requests/${rid}/sign`, { otp: '000000', signature: SIGNATURE, agree: true })).ok);
const sent = await json(nv.cookie, 'POST', `/api/contracts/sign-requests/${rid}/otp`);
ok('gửi OTP, email bị che', sent.status === 200 && sent.body.sentTo.includes('•') && !sent.body.sentTo.includes('kyso@'), sent);
ok('gửi lại ngay → 409 (chờ 60s)', (await call(nv.cookie, 'POST', `/api/contracts/sign-requests/${rid}/otp`)).status === 409);
const otp = await latestOtp('kyso@e2e.test');
ok('OTP tới hộp thư (Mailpit)', otp !== null);
const wrong = otp === '111111' ? '222222' : '111111';
ok('OTP sai → từ chối', !(await call(nv.cookie, 'POST', `/api/contracts/sign-requests/${rid}/sign`, { otp: wrong, signature: SIGNATURE, agree: true })).ok);
ok('chưa đồng ý → từ chối', !(await call(nv.cookie, 'POST', `/api/contracts/sign-requests/${rid}/sign`, { otp, signature: SIGNATURE, agree: false })).ok);
ok('chữ ký không phải PNG → 400', (await call(nv.cookie, 'POST', `/api/contracts/sign-requests/${rid}/sign`, { otp, signature: 'data:image/jpeg;base64,AAAA', agree: true })).status === 400);
const signed = await json(nv.cookie, 'POST', `/api/contracts/sign-requests/${rid}/sign`, { otp, signature: SIGNATURE, agree: true });
ok('ký thành công', signed.status === 200 && signed.body.status === 'Signed' && signed.body.signedSha256?.length === 64
  && signed.body.signedSha256 !== signed.body.originalSha256, signed);
ok('ký lại → lỗi', !(await call(nv.cookie, 'POST', `/api/contracts/sign-requests/${rid}/sign`, { otp, signature: SIGNATURE, agree: true })).ok);
const signedDoc = await json(nv.cookie, 'GET', `/api/contracts/sign-requests/${rid}/document?signed=true`);
const pdf = signedDoc.status === 200 ? new Uint8Array(await (await fetch(signedDoc.body.url)).arrayBuffer()) : new Uint8Array();
const sha = new Bun.CryptoHasher('sha256').update(pdf).digest('hex');
ok('PDF đã ký tải được, SHA khớp, có thêm trang chứng nhận', pdf.length > 1000 && sha === signed.body.signedSha256
  && (new TextDecoder('latin1').decode(pdf).match(/\/Type\s*\/Page[^s]/g)?.length ?? 0) >= 2, { len: pdf.length, sha });
const after = (await json(admin.cookie, 'GET', '/api/contracts')).body.find((c: any) => c.id === cid);
ok('file hợp đồng = bản đã ký, ngày ký được ghi', after?.file?.name?.includes('da-ky') || (after?.signedDate != null && after?.file != null), after);
await sleep(1000);
ok('HR nhận thông báo đã ký', JSON.stringify((await json(admin.cookie, 'GET', '/api/notifications')).body).includes('contract_signed'));
if (process.env.SAVE_SIGNED) await Bun.write(process.env.SAVE_SIGNED, pdf);

// Huỷ: gửi yêu cầu mới rồi HR huỷ
const req2 = await json(admin.cookie, 'POST', `/api/contracts/${cid}/sign-requests`);
ok('yêu cầu ký lần 2 (từ bản đã ký)', req2.status === 200, req2);
ok('HR huỷ yêu cầu', (await call(admin.cookie, 'DELETE', `/api/contracts/sign-requests/${req2.body.id}`)).status === 204);
ok('yêu cầu đã huỷ không ký được', (await call(nv.cookie, 'POST', `/api/contracts/sign-requests/${req2.body.id}/otp`)).status === 409);

// ---------- Bảng lương ----------
ok('nhân viên không vào được bảng lương HR (403)', (await call(nv.cookie, 'GET', '/api/payroll/periods')).status === 403);
const settings = await json(admin.cookie, 'GET', '/api/payroll/settings');
ok('thông số mặc định có sẵn', settings.body?.[0]?.rules?.brackets?.length === 5, settings.body);
const badRules = await json(admin.cookie, 'POST', '/api/payroll/settings', { effectiveFrom: '2026-12-01', rules: { ...settings.body[0].rules, brackets: [] } });
ok('biểu thuế rỗng → 400', badRules.status === 400, badRules);
ok('lưu hồ sơ thuế (1 người phụ thuộc)', (await call(admin.cookie, 'PUT', `/api/payroll/profiles/${emp.id}`, { dependents: 1, insured: null, taxCode: '8000000001', note: null })).ok);
const period = await json(admin.cookie, 'POST', '/api/payroll/periods', { month: '2026-10' });
ok('tạo + tính kỳ 10/2026', period.status === 200 && period.body.employees >= 1, period);
ok('tạo trùng kỳ → 409', (await call(admin.cookie, 'POST', '/api/payroll/periods', { month: '2026-10' })).status === 409);
const pid = period.body.id;
const adj = await json(admin.cookie, 'POST', `/api/payroll/periods/${pid}/adjustments`, { employeeId: emp.id, label: 'Thưởng dự án', amount: 40000000, taxable: true });
ok('thêm thưởng 40 triệu (tính lại)', adj.status === 200 || adj.status === 201, adj);
await call(admin.cookie, 'POST', `/api/payroll/periods/${pid}/adjustments`, { employeeId: emp.id, label: 'Trừ tạm ứng', amount: -1000000, taxable: false });
const noIns = (await json(admin.cookie, 'GET', `/api/payroll/periods/${pid}`)).body.payslips.find((s: any) => s.employeeId === emp.id)?.data;
ok('không có công cả tháng (≥ 14 ngày không lương) → không đóng BH, thực lĩnh không âm', noIns?.insured === false && noIns.employeeInsurance === 0
  && noIns.warnings.some((w: string) => w.includes('không đóng bảo hiểm')), noIns);
// Tắt quy tắc bằng bản thông số mới hiệu lực từ 10/2026 (không tạo được công quá khứ qua API) để kiểm tra BH + thuế
const rules10 = { ...settings.body[0].rules, unpaidDaysNoInsurance: 0 };
ok('lưu thông số mới hiệu lực 01/10/2026', (await call(admin.cookie, 'POST', '/api/payroll/settings', { effectiveFrom: '2026-10-01', rules: rules10 })).ok);
ok('tính lại kỳ', (await call(admin.cookie, 'POST', `/api/payroll/periods/${pid}/compute`)).status === 204);
const detail = await json(admin.cookie, 'GET', `/api/payroll/periods/${pid}`);
const slip = detail.body.payslips.find((s: any) => s.employeeId === emp.id)?.data;
console.log('   phiếu NV950:', JSON.stringify({ paid: slip?.paidDays, std: slip?.standardDays, gross: slip?.gross, ins: slip?.employeeInsurance, tax: slip?.tax, net: slip?.net, warn: slip?.warnings }));
// 40tr chịu thuế − BH 2,1tr − 15,5tr − 1 NPT 6,2tr = 16,2tr → 10tr × 5% + 6,2tr × 10% = 1.120.000
ok('phiếu: BH trên lương HĐ 20tr = 2,1tr, thuế lũy tiến 1.120.000, thực lĩnh = 40tr − 2,1tr − thuế − 1tr tạm ứng', slip?.insured === true && slip.employeeInsurance === 2100000
  && slip.taxMethod === 'progressive' && slip.dependents === 1 && slip.tax === 1120000 && slip.net === 40000000 - 2100000 - 1120000 - 1000000, slip);
const xlsx = await fetch(`${API}/api/payroll/periods/${pid}/export.xlsx`, { headers: { cookie: admin.cookie } });
ok('xuất Excel', xlsx.status === 200 && (xlsx.headers.get('content-type') ?? '').includes('spreadsheet'));
ok('kỳ nháp: nhân viên chưa thấy phiếu', (await json(nv.cookie, 'GET', '/api/payroll/my')).body?.length === 0);
const lock = await json(admin.cookie, 'POST', `/api/payroll/periods/${pid}/lock`);
ok('chốt kỳ', lock.status === 200 || lock.status === 204, lock);
ok('kỳ đã chốt không thêm khoản được (409)', (await call(admin.cookie, 'POST', `/api/payroll/periods/${pid}/adjustments`, { employeeId: emp.id, label: 'x', amount: 1, taxable: true })).status === 409);
const my = await json(nv.cookie, 'GET', '/api/payroll/my');
ok('nhân viên xem phiếu đã chốt (chỉ của mình)', my.body?.length === 1 && my.body[0].data.employeeCode === 'NV950' && my.body[0].data.net === slip.net, my.body);
await sleep(1000);
ok('thông báo phiếu lương', JSON.stringify((await json(nv.cookie, 'GET', '/api/notifications')).body).includes('payslip_ready'));
const cur = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7);
const curP = await json(admin.cookie, 'POST', '/api/payroll/periods', { month: cur });
ok('kỳ tháng hiện tại: chốt bị chặn (chưa hết tháng)', curP.status === 200 && (await call(admin.cookie, 'POST', `/api/payroll/periods/${curP.body.id}/lock`)).status === 409);

// ---------- Token AI không chạm được lương / hợp đồng ----------
const tok = await json(nv.cookie, 'POST', '/api/auth/access-tokens', { name: 'e2e', expiresInDays: 30 });
ok('tạo token AI cho nhân viên', tok.status === 200 && String(tok.body?.token).startsWith('ohk_'), tok);
const bearer = { authorization: `Bearer ${tok.body?.token}` };
const st = async (p: string, m = 'GET') => (await fetch(API + p, { method: m, headers: bearer })).status;
ok('token AI: /api/payroll/my bị chặn', [401, 403].includes(await st('/api/payroll/my')));
ok('token AI: yêu cầu ký bị chặn', [401, 403].includes(await st('/api/contracts/sign-requests')));
ok('token AI: gửi OTP bị chặn', [401, 403].includes(await st(`/api/contracts/sign-requests/${rid}/otp`, 'POST')));

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
