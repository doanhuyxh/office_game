// E2E TEST-144: transcript phiên agent lên cloud XUYÊN khâu — TranscriptReporter THẬT của agent-runner → Mcp /mcp/transcripts → Api (audit.agent_transcripts,
// nội dung mã hoá như lương trên S3) → khôi phục lười vào HOME mới; quyền tra soát (admin / HR web), bot khác không đọc được, hết hạn.
// CHỈ DB tạm + khoá mã hoá tạm + tiền tố S3 riêng (S3 là bucket thật trong .env):
//   Api: ConnectionStrings__Default=<pg tạm> Seed__AdminEmail=… Seed__AdminPassword=… Chat__InternalKey=… Encryption__Key=$(openssl rand -base64 32)
//        S3__KeyPrefix=e2e-mcp-transcripts/ Telegram__ApiUrl=http://127.0.0.1:9 Smtp__Port=1 ASPNETCORE_URLS=http://localhost:5182 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   Mcp: Chat__InternalKey=… Mcp__ApiBaseUrl=http://localhost:5182 Mcp__RealtimeBaseUrl=http://127.0.0.1:9 ASPNETCORE_URLS=http://localhost:5202 dotnet run --project src/OfficeHub.Mcp --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5182 MCP_BASE=http://localhost:5202 ADMIN_LOGIN=… ADMIN_PASSWORD=… PG_CONTAINER=… PG_USER=e2e PG_DB=officehub_e2e \
//     bun scripts/dev/agent-transcripts-e2e.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeProjectDir } from '../../agent-runner/src/executor/adapters/claude';
import { Store } from '../../agent-runner/src/store';
import { TranscriptReporter, redactTranscript, sha256Hex, transcriptFile } from '../../agent-runner/src/transcript';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5182';
const MCP_BASE = process.env.MCP_BASE ?? 'http://localhost:5202';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const PG = process.env.PG_CONTAINER ?? 'oh-e2e-mp-pg', PG_USER = process.env.PG_USER ?? 'e2e', PG_DB = process.env.PG_DB ?? 'officehub_e2e';
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const psql = async (sql: string) => {
  const p = Bun.spawn(['docker', 'exec', PG, 'psql', '-U', PG_USER, '-d', PG_DB, '-tAc', sql], { stdout: 'pipe', stderr: 'pipe' });
  return (await new Response(p.stdout).text()).trim();
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
const json = async (cookie: string, method: string, path: string, body?: unknown, bearer?: string) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const r = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any, raw: r };
};
const PW = 'E2e-Local-2026';
const stamp = Date.now().toString(36).slice(-5);

// ---------- Chuẩn bị: admin, HR, người thường, 2 bot có token ----------
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const posStaff = positions.find((p: any) => p.name === 'Chuyên viên') ?? positions.at(-1);
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `Transcript ${stamp}`, code: `TR${stamp}`.slice(0, 10) })).body;
let seq = 400 + Math.floor(Math.random() * 90);
const mkEmp = async (name: string, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code: `NV${seq++}${stamp}`.slice(0, 20), fullName: name, email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: dep, positionId: posStaff.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  await json(await login(user, acc.tempPassword), 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const me = (await json(cookie, 'GET', '/api/auth/me')).body;
  const token = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `Agent ${user}`, expiresInDays: 30 })).body?.token as string;
  return { e, cookie, userId: me?.id as string, token, code: e.code as string };
};
const H = await mkEmp('Người Thật Transcript', `e2e.trh.${stamp}`, ['employee']);
const HR = await mkEmp('HR Transcript', `e2e.trhr.${stamp}`, ['employee', 'hr']);
const B = await mkEmp('Bot Dev Transcript', `e2e.trb.${stamp}`, ['employee']);
const B2 = await mkEmp('Bot QA Transcript', `e2e.trb2.${stamp}`, ['employee']);
for (const b of [B, B2]) await json(admin, 'PUT', `/api/org/employees/${b.e.id}/account/bot`, { isBot: true });
ok('4 tài khoản + token, 2 bot', [H, HR, B, B2].every((x) => x.cookie && x.token?.startsWith('ohk_')));

// ---------- Cửa vào /mcp/transcripts ----------
const URL_T = `${MCP_BASE}/mcp/transcripts`;
const gz = (s: string) => Buffer.from(Bun.gzipSync(Buffer.from(s))).toString('base64');
const raw = async (token: string | null, body: unknown, method = 'POST', query = '') => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(URL_T + query, { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const good = { key: `k-${stamp}`, kind: 'chat', sessionId: 's-x', cwd: '/w', branch: null, summary: null, contentBase64: gz('{"a":1}\n') };
ok('không token → 401', (await raw(null, good)).status === 401);
ok('người thật dùng token → 403', (await raw(H.token, good)).status === 403);
ok('kind lạ → 400', (await raw(B.token, { ...good, kind: 'other' })).status === 400);
ok('không phải gzip → 400', (await raw(B.token, { ...good, contentBase64: Buffer.from('{}').toString('base64') })).status === 400);
ok('GET thiếu key → 400', (await raw(B.token, null, 'GET')).status === 400);

// ---------- Runner thật: phiên vừa chạy → gửi lên ----------
const root = mkdtempSync(join(tmpdir(), 'e2e-transcript-'));
const home = join(root, 'home'), cwd = join(root, 'work/NV/TEST-45');
mkdirSync(cwd, { recursive: true });
const SID = `sess-${stamp}`, KEY = `01a1ced9-0a22-713a-b89d-${stamp.padEnd(12, '0')}`;
const SECRET = 'DB_PASSWORD=sieu-bi-mat-123';
const lines = [
  { type: 'user', message: { role: 'user', content: 'Sửa nút lưu ở trang hồ sơ' }, sessionId: SID },
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: { file_path: '.env' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', content: SECRET }] } },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'Đã sửa xong, chuyển Chờ review.' }] } },
];
const dir = claudeProjectDir(home, realpathSync(cwd));
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `${SID}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
const store = new Store(join(root, 'runner.db'));
store.saveSession(KEY, B.code, SID, 'agent/nv/test-45', cwd);
store.markTranscript(KEY, 'task', 'Đã làm: sửa nút lưu. Đang dở: không. Bước tiếp theo: review.');
const rep = new TranscriptReporter(`${MCP_BASE}/mcp`, B.token, B.code, store, home);
ok('runner gửi transcript (1 phiên)', (await rep.flush()) === 1, store.session(KEY));
ok('hàng chờ runner đã xong, có sha256', store.session(KEY)?.transcript_pending === 0 && /^[0-9a-f]{64}$/.test(store.session(KEY)?.transcript_sha ?? ''), store.session(KEY));

// ---------- Lưu trữ: DB + mã hoá ----------
const row = (await psql(`SELECT "Kind"||'|'||"SessionId"||'|'||left(coalesce("SummaryEncrypted",''),3)||'|'||"StorageKey"||'|'||("ExpiresAt" - "UpdatedAt") FROM audit.agent_transcripts WHERE "Key"='${KEY}'`)).split('|');
ok('DB: một dòng, kind task, đúng session, bản bàn giao mã hoá (v2:)', row[0] === 'task' && row[1] === SID && row[2] === 'v2:', row);
ok(`file S3 dưới agent-transcripts/<bot>/, hạn 90 ngày`, row[3]?.startsWith(`agent-transcripts/${B.userId}/`) && row[4]?.startsWith('90 days'), row);

// ---------- Bot khác / quyền tra soát ----------
ok('bot khác GET cùng key → 404 (chỉ đọc bản của mình)', (await raw(B2.token, null, 'GET', `?key=${encodeURIComponent(KEY)}`)).status === 404);
const list = (c: string, q = '', bearer?: string) => json(c, 'GET', `/api/agent-transcripts${q}`, undefined, bearer);
ok('người thường xem danh sách → 403', (await list(H.cookie)).status === 403);
ok('bot (cookie) xem danh sách → 403', (await list(B.cookie)).status === 403);
const adminToken = (await json(admin, 'POST', '/api/auth/access-tokens', { name: 'admin e2e', expiresInDays: 1 })).body?.token;
ok('token AI của admin → 403 (chỉ web)', !adminToken || (await list('', '', adminToken)).status === 403);
const lh = await list(HR.cookie, `?userId=${B.userId}`);
const item = lh.body?.items?.find((x: any) => x.key === KEY);
ok('HR xem danh sách của bot: key, kind, bản bàn giao đã giải mã, kích thước', lh.status === 200 && item?.kind === 'task' && item?.summary?.includes('Bước tiếp theo')
  && item?.sizeBytes > 0 && item?.fullName === 'Bot Dev Transcript', lh.body);
const la = await list(admin, '?kind=task');
ok('admin xem tất cả, lọc kind', la.status === 200 && la.body.items.some((x: any) => x.key === KEY) && la.body.items.every((x: any) => x.kind === 'task'));
ok('kind lạ → 400', (await list(admin, '?kind=abc')).status === 400);
const dl = await fetch(`${API}/api/agent-transcripts/${item.id}/download`, { headers: { cookie: HR.cookie } });
const dlBytes = new Uint8Array(await dl.arrayBuffer());
const text = Buffer.from(Bun.gunzipSync(dlBytes)).toString();
ok('HR tải về .jsonl.gz đã giải mã, đúng tên file', dl.status === 200 && (dl.headers.get('content-disposition') ?? '').includes('.jsonl.gz') && text.includes('Đã sửa xong'));
ok('nội dung đã che bí mật trước khi rời máy runner', !text.includes('sieu-bi-mat-123') && text.includes('DB_PASSWORD=***'));
ok('tải về khớp sha256 runner đã gửi', sha256Hex(dlBytes) === store.session(KEY)?.transcript_sha);
ok('người thường tải về → 403', (await fetch(`${API}/api/agent-transcripts/${item.id}/download`, { headers: { cookie: H.cookie } })).status === 403);

// ---------- Khôi phục lười: máy mới (HOME khác) ----------
const home2 = join(root, 'home-new');
const rep2 = new TranscriptReporter(`${MCP_BASE}/mcp`, B.token, B.code, new Store(join(root, 'runner-new.db')), home2);
ok('máy mới chưa có transcript', transcriptFile(home2, cwd, SID) === undefined);
ok('khôi phục đúng phiên từ cloud', (await rep2.restore(KEY, cwd)) === SID);
const restored = readFileSync(transcriptFile(home2, cwd, SID)!, 'utf8');
ok('file khôi phục = bản đã che, từng dòng là JSON hợp lệ (CLI --resume đọc được)',
  restored === redactTranscript(lines.map((l) => JSON.stringify(l)).join('\n') + '\n') && restored.trim().split('\n').every((l) => !!JSON.parse(l)));
ok('khoá chưa có trên cloud → undefined (phiên mới)', (await rep2.restore('khong-co', cwd)) === undefined);

// ---------- Gửi lại = thay ----------
writeFileSync(join(dir, `${SID}.jsonl`), [...lines, { type: 'user', message: { content: 'lượt 2' } }].map((l) => JSON.stringify(l)).join('\n') + '\n');
store.markTranscript(KEY, 'task', null);
ok('gửi lại sau phiên nối tiếp', (await rep.flush()) === 1);
ok('vẫn một dòng cho (bot, key), bản bàn giao bỏ trống được', (await psql(`SELECT count(*)||'|'||coalesce("SummaryEncrypted",'∅') FROM audit.agent_transcripts WHERE "Key"='${KEY}' GROUP BY "SummaryEncrypted"`)) === '1|∅');

// ---------- Hết hạn ----------
await psql(`UPDATE audit.agent_transcripts SET "ExpiresAt" = now() - interval '1 minute' WHERE "Key"='${KEY}'`);
ok('hết hạn → bot không đọc được (404)', (await raw(B.token, null, 'GET', `?key=${encodeURIComponent(KEY)}`)).status === 404);
ok('hết hạn → không còn trong danh sách / tải về 404', !(await list(admin)).body.items.some((x: any) => x.key === KEY)
  && (await fetch(`${API}/api/agent-transcripts/${item.id}/download`, { headers: { cookie: admin } })).status === 404);

rmSync(root, { recursive: true, force: true });
console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
