// TEST-135: gửi mức dùng AI (chi phí / token mỗi phiên) lên OfficeHub — dựng phiên theo hợp đồng AiUsageSession, đánh dấu đã gửi,
// gửi lại / tách lô / ngừng theo mã lỗi, job cũ chỉ gửi bằng `usage push`. Máy chủ giả: Bun.serve upsert theo sourceId.
import { Database } from 'bun:sqlite';
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { kindReportLines } from '../src/report';
import { Store, type Job, type JobResult } from '../src/store';
import { sourceHost, splitInput, UsageReporter, usageSession, usageUrl, type AiUsageSession } from '../src/usage';

const root = mkdtempSync(join(tmpdir(), 'runner-usage-'));
afterAll(() => {
  server.stop();
  rmSync(root, { recursive: true, force: true });
});

const P = '01a1cb11-4644-716a-bf4d-8ab17b2f159b',
  T = '01a1ced9-0a22-713a-b89d-cbd02c09c92d';
const TOKEN = 'ohk_usage_test_token';

/** Máy chủ giả: `mode` quyết định phản hồi; phiên có costUsd = 13.13 bị coi là sai (400 cho cả lô chứa nó). */
let mode: 'ok' | '404' | '401' | '500' = 'ok';
const requests: AiUsageSession[][] = [];
const saved = new Map<string, AiUsageSession>();
let authOk = true;
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    if (new URL(req.url).pathname !== '/mcp/usage') return new Response('not found', { status: 404 });
    if (req.headers.get('authorization') !== `Bearer ${TOKEN}`) authOk = false;
    const body = (await req.json()) as { sessions: AiUsageSession[] };
    requests.push(body.sessions);
    if (mode === '404') return new Response('Not Found', { status: 404 });
    if (mode === '401') return new Response(null, { status: 401 });
    if (mode === '500') return Response.json({ detail: 'lỗi' }, { status: 503 });
    if (body.sessions.some((s) => s.costUsd === 13.13))
      return Response.json({ title: 'Bad Request', detail: 'sessions[0].costUsd: không hợp lệ' }, { status: 400 });
    let created = 0,
      updated = 0;
    for (const s of body.sessions) {
      if (saved.has(s.sourceId)) updated++;
      else created++;
      saved.set(s.sourceId, s);
    }
    return Response.json({ accepted: body.sessions.length, created, updated });
  },
});
const mcpUrl = `http://localhost:${server.port}/mcp`;

let store: Store;
let n = 0;
beforeEach(() => {
  store = new Store(join(root, `runner-${++n}.db`));
  mode = 'ok';
  requests.length = 0;
  saved.clear();
});

/** Thêm một job đã chạy xong (như finishJob). */
function doneJob(
  agent: string,
  f: JobResult & { kind?: 'task' | 'chat' | 'meeting'; status?: 'done' | 'failed'; key?: string; code?: string } = {},
): Job {
  const id = store.enqueue(agent, f.key ?? `${T}-${Math.random()}`, f.code ?? 'TEST-45', P, f.kind ?? 'task')!;
  store.claimNext(10, [agent]);
  store.finish(id, f.status ?? 'done', { cli_ran: 1, executor: 'claude', ...f });
  return store.getJob(id)!;
}

const reporter = (agent = 'NV120') =>
  new UsageReporter(mcpUrl, TOKEN, agent, store, { host: 'may-1', dbId: store.dbId(), executor: 'claude' });

describe('dựng phiên', () => {
  test('việc: token vào = tổng − cache, mỗi model một dòng, id việc / dự án / mã việc', () => {
    const job = doneJob('NV120', {
      key: T,
      cost_usd: 0.8123,
      turns: 17,
      input_tokens: 44200,
      output_tokens: 5300,
      cache_read_tokens: 40000,
      cache_write_tokens: 3000,
      model: 'claude-sonnet-5-5',
      model_usage: JSON.stringify({
        'claude-sonnet-5-5': {
          costUsd: 0.8,
          inputTokens: 44100,
          outputTokens: 5000,
          cacheReadTokens: 40000,
          cacheWriteTokens: 3000,
        },
        'claude-haiku-5-5': {
          costUsd: 0.0123,
          inputTokens: 100,
          outputTokens: 300,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      }),
    });
    const s = usageSession(job, 'may-1', 'abcd1234');
    expect(s).toMatchObject({
      sourceId: `may-1:abcd1234:NV120:${job.id}`,
      kind: 'task',
      taskId: T,
      projectId: P,
      taskCode: 'TEST-45',
      executor: 'claude',
      status: 'done',
      turns: 17,
      costUsd: 0.8123,
    });
    expect(s.startedAt).toBe(job.started_at!);
    expect(s.finishedAt).toBe(job.finished_at!);
    expect(s.models).toEqual([
      {
        model: 'claude-sonnet-5-5',
        inputTokens: 1100,
        outputTokens: 5000,
        cacheReadTokens: 40000,
        cacheWriteTokens: 3000,
        costUsd: 0.8,
      },
      {
        model: 'claude-haiku-5-5',
        inputTokens: 100,
        outputTokens: 300,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.0123,
      },
    ]);
  });

  test('chat / họp: không có id / mã việc (khoá job là <mã NV>:<id>, task_code là nhãn log)', () => {
    const chat = usageSession(doneJob('NV120', { kind: 'chat', key: 'NV120:conv-1', code: 'chat:conv-1' }), 'h', 'd');
    expect(chat.kind).toBe('chat');
    expect(chat.taskId).toBeUndefined();
    expect(chat.taskCode).toBeUndefined();
    expect(
      usageSession(
        doneJob('NV120', { kind: 'meeting', key: 'NV120:s-1', code: 'meeting:s-1', status: 'failed' }),
        'h',
        'd',
      ),
    ).toMatchObject({ kind: 'meeting', status: 'failed' });
  });

  test('không biết → null, không phải 0; model cấu hình bỏ hậu tố; job cũ không có cache → token vào = tổng', () => {
    // CLI tự khai báo không báo chi phí / token, chỉ có model cấu hình
    const custom = usageSession(doneJob('NV120', { model: 'my-model (cấu hình)', executor: 'custom' }), 'h', 'd');
    expect(custom.costUsd).toBeNull();
    expect(custom.turns).toBeNull();
    expect(custom.models).toEqual([
      {
        model: 'my-model',
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        costUsd: null,
      },
    ]);
    // Không rõ model → không gửi models (máy chủ ghi "không rõ")
    expect(usageSession(doneJob('NV120', { cost_usd: 0.1 }), 'h', 'd').models).toBeUndefined();
    // model_usage của job trước TEST-135: inputTokens đã gộp cache, không có trường cache
    const legacy = usageSession(
      doneJob('NV120', { model_usage: JSON.stringify({ m: { costUsd: 0.2, inputTokens: 900, outputTokens: 10 } }) }),
      'h',
      'd',
    );
    expect(legacy.models).toEqual([
      { model: 'm', inputTokens: 900, outputTokens: 10, cacheReadTokens: null, cacheWriteTokens: null, costUsd: 0.2 },
    ]);
    // executor của job cũ lấy từ cấu hình agent
    expect(usageSession({ ...doneJob('NV120'), executor: null }, 'h', 'd', 'claude').executor).toBe('claude');
    expect(splitInput(100, 30, null)).toEqual({ inputTokens: 70, cacheReadTokens: 30, cacheWriteTokens: null });
    expect(splitInput(null, null, null)).toEqual({ inputTokens: null, cacheReadTokens: null, cacheWriteTokens: null });
  });

  test('sourceId: tên máy bỏ dấu ":", mã runner.db khác nhau giữa hai DB (máy bị xoá không ghi đè phiên cũ)', () => {
    expect(sourceHost('a:b c')).toBe('a-b-c');
    expect(sourceHost('x'.repeat(80)).length).toBe(40);
    const other = new Store(join(root, 'other.db'));
    expect(store.dbId()).toMatch(/^[0-9a-f]{8}$/);
    expect(store.dbId()).toBe(store.dbId()); // cố định
    expect(other.dbId()).not.toBe(store.dbId());
    expect(usageUrl('http://h/mcp/')).toBe('http://h/mcp/usage');
  });
});

describe('gửi', () => {
  test('gửi phiên chưa gửi, đánh dấu đã gửi; lần sau không gửi lại; lô ≤ 50', async () => {
    for (let i = 0; i < 120; i++) doneJob('NV120', { cost_usd: 0.01 });
    doneJob('NV121'); // agent khác — bộ gửi riêng
    const r = reporter();
    expect(await r.flush()).toEqual({ sent: 120, rejected: 0, stopped: undefined });
    expect(requests.map((x) => x.length)).toEqual([50, 50, 20]);
    expect(authOk).toBe(true);
    expect(store.pendingUsage('NV120')).toEqual([]);
    expect(store.pendingUsage('NV121').length).toBe(1);
    requests.length = 0;
    expect((await r.flush()).sent).toBe(0);
    expect(requests.length).toBe(0);
  });

  test('gọi flush chồng nhau (nhiều phiên xong cùng lúc) → không gửi trùng', async () => {
    for (let i = 0; i < 5; i++) doneJob('NV120');
    const r = reporter();
    const a = r.flush();
    doneJob('NV120'); // phiên xong trong lúc đang gửi → lượt sau gửi nốt
    await Promise.all([a, r.flush(), r.flush()]);
    expect(requests.flat().length).toBe(6);
    expect(new Set(requests.flat().map((s) => s.sourceId)).size).toBe(6);
  });

  test('400: tách lô, chỉ bỏ phiên sai (ghi usage_error); runner không tự gửi lại, usage push thử lại', async () => {
    doneJob('NV120');
    const bad = doneJob('NV120', { cost_usd: 13.13 });
    doneJob('NV120');
    const r = reporter();
    expect(await r.flush()).toMatchObject({ sent: 2, rejected: 1 });
    expect(store.getJob(bad.id)!.usage_error).toContain('400');
    expect(store.getJob(bad.id)!.usage_sent_at).toBeNull();
    requests.length = 0;
    expect((await r.flush()).sent).toBe(0); // runner không gửi lại phiên bị từ chối
    expect(requests.length).toBe(0);
    expect(await r.flush({ all: true })).toMatchObject({ sent: 0, rejected: 1 }); // usage push: thử lại (vẫn sai) — không lặp mãi
    expect(requests.length).toBe(1);
  });

  test('404 (máy chủ chưa có bản mới) / 5xx: giữ phiên, thử lại sau thì gửi được', async () => {
    doneJob('NV120');
    const r = reporter();
    mode = '404';
    expect((await r.flush()).stopped).toBe('status=404');
    mode = '500';
    expect((await r.flush()).stopped).toContain('503');
    expect(store.pendingUsage('NV120').length).toBe(1);
    mode = 'ok';
    expect((await r.flush()).sent).toBe(1);
  });

  test('401 / 403: ngừng gửi cho agent đó', async () => {
    doneJob('NV120');
    const r = reporter();
    mode = '401';
    expect((await r.flush()).stopped).toContain('401');
    expect(r.isDisabled).toBe(true);
    mode = 'ok';
    requests.length = 0;
    expect((await r.flush()).sent).toBe(0);
    expect(requests.length).toBe(0);
    expect(store.pendingUsage('NV120').length).toBe(1);
  });

  test('job không chạy CLI (bỏ qua / lỗi trước khi chạy) không gửi', async () => {
    const id = store.enqueue('NV120', T, 'TEST-45', P)!;
    store.claimNext(1, ['NV120']);
    store.finish(id, 'skipped', { reason: 'việc đã xong' });
    expect((await reporter().flush()).sent).toBe(0);
  });

  test('gửi lại (usage push chạy hai lần) không tạo trùng — máy chủ upsert theo sourceId', async () => {
    const job = doneJob('NV120', { cost_usd: 0.5 });
    await reporter().flush();
    store.db.run(`UPDATE jobs SET usage_sent_at = NULL WHERE id = ?`, [job.id]);
    await reporter().flush({ all: true });
    expect(requests.length).toBe(2);
    expect(saved.size).toBe(1);
  });
});

describe('report theo loại (TEST-139)', () => {
  test('token vào không cache / ghi / đọc cache / ra, tỉ lệ đọc cache chỉ trên phiên có báo cache, chi phí trung bình trên phiên có chi phí', () => {
    // việc: 1 phiên có cache (tổng 44200 = 1200 + 3000 + 40000), 1 phiên CLI không báo cache (tổng 1000), 1 phiên không có chi phí
    doneJob('NV120', {
      cost_usd: 0.8,
      input_tokens: 44200,
      output_tokens: 5300,
      cache_read_tokens: 40000,
      cache_write_tokens: 3000,
    });
    doneJob('NV120', { cost_usd: 0.2, input_tokens: 1000, output_tokens: 100 });
    doneJob('NV120');
    doneJob('NV120', {
      kind: 'chat',
      key: 'NV120:c',
      code: 'chat:c',
      cost_usd: 0.05,
      input_tokens: 10000,
      output_tokens: 50,
      cache_read_tokens: 9000,
      cache_write_tokens: 0,
    });
    const rows = store.costsByKind('2000-01-01');
    expect(rows.find((r) => r.kind === 'task')).toMatchObject({
      jobs: 3,
      costed: 2,
      input: 45200,
      cache_read: 40000,
      cache_write: 3000,
      input_with_cache: 44200,
    });
    const lines = kindReportLines(rows);
    expect(lines).toEqual([
      'chat\t1 phiên\t$0.05 ($0.050 / phiên)\tvào 1,000 · ghi cache 0 · đọc cache 9,000 · ra 50\tđọc cache 90%',
      'việc\t3 phiên\t$1.00 ($0.500 / phiên)\tvào 2,200 · ghi cache 3,000 · đọc cache 40,000 · ra 5,400\tđọc cache 90%',
    ]);
    // Không phiên nào báo cache / không có chi phí
    expect(
      kindReportLines([
        {
          kind: 'meeting',
          jobs: 2,
          cost: null,
          costed: 0,
          input: 500,
          output: 9,
          cache_read: null,
          cache_write: null,
          input_with_cache: null,
        },
      ]),
    ).toEqual(['họp\t2 phiên\t$0.00 (chi phí không rõ)\tvào 500 · ghi cache 0 · đọc cache 0 · ra 9\tđọc cache —']);
  });
});

describe('runner.db cũ (trước TEST-135)', () => {
  test('job cũ đã chạy CLI → cli_ran = 2: runner không tự gửi, usage push (all) gửi; --since lọc theo ngày xong', async () => {
    const path = join(root, 'legacy.db');
    const db = new Database(path, { create: true });
    db.exec(`CREATE TABLE jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT NOT NULL, task_id TEXT NOT NULL, task_code TEXT NOT NULL, project_id TEXT NOT NULL,
      status TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
      session_id TEXT, cost_usd REAL, input_tokens INTEGER, output_tokens INTEGER, turns INTEGER, pr_url TEXT, model TEXT, model_usage TEXT,
      kind TEXT, rerun INTEGER, not_before TEXT)`);
    const ins =
      db.prepare(`INSERT INTO jobs (agent, task_id, task_code, project_id, status, created_at, started_at, finished_at, session_id, cost_usd, model)
      VALUES ('NV120', ?, 'TEST-1', ?, ?, ?, ?, ?, ?, ?, ?)`);
    ins.run(
      T,
      P,
      'done',
      '2026-10-20T01:00:00.000Z',
      '2026-10-20T01:00:00.000Z',
      '2026-10-20T02:00:00.000Z',
      's1',
      0.3,
      'claude-opus-5-5',
    );
    ins.run(
      T,
      P,
      'failed',
      '2026-11-05T01:00:00.000Z',
      '2026-11-05T01:00:00.000Z',
      '2026-11-05T01:30:00.000Z',
      null,
      1.2,
      null,
    );
    ins.run(
      T,
      P,
      'skipped',
      '2026-11-06T01:00:00.000Z',
      '2026-11-06T01:00:00.000Z',
      '2026-11-06T01:00:01.000Z',
      null,
      null,
      null,
    ); // không chạy CLI
    db.close();
    store = new Store(path);
    expect(
      store.db
        .query<{ cli_ran: number | null }, []>(`SELECT cli_ran FROM jobs ORDER BY id`)
        .all()
        .map((r) => r.cli_ran),
    ).toEqual([2, 2, null]);
    expect(store.pendingUsage('NV120')).toEqual([]); // runner tự gửi: bỏ qua job cũ
    expect(store.pendingUsageAgents()).toEqual([{ agent: 'NV120', n: 2 }]);
    const since = new Date('2026-11-01T00:00:00+07:00').toISOString();
    expect(store.pendingUsage('NV120', { all: true, sinceIso: since }).map((j) => j.status)).toEqual(['failed']);
    expect(await reporter().flush({ all: true })).toMatchObject({ sent: 2, rejected: 0 });
    expect(requests.flat().map((s) => [s.status, s.costUsd, s.models?.[0]?.model ?? null])).toEqual([
      ['done', 0.3, 'claude-opus-5-5'],
      ['failed', 1.2, null],
    ]);
    // Mở lại DB đã nâng cấp: không đánh dấu lại
    store = new Store(path);
    expect(store.pendingUsageAgents()).toEqual([]);
  });
});
