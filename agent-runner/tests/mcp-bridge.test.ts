// Cầu nối MCP stdio → HTTP (lệnh `mcp-bridge`, TEST-201): token lấy từ biến môi trường, không vào tham số / file.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BRIDGE_COMMAND, bridgeCommand, bridgeMessages, runMcpBridge } from '../src/hub/mcp-bridge';

const seen: { auth: string | null; session: string | null; body: any }[] = [];
let server: ReturnType<typeof Bun.serve>;
let url = '';

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as any;
      seen.push({ auth: req.headers.get('authorization'), session: req.headers.get('mcp-session-id'), body });
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (body.method === 'boom') return new Response('lỗi', { status: 500 });
      const reply = { jsonrpc: '2.0', id: body.id, result: { echo: body.method } };
      if (body.method === 'tools/call')
        return new Response(`event: message\ndata: ${JSON.stringify(reply)}\n\n`, {
          headers: { 'content-type': 'text/event-stream' },
        });
      return Response.json(reply, { headers: { 'mcp-session-id': 'sess-1' } });
    },
  });
  url = `http://localhost:${server.port}/mcp`;
});

afterAll(() => server.stop());

async function* lines(...items: string[]) {
  for (const item of items) yield item;
}

describe('mcp-bridge', () => {
  test('chuyển từng dòng JSON-RPC tới máy chủ kèm Bearer từ env; trả JSON / SSE thành từng dòng; giữ mcp-session-id', async () => {
    process.env.BRIDGE_TEST_TOKEN = 'tok-123';
    const out: string[] = [];
    await runMcpBridge(
      url,
      'BRIDGE_TEST_TOKEN',
      lines(
        '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
        '',
        'không phải json',
        '{"jsonrpc":"2.0","method":"notifications/initialized"}',
        '{"jsonrpc":"2.0","id":2,"method":"tools/call"}',
      ),
      (line) => out.push(line),
    );
    expect(out.map((l) => JSON.parse(l))).toEqual([
      { jsonrpc: '2.0', id: 1, result: { echo: 'initialize' } },
      { jsonrpc: '2.0', id: 2, result: { echo: 'tools/call' } },
    ]);
    expect(seen.map((s) => s.auth)).toEqual(['Bearer tok-123', 'Bearer tok-123', 'Bearer tok-123']);
    expect(seen.map((s) => s.session)).toEqual([null, 'sess-1', 'sess-1']);
  });

  test('máy chủ lỗi → trả lỗi JSON-RPC đúng id, cầu nối chạy tiếp; không có biến môi trường → không gửi Authorization', async () => {
    seen.length = 0;
    const out: string[] = [];
    await runMcpBridge(
      url,
      'BRIDGE_TEST_KHONG_CO',
      lines('{"jsonrpc":"2.0","id":7,"method":"boom"}', '{"jsonrpc":"2.0","id":8,"method":"ping"}'),
      (line) => out.push(line),
    );
    expect(JSON.parse(out[0]!)).toMatchObject({ id: 7, error: { code: -32000 } });
    expect(JSON.parse(out[0]!).error.message).toContain('500');
    expect(JSON.parse(out[1]!)).toMatchObject({ id: 8, result: { echo: 'ping' } });
    expect(seen.every((s) => s.auth === null)).toBe(true);
  });

  test('bridgeMessages: JSON nhiều dòng → một dòng; SSE nhiều data → nhiều thông điệp; thân rỗng → không có gì', () => {
    expect(bridgeMessages('{\n  "a": 1\n}')).toEqual(['{"a":1}']);
    expect(bridgeMessages('data: {"a":1}\n\ndata: {"b":2}\n')).toEqual(['{"a":1}', '{"b":2}']);
    expect(bridgeMessages('')).toEqual([]);
  });

  test('bridgeCommand: chạy lại chính runner, tham số chỉ có URL + TÊN biến; lệnh thật chạy được qua stdin / stdout', async () => {
    const c = bridgeCommand(url, 'BRIDGE_TEST_TOKEN');
    expect(c.command).toBe(process.execPath);
    expect(c.args).toEqual([
      join(import.meta.dir, '..', 'src', 'cli.ts'),
      BRIDGE_COMMAND,
      '--url',
      url,
      '--bearer-env',
      'BRIDGE_TEST_TOKEN',
    ]);
    expect(bridgeCommand(url).args.slice(-2)).toEqual(['--url', url]);
    seen.length = 0;
    const p = Bun.spawn([c.command, ...c.args], {
      stdin: 'pipe',
      stdout: 'pipe',
      env: { PATH: process.env.PATH ?? '', BRIDGE_TEST_TOKEN: 'tok-cli' },
    });
    p.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
    p.stdin.end();
    const text = await new Response(p.stdout).text();
    expect(await p.exited).toBe(0);
    expect(JSON.parse(text.trim())).toEqual({ jsonrpc: '2.0', id: 1, result: { echo: 'initialize' } });
    expect(seen[0]!.auth).toBe('Bearer tok-cli');
  });
});
