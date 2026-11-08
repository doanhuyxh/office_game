// E2E OAuth cho trợ lý AI (MCP Authorization): discovery → đăng ký (DCR) → đồng ý → token → gọi tool → refresh → các tình huống tấn công.
// Đi qua FE dev (Vite :5173 proxy /api, /mcp, /.well-known) để origin khớp App__BaseUrl. Cần Api + OfficeHub.Mcp + Vite đang chạy.
//   TEST_PASSWORD=<mật khẩu trong account.txt> bun scripts/dev/mcp-oauth-e2e.ts
// Không ghi dữ liệu nghiệp vụ (chỉ tool đọc); grant tạo ra bị thu hồi ở cuối.
import { createHash, randomBytes } from 'node:crypto';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const PASS = process.env.TEST_PASSWORD ?? (() => { throw new Error('Thiếu TEST_PASSWORD (mật khẩu trong account.txt)'); })();
const USER = process.env.TEST_USER ?? 'kythuat.nhanvien1';
const REDIRECT = 'http://127.0.0.1:8976/callback';
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 400) : ''}`);
};
const b64url = (b: Buffer) => b.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const pkce = () => { const verifier = b64url(randomBytes(32)); return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) }; };
const form = (o: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o) });
const login = async (user: string) => {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: user, password: PASS }) });
  return (r.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => c.startsWith('officehub.auth=')).at(-1) ?? '');
};
async function mcp(token: string | null, method: string, params: unknown = {}) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const t = await res.text();
  const d = t.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? t;
  let body: any; try { body = JSON.parse(d); } catch { body = t; }
  return { status: res.status, headers: res.headers, body };
}

// 1) Discovery
const unauth = await mcp(null, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
const wa = unauth.headers.get('www-authenticate') ?? '';
const prmUrl = /resource_metadata="([^"]+)"/.exec(wa)?.[1];
ok('MCP 401 + WWW-Authenticate resource_metadata', unauth.status === 401 && !!prmUrl, wa);
const prm = await (await fetch(prmUrl!)).json();
ok('protected resource metadata', prm.resource === `${BASE}/mcp` && prm.authorization_servers?.[0] === BASE, prm);
const as = await (await fetch(`${prm.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json();
ok('authorization server metadata (S256, DCR)', as.code_challenge_methods_supported?.includes('S256') && !!as.registration_endpoint, as);

// 2) Đăng ký ứng dụng
const badReg = await fetch(as.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'x', redirect_uris: ['http://evil.example.com/cb'] }) });
ok('DCR từ chối redirect http không phải loopback', badReg.status === 400);
const reg = await (await fetch(as.registration_endpoint, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://claude.ai' },
  body: JSON.stringify({ client_name: 'E2E Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_post' }),
})).json();
ok('DCR: client công khai (auth none)', reg.client_id?.startsWith('ohc_') && reg.token_endpoint_auth_method === 'none', reg);

// 3) Người dùng đồng ý (trang /oauth/authorize gọi các API này bằng cookie)
const cookie = await login(USER);
const { verifier, challenge } = pkce();
const params = { response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz 123', scope: 'officehub', resource: `${BASE}/mcp` };
const anonInfo = await fetch(`${BASE}/api/oauth/authorize?${new URLSearchParams(params)}`);
ok('trang đồng ý cần đăng nhập (401)', anonInfo.status === 401);
const info = await (await fetch(`${BASE}/api/oauth/authorize?${new URLSearchParams(params)}`, { headers: { cookie } })).json();
ok('authorize info', info.clientName === 'E2E Claude' && info.redirectHost === '127.0.0.1', info);
const badRedirect = await (await fetch(`${BASE}/api/oauth/authorize?${new URLSearchParams({ ...params, redirect_uri: 'https://evil.example.com/cb' })}`, { headers: { cookie } })).json();
ok('redirect_uri lạ → lỗi KHÔNG chuyển hướng', badRedirect.error === 'invalid_request' && badRedirect.redirectTo === null, badRedirect);
const noPkce = await (await fetch(`${BASE}/api/oauth/authorize?${new URLSearchParams({ ...params, code_challenge_method: 'plain' })}`, { headers: { cookie } })).json();
ok('thiếu PKCE S256 → lỗi trả về ứng dụng', noPkce.redirectTo?.startsWith(REDIRECT) && noPkce.redirectTo.includes('state=xyz%20123'), noPkce);
const deny = await (await fetch(`${BASE}/api/oauth/authorize`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ ...params, approve: false }) })).json();
ok('từ chối → error=access_denied', deny.redirectTo?.includes('error=access_denied'), deny);
const allow = await (await fetch(`${BASE}/api/oauth/authorize`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ ...params, approve: true }) })).json();
const cb = new URL(allow.redirectTo);
const code = cb.searchParams.get('code')!;
ok('cho phép → code + state', !!code && cb.searchParams.get('state') === 'xyz 123', allow);

// 4) Đổi mã lấy token
const wrongVerifier = await fetch(as.token_endpoint, form({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: pkce().verifier }));
ok('code_verifier sai → invalid_grant', (await wrongVerifier.json()).error === 'invalid_grant');
// Lưu ý: lần sai ở trên KHÔNG tiêu mã (mã chỉ bị đánh dấu dùng khi PKCE đúng)
const tokRes = await fetch(as.token_endpoint, form({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: verifier }));
const tok = await tokRes.json();
ok('token: access + refresh, no-store', tok.access_token?.startsWith('ohk_') && tok.refresh_token?.startsWith('ohr_') && tok.expires_in === 3600
  && tokRes.headers.get('cache-control') === 'no-store', tok);

// 5) Dùng access token với MCP
const init = await mcp(tok.access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
ok('MCP initialize bằng token OAuth', init.status === 200 && init.body?.result?.serverInfo?.name === 'officehub', init.body);
const prof = await mcp(tok.access_token, 'tools/call', { name: 'get_my_profile', arguments: {} });
ok('tool get_my_profile', !prof.body?.result?.isError && prof.body?.result?.content?.[0]?.text.includes(USER), prof.body);
const contracts = await fetch(`${BASE}/api/contracts/my`, { headers: { authorization: `Bearer ${tok.access_token}` } });
ok('token OAuth cũng bị chặn hợp đồng (403)', contracts.status === 403);
const grants = await (await fetch(`${BASE}/api/oauth/grants`, { headers: { cookie } })).json();
const grant = grants.find((g: any) => g.clientName === 'E2E Claude' && g.status === 'Active');
ok('ứng dụng hiện trong "Ứng dụng đã kết nối"', !!grant, grants);
const tokens = await (await fetch(`${BASE}/api/auth/access-tokens`, { headers: { cookie } })).json();
ok('access token OAuth không lẫn vào danh sách token cá nhân', !tokens.some((t: any) => t.name === 'E2E Claude'));

// 6) Refresh (xoay vòng)
const r1 = await (await fetch(as.token_endpoint, form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: reg.client_id }))).json();
ok('refresh → token mới', r1.access_token && r1.refresh_token && r1.refresh_token !== tok.refresh_token, r1);
const p2 = await mcp(r1.access_token, 'tools/call', { name: 'get_leave_balance', arguments: {} });
ok('access token mới dùng được', !p2.body?.result?.isError, p2.body);
const wrongClient = await (await fetch(as.token_endpoint, form({ grant_type: 'refresh_token', refresh_token: r1.refresh_token, client_id: 'ohc_khongco' }))).json();
ok('refresh với client khác → invalid_client', wrongClient.error === 'invalid_client', wrongClient);

// 7) Nhật ký AI (module Audit ghi nền → đợi chút)
await new Promise((r) => setTimeout(r, 1500));
const activity = await (await fetch(`${BASE}/api/audit/ai-requests?take=20`, { headers: { cookie } })).json();
ok('nhật ký có tool + lần bị chặn', activity.some((a: any) => a.tool === 'get_my_profile' && a.viaOAuth) && activity.some((a: any) => a.status === 403 && a.path === '/api/contracts/my'), activity.slice(0, 3));
const auditByToken = await fetch(`${BASE}/api/audit/ai-requests`, { headers: { authorization: `Bearer ${r1.access_token}` } });
ok('token AI không đọc được nhật ký (403)', auditByToken.status === 403);

// 8) HR xem toàn công ty; nhân viên thì không
const empConn = await fetch(`${BASE}/api/auth/ai-connections`, { headers: { cookie } });
ok('nhân viên không xem kết nối toàn công ty (403)', empConn.status === 403);
const hrCookie = await login('hr.truongphong');
const conns = await (await fetch(`${BASE}/api/auth/ai-connections`, { headers: { cookie: hrCookie } })).json();
ok('HR thấy ứng dụng của nhân viên', conns.some((c: any) => c.kind === 'app' && c.id === grant?.id), conns.slice(0, 3));

// 9) Refresh token cũ bị dùng lại → thu hồi cả grant
const reuse = await (await fetch(as.token_endpoint, form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: reg.client_id }))).json();
ok('dùng lại refresh token cũ → invalid_grant', reuse.error === 'invalid_grant', reuse);
const afterReuse = await fetch(`${BASE}/api/leave/balance`, { headers: { authorization: `Bearer ${r1.access_token}` } });
ok('…và access token đang dùng cũng bị chặn ngay', afterReuse.status === 401);

// 10) Mã ủy quyền dùng lại
const reuseCode = await (await fetch(as.token_endpoint, form({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: verifier }))).json();
ok('dùng lại mã ủy quyền → invalid_grant', reuseCode.error === 'invalid_grant', reuseCode);

// 11) HR thu hồi hộ (grant thứ hai)
const p3 = pkce();
const allow2 = await (await fetch(`${BASE}/api/oauth/authorize`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ ...params, code_challenge: p3.challenge, approve: true }) })).json();
const tok2 = await (await fetch(as.token_endpoint, form({ grant_type: 'authorization_code', code: new URL(allow2.redirectTo).searchParams.get('code')!, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: p3.verifier }))).json();
const g2 = (await (await fetch(`${BASE}/api/oauth/grants`, { headers: { cookie } })).json()).find((g: any) => g.status === 'Active' && g.clientName === 'E2E Claude');
const hrRevoke = await fetch(`${BASE}/api/oauth/grants/${g2.id}`, { method: 'DELETE', headers: { cookie: hrCookie } });
ok('HR thu hồi ứng dụng của nhân viên', hrRevoke.status === 204);
const afterHr = await mcp(tok2.access_token, 'tools/call', { name: 'get_leave_balance', arguments: {} });
ok('sau khi HR thu hồi: tool lỗi', afterHr.body?.result?.isError === true || afterHr.status === 401, afterHr.body);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
