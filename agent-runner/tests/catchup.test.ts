// Bắt bù lúc khởi động (TEST-158): Runner.catchUp với MCP giả — chỉ khâu xếp hàng, không chạy CLI (luồng start → chạy job ở flow.test.ts).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '../src/config';
import { STARTUP_CATCHUP_MAX, STARTUP_RECENT_JOB_MIN } from '../src/policy';
import { Runner } from '../src/runner';
import { Store } from '../src/store';
import { baseRaw } from './fixtures/config';

const P = '01a1cb11-4644-716a-bf4d-8ab17b2f159b';
const id = (n: number) => `01a1ced9-0a22-713a-b89d-${String(n).padStart(12, '0')}`;
const row = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(n),
  projectId: P,
  code: `TEST-${n}`,
  waitingOn: 0,
  awaitingHuman: false,
  projectActive: true,
  ...over,
});

const root = mkdtempSync(join(tmpdir(), 'runner-catchup-'));
/** Kết quả `list_my_tasks` của MCP giả; null = tool báo lỗi. */
let mine: unknown[] | null = [];
/** `get_task` của việc: mặc định vẫn giao cho agent; ghi đè theo id để giả việc vừa bị giao người khác. */
const taskOver: Record<string, Record<string, unknown>> = {};
const calls: string[] = [];
let mcp: ReturnType<typeof Bun.serve>;
let n = 0;

beforeAll(() => {
  mcp = Bun.serve({
    port: 0,
    async fetch(req) {
      const m = (await req.json()) as any;
      const reply = (result: unknown) => Response.json({ jsonrpc: '2.0', id: m.id, result });
      if (m.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: {} });
      const { name, arguments: a } = m.params;
      calls.push(name);
      const text = (o: unknown) => reply({ content: [{ type: 'text', text: JSON.stringify(o) }] });
      if (name === 'list_my_tasks')
        return mine ? text(mine) : reply({ isError: true, content: [{ type: 'text', text: 'tool lạ' }] });
      if (name === 'get_task') {
        const t = (mine ?? []).find((x: any) => x?.id === a.task) as any;
        return text({
          task: {
            id: a.task,
            projectId: P,
            code: t?.code,
            title: 'Việc',
            assigneeEmployeeId: 'emp-1',
            done: false,
            ...taskOver[a.task],
          },
          dependsOn: [],
        });
      }
      return reply({ isError: true, content: [{ type: 'text', text: 'tool lạ' }] });
    },
  });
});

afterAll(() => {
  mcp.stop();
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  mine = [];
  calls.length = 0;
  for (const k of Object.keys(taskOver)) delete taskOver[k];
});

/** Runner + runner.db mới, agent NV120 coi như đã qua `doctor`. */
function setup() {
  const raw = baseRaw();
  raw.officehub.mcp_url = `http://localhost:${mcp.port}/mcp`;
  raw.runner.data_dir = join(root, `data-${++n}`);
  const config = parseConfig(raw);
  const store = new Store(':memory:');
  const runner = new Runner(config, store);
  const s = runner.agents.get('NV120')!;
  s.enabled = true;
  s.employeeId = 'emp-1';
  const queued = () =>
    store.db
      .query<{ label: string }, []>(`SELECT task_code AS label FROM jobs WHERE status = 'queued' ORDER BY id`)
      .all()
      .map((j) => j.label);
  return { runner, store, s, queued };
}

describe('Runner.catchUp', () => {
  test('xếp hàng việc cần làm theo thứ tự hạn; bỏ việc chờ người / chờ việc khác / dự án không chạy', async () => {
    const { runner, s, queued, store } = setup();
    mine = [
      row(7),
      row(1, { awaitingHuman: true }),
      row(2, { waitingOn: 1 }),
      row(3, { projectActive: false }),
      row(5),
    ];
    expect(await runner.catchUp(s)).toBe(2);
    expect(queued()).toEqual(['TEST-7', 'TEST-5']);
    const job = store.claimNext(1, ['NV120'])!;
    expect(job).toMatchObject({ agent: 'NV120', key: id(7), label: 'TEST-7', project_id: P, kind: 'task' });
    expect(calls.filter((c) => c === 'get_task').length).toBe(2); // chỉ hỏi lại việc được chọn
  });

  test('việc đã có job chờ (tin Telegram tồn / job dở được đưa lại) → gộp, không tạo job thứ hai; chạy lại lần nữa cũng không', async () => {
    const { runner, s, queued, store } = setup();
    mine = [row(1), row(2)];
    store.enqueue('NV120', id(1), 'TEST-1', P, 'task');
    expect(await runner.catchUp(s)).toBe(1);
    expect(await runner.catchUp(s)).toBe(0);
    expect(queued()).toEqual(['TEST-1', 'TEST-2']);
  });

  test(`việc có job vừa kết thúc trong ${STARTUP_RECENT_JOB_MIN} phút → bỏ qua; job kết thúc lâu hơn thì xếp lại`, async () => {
    const { runner, s, queued, store } = setup();
    mine = [row(1), row(2)];
    for (const k of [1, 2]) {
      store.enqueue('NV120', id(k), `TEST-${k}`, P, 'task');
      store.finish(store.claimNext(5, ['NV120'])!.id, 'done', {});
    }
    const old = new Date(Date.now() - (STARTUP_RECENT_JOB_MIN + 1) * 60_000).toISOString();
    store.db.run(`UPDATE jobs SET finished_at = ? WHERE task_id = ?`, [old, id(2)]);
    expect(await runner.catchUp(s)).toBe(1);
    expect(queued()).toEqual(['TEST-2']);
    expect(calls.filter((c) => c === 'get_task').length).toBe(1);
  });

  test(`quá ${STARTUP_CATCHUP_MAX} việc → chỉ xếp ${STARTUP_CATCHUP_MAX} việc đầu`, async () => {
    const { runner, s, queued } = setup();
    mine = Array.from({ length: STARTUP_CATCHUP_MAX + 5 }, (_, i) => row(i + 1));
    expect(await runner.catchUp(s)).toBe(STARTUP_CATCHUP_MAX);
    expect(queued().at(-1)).toBe(`TEST-${STARTUP_CATCHUP_MAX}`);
  });

  test('get_task không cho chạy (việc vừa giao người khác) → không xếp việc đó', async () => {
    const { runner, s, queued } = setup();
    mine = [row(1), row(2)];
    taskOver[id(1)] = { assigneeEmployeeId: 'emp-khac' };
    expect(await runner.catchUp(s)).toBe(1);
    expect(queued()).toEqual(['TEST-2']);
  });

  test('OfficeHub bản cũ (không có awaitingHuman) hoặc tool lỗi → không xếp gì, không ném lỗi', async () => {
    const { runner, s, queued } = setup();
    mine = [{ id: id(1), projectId: P, code: 'TEST-1', waitingOn: 0 }];
    expect(await runner.catchUp(s)).toBeNull();
    mine = null;
    expect(await runner.catchUp(s)).toBeNull();
    expect(queued()).toEqual([]);
    expect(calls).not.toContain('get_task');
  });

  test('runner đã dừng → không xếp thêm', async () => {
    const { runner, s, queued } = setup();
    mine = [row(1), row(2)];
    runner.stop();
    expect(await runner.catchUp(s)).toBe(0);
    expect(queued()).toEqual([]);
  });
});

test('config: runner.startup_catchup mặc định bật, chỉ nhận true / false', () => {
  expect(parseConfig(baseRaw()).startupCatchup).toBe(true);
  const off: any = baseRaw();
  off.runner.startup_catchup = false;
  expect(parseConfig(off).startupCatchup).toBe(false);
  const bad: any = baseRaw();
  bad.runner.startup_catchup = 'no';
  expect(() => parseConfig(bad)).toThrow(/startup_catchup/);
});
