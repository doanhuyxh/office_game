// HubEndpoint: phân loại kết quả request tới endpoint phụ của OfficeHub — dùng chung cho presence / activity / usage / transcript.
import { afterAll, describe, expect, test } from 'bun:test';
import { FailureLog, failureKey, HubEndpoint, hubUrl, isTransient } from '../src/hub/endpoint';

let seen: { auth: string | null; body: unknown; query: string }[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    seen.push({
      auth: req.headers.get('authorization'),
      body: req.method === 'POST' ? await req.json() : null,
      query: url.search,
    });
    const code = Number(url.pathname.split('/').pop());
    if (code === 200) return Response.json({ accepted: 1 });
    if (code === 400) return Response.json({ detail: 'Thiếu trường sessions' }, { status: 400 });
    return new Response('thân lỗi thô', { status: code });
  },
});
afterAll(() => server.stop());

const endpoint = (code: number) =>
  new HubEndpoint(`http://localhost:${server.port}/mcp/`, String(code), 'ohk_token_abc');

describe('HubEndpoint', () => {
  test('hubUrl bỏ dấu / cuối của mcp_url', () => {
    expect(hubUrl('http://h/mcp/', 'usage')).toBe('http://h/mcp/usage');
    expect(hubUrl('http://h/mcp', 'usage')).toBe('http://h/mcp/usage');
  });

  test('2xx → ok kèm phản hồi; gửi Bearer token + thân JSON', async () => {
    seen = [];
    const o = await endpoint(200).post({ a: 1 }, 2000);
    expect(o.status).toBe('ok');
    if (o.status === 'ok') expect(await o.response.json()).toEqual({ accepted: 1 });
    expect(seen[0]).toEqual({ auth: 'Bearer ohk_token_abc', body: { a: 1 }, query: '' });
  });

  test('400 / 413 → invalid (detail của ProblemDetails); 401 / 403 → denied; 404 / 405 → missing', async () => {
    expect(await endpoint(400).post({}, 2000)).toEqual({
      status: 'invalid',
      code: 400,
      detail: 'Thiếu trường sessions',
    });
    expect((await endpoint(413).post({}, 2000)).status).toBe('invalid');
    expect((await endpoint(401).post({}, 2000)).status).toBe('denied');
    expect((await endpoint(403).post({}, 2000)).status).toBe('denied');
    expect(await endpoint(404).post({}, 2000)).toEqual({ status: 'missing', code: 404, detail: 'thân lỗi thô' });
    expect((await endpoint(405).post({}, 2000)).status).toBe('missing');
  });

  test('5xx / 429 / lỗi mạng → error, đáng thử lại; mã khác thì không', async () => {
    const busy = await endpoint(503).post({}, 2000);
    expect(busy).toEqual({ status: 'error', code: 503, detail: 'thân lỗi thô' });
    if (busy.status !== 'ok') expect([isTransient(busy), failureKey(busy)]).toEqual([true, 'status=503']);
    const limited = await endpoint(429).post({}, 2000);
    if (limited.status !== 'ok') expect(isTransient(limited)).toBe(true);
    const conflict = await endpoint(409).post({}, 2000);
    if (conflict.status !== 'ok') expect(isTransient(conflict)).toBe(false);
    const down = await new HubEndpoint('http://127.0.0.1:1/mcp', 'x', 't').post({}, 2000);
    expect(down.status).toBe('error');
    if (down.status === 'error') {
      expect(down.code).toBeUndefined();
      expect(isTransient(down)).toBe(true);
      expect(failureKey(down)).toBe(down.detail); // lỗi mạng: khoá gộp log là chính câu lỗi
    }
  });

  test('get: tham số lên query string, không gửi thân', async () => {
    seen = [];
    expect((await endpoint(200).get({ key: 'NV1:a b' }, 2000)).status).toBe('ok');
    expect(seen[0]).toEqual({ auth: 'Bearer ohk_token_abc', body: null, query: '?key=NV1%3Aa+b' });
  });
});

test('FailureLog: lỗi giống lần trước không ghi lại; chạy lại được thì ghi một dòng', () => {
  const lines: string[] = [];
  const orig = [console.log, console.error];
  console.log = console.error = (...a: unknown[]) => void lines.push(a.join(' '));
  try {
    const failures = new FailureLog('NV120');
    failures.warn('status=503', 'gửi lỗi');
    failures.warn('status=503', 'gửi lỗi');
    failures.warn('status=404', 'chưa có endpoint');
    expect(lines.length).toBe(2);
    failures.recovered('đã chạy lại');
    failures.recovered('đã chạy lại');
    expect(lines.filter((l) => l.includes('đã chạy lại')).length).toBe(1);
    failures.warn('status=503', 'gửi lỗi'); // sau khi chạy lại, lỗi cũ được ghi lại
    expect(lines.length).toBe(4);
  } finally {
    [console.log, console.error] = orig;
  }
});
