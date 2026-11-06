// Smoke test bản đã deploy — CHỈ ĐỌC, không ghi dữ liệu. Chạy sau mỗi lần deploy:
//   BASE_URL=https://office.lokid.me bun scripts/dev/prod-smoke.ts
// Tuỳ chọn kiểm tra khi đã đăng nhập (dùng tài khoản thử nếu có trên production, KHÔNG dùng tài khoản thật):
//   SMOKE_USER=… SMOKE_PASSWORD=… BASE_URL=… bun scripts/dev/prod-smoke.ts
import { connect } from 'node:net';

const BASE = (process.env.BASE_URL ?? 'https://office.lokid.me').replace(/\/$/, '');
const host = new URL(BASE).hostname;
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 300) : ''}`);
};
const get = (path: string, init: RequestInit = {}) => fetch(BASE + path, { redirect: 'manual', ...init });
const tcp = (port: number) => new Promise<boolean>((res) => {
  const s = connect({ host, port, timeout: 5000 }, () => { s.destroy(); res(true); });
  s.on('error', () => res(false)).on('timeout', () => { s.destroy(); res(false); });
});

// ---------- Web + Api ----------
const home = await get('/');
ok('trang chủ 200', home.status === 200);
const h = home.headers;
ok('HSTS', (h.get('strict-transport-security') ?? '').includes('max-age='));
ok('chống nhúng iframe (X-Frame-Options / frame-ancestors)', h.get('x-frame-options') === 'DENY' && (h.get('content-security-policy') ?? '').includes("frame-ancestors 'none'"));
ok('X-Content-Type-Options nosniff', h.get('x-content-type-options') === 'nosniff');
const health = await get('/health');
ok('/health tới Api (Healthy)', health.status === 200 && (await health.text()).includes('Healthy'));
ok('/health/ready KHÔNG lộ ra ngoài (trả trang FE)', !(await (await get('/health/ready')).text()).includes('"postgres"'));
const me = await get('/api/auth/me');
ok('Api: chưa đăng nhập → 401 problem+json', me.status === 401 && (me.headers.get('content-type') ?? '').includes('problem+json'));
const assets = (await (await get('/')).text()).match(/\/assets\/[^"']+\.js/)?.[0];
if (assets) {
  const a = await get(assets);
  ok('asset JS cache lâu dài', a.status === 200 && (a.headers.get('cache-control') ?? '').includes('immutable'));
}

// ---------- Kết nối AI ----------
const mcp = await get('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) });
const wa = mcp.headers.get('www-authenticate') ?? '';
ok('MCP: 401 + resource_metadata đúng domain', mcp.status === 401 && wa.includes(`${BASE}/.well-known/oauth-protected-resource/mcp`), wa);
const prm = await (await get('/.well-known/oauth-protected-resource/mcp')).json().catch(() => null);
ok('OAuth protected resource metadata', prm?.resource === `${BASE}/mcp` && prm?.authorization_servers?.[0] === BASE, prm);
const as = await (await get('/.well-known/oauth-authorization-server')).json().catch(() => null);
ok('OAuth authorization server metadata (https, S256)', as?.issuer === BASE && as?.token_endpoint?.startsWith('https://') && as?.code_challenge_methods_supported?.includes('S256'), as);
const tok = await get('/api/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=authorization_code&client_id=ohc_smoke_khongco' });
ok('OAuth token endpoint (client sai → invalid_client)', tok.status === 401 && (await tok.json().catch(() => ({}))).error === 'invalid_client');
const pre = await get('/api/oauth/token', { method: 'OPTIONS', headers: { origin: 'https://claude.ai', 'access-control-request-method': 'POST' } });
ok('CORS cho ứng dụng AI', pre.headers.get('access-control-allow-origin') === '*');
ok('trang đồng ý /oauth/authorize phục vụ được', (await get('/oauth/authorize')).status === 200);

// ---------- Realtime + voice ----------
ok('Realtime: chưa đăng nhập → 401', (await get('/rt/hub/office/negotiate?negotiateVersion=1', { method: 'POST' })).status === 401);
ok('LiveKit qua /livekit', (await get('/livekit/')).status === 200);
ok('cổng media LiveKit 7881/tcp mở', await tcp(7881));
console.log('  (7882/udp không kiểm tra được bằng script — thử voice thật giữa 2 máy khác mạng)');

// ---------- Đã đăng nhập (tuỳ chọn) ----------
if (process.env.SMOKE_USER && process.env.SMOKE_PASSWORD) {
  const l = await get('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login: process.env.SMOKE_USER, password: process.env.SMOKE_PASSWORD }) });
  const cookie = (l.headers.get('set-cookie') ?? '').split(';')[0];
  ok('đăng nhập', l.status === 200);
  for (const [name, path] of [['chấm công hôm nay', '/api/attendance/today'], ['quỹ phép', '/api/leave/balance'], ['thông báo', '/api/notifications?take=1'],
    ['phòng họp', '/api/meetings/rooms'], ['token AI của tôi', '/api/auth/access-tokens'], ['tiền phép ước tính', '/api/reports/leave-payout/me']] as const) {
    const r = await get(path, { headers: { cookie } });
    ok(`đọc: ${name}`, r.status === 200 || r.status === 404, r.status); // 404 = chưa có hồ sơ nhân viên
  }
  const now = await (await get('/api/meetings/bookings/now', { headers: { cookie } })).json().catch(() => null);
  ok('phòng họp từ bản đồ (2 phòng)', Array.isArray(now) && now.length === 2, now);
  const ts = await get('/api/attendance/today', { headers: { cookie } });
  if (ts.status === 200) ok('thời điểm trả về dạng UTC …Z', /"serverTime":"[^"]+Z"/.test(await ts.text()));
} else console.log('  (bỏ qua phần đã đăng nhập: chưa đặt SMOKE_USER / SMOKE_PASSWORD)');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
