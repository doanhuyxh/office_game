import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { ActivitySender, activityUrl } from '../src/activity';
import type { ActivityEvent } from '../src/executor/events';
import { parseConfig } from '../src/config';
import { baseRaw } from './units.test';

/** Máy chủ giả /mcp/activity: ghi từng lô, trả theo kịch bản `replies` (hết kịch bản → 204). */
const batches: ActivityEvent[][] = [];
let replies: (number | 'hang')[] = [];
let auth: string | null = null;
let server: ReturnType<typeof Bun.serve>;
let url = '';
const defaults = { intervalMs: ActivitySender.intervalMs, maxBatch: ActivitySender.maxBatch, maxBytes: ActivitySender.maxBytes,
  maxQueue: ActivitySender.maxQueue, retryDelayMs: ActivitySender.retryDelayMs, drainMs: ActivitySender.drainMs };

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      auth = req.headers.get('authorization');
      const body = await req.json() as { events: ActivityEvent[] };
      const r = replies.shift() ?? 204;
      if (r === 'hang') { await new Promise((ok) => setTimeout(ok, 2_000)); return new Response(null, { status: 204 }); }
      if (r === 204) batches.push(body.events);
      return new Response(null, { status: r });
    },
  });
  url = `http://localhost:${server.port}/mcp`;
});
afterAll(() => server.stop(true));
afterEach(() => { batches.length = 0; replies = []; Object.assign(ActivitySender, defaults); });

const ev = (n: number, extra: Partial<ActivityEvent> = {}): ActivityEvent => ({ id: `e${n}`, kind: 'say', text: `tin ${n}`, ...extra });
const ids = () => batches.map((b) => b.map((e) => e.id));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('gửi hoạt động xem trực tiếp (TEST-99)', () => {
  test('URL + token', async () => {
    expect(activityUrl('http://h/mcp/')).toBe('http://h/mcp/activity');
    const s = new ActivitySender(url, 'ohk_token_abcdefgh', 'NV120');
    s.push(ev(1));
    await s.drain();
    expect(auth).toBe('Bearer ohk_token_abcdefgh');
    expect(ids()).toEqual([['e1']]);
  });

  test('gom theo thời gian: nhiều sự kiện trong một nhịp → một lô, đúng thứ tự', async () => {
    ActivitySender.intervalMs = 60;
    const s = new ActivitySender(url, 't', 'NV120');
    s.push(ev(1)); s.push(ev(2)); s.push(ev(3));
    expect(batches.length).toBe(0); // chưa tới nhịp
    await sleep(150);
    expect(ids()).toEqual([['e1', 'e2', 'e3']]);
    s.push(ev(4));
    await sleep(150);
    expect(ids()).toEqual([['e1', 'e2', 'e3'], ['e4']]);
    expect(s.pending).toBe(0);
  });

  test('gom theo số lượng: đủ 50 → gửi ngay không chờ nhịp; lô ≤ 50', async () => {
    ActivitySender.intervalMs = 60_000;
    const s = new ActivitySender(url, 't', 'NV120');
    for (let i = 0; i < 120; i++) s.push(ev(i));
    await sleep(200);                                               // nhịp 60 giây chưa tới mà đã gửi hết: lượt gửi đang chạy lấy luôn phần còn lại
    expect(batches.map((b) => b.length)).toEqual([50, 50, 20]);
    expect(batches.flat().map((e) => e.id)).toEqual(Array.from({ length: 120 }, (_, i) => `e${i}`));
  });

  test('chia lô theo dung lượng thân', async () => {
    ActivitySender.maxBytes = 1_000;
    const s = new ActivitySender(url, 't', 'NV120');
    for (let i = 0; i < 5; i++) s.push(ev(i, { text: 'x'.repeat(400) }));
    s.push(ev(9, { text: 'y'.repeat(5_000) })); // một sự kiện lớn hơn giới hạn vẫn đi riêng một lô
    await s.drain();
    expect(batches.map((b) => b.length)).toEqual([2, 2, 1, 1]);
  });

  test('hàng chờ đầy → bỏ sự kiện cũ nhất', async () => {
    ActivitySender.maxQueue = 10; ActivitySender.maxBatch = 100; ActivitySender.intervalMs = 60_000;
    const s = new ActivitySender(url, 't', 'NV120');
    for (let i = 0; i < 25; i++) s.push(ev(i));
    expect(s.pending).toBe(10);
    await s.drain();
    expect(ids()).toEqual([Array.from({ length: 10 }, (_, i) => `e${i + 15}`)]);
  });

  test('401 / 403 → ngừng gửi hẳn cho agent đó', async () => {
    for (const status of [401, 403]) {
      replies = [status];
      const s = new ActivitySender(url, 't', 'NV120');
      s.push(ev(1));
      await s.drain();
      expect(s.active).toBe(false);
      s.push(ev(2));
      expect(s.pending).toBe(0);
      await s.drain();
      expect(batches.length).toBe(0);
    }
  });

  test('5xx / 429 → thử lại lô đó 1 lần; vẫn lỗi → bỏ lô, lô sau vẫn gửi', async () => {
    ActivitySender.retryDelayMs = 10;
    const s = new ActivitySender(url, 't', 'NV120');
    replies = [503];             // lần đầu lỗi, thử lại được
    s.push(ev(1));
    await s.drain();
    expect(ids()).toEqual([['e1']]);
    replies = [429, 500];        // lỗi cả hai lần → bỏ
    s.push(ev(2));
    await s.drain();
    expect(ids()).toEqual([['e1']]);
    s.push(ev(3));               // vẫn hoạt động
    await s.drain();
    expect(ids()).toEqual([['e1'], ['e3']]);
    expect(s.active).toBe(true);
  });

  test('400 / 404 → bỏ lô, không thử lại, không ngừng', async () => {
    const s = new ActivitySender(url, 't', 'NV120');
    replies = [400];
    s.push(ev(1));
    await s.drain();
    replies = [404];
    s.push(ev(2));
    await s.drain();
    expect(replies.length).toBe(0); // mỗi lô đúng 1 request
    s.push(ev(3));
    await s.drain();
    expect(ids()).toEqual([['e3']]);
  });

  test('lỗi mạng (máy chủ không có) không ném lỗi ra ngoài', async () => {
    ActivitySender.retryDelayMs = 10;
    const s = new ActivitySender('http://127.0.0.1:9/mcp', 't', 'NV120');
    s.push(ev(1));
    await s.drain();
    expect(s.pending).toBe(0);
    expect(s.active).toBe(true);
  });

  test('drain chờ tối đa drainMs rồi bỏ phần còn lại', async () => {
    replies = ['hang'];
    const s = new ActivitySender(url, 't', 'NV120');
    s.push(ev(1));
    const t = Date.now();
    await s.drain(150);
    expect(Date.now() - t).toBeLessThan(1_000);
    expect(s.pending).toBe(0);
  });

  test('activity_stream: false → không gửi gì', async () => {
    const s = new ActivitySender(url, 't', 'NV120', false);
    expect(s.active).toBe(false);
    s.push(ev(1));
    await s.drain();
    expect(batches.length).toBe(0);
  });

  test('config: runner.activity_stream mặc định bật, chỉ nhận true / false', () => {
    expect(parseConfig(baseRaw()).activityStream).toBe(true);
    const off = baseRaw() as any; off.runner.activity_stream = false;
    expect(parseConfig(off).activityStream).toBe(false);
    const bad = baseRaw() as any; bad.runner.activity_stream = 'no';
    expect(() => parseConfig(bad)).toThrow(/activity_stream/);
  });
});
