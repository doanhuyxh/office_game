// Test tích hợp cuộc họp agent (TEST-84), KHÔNG cần mạng / OfficeHub thật: MCP giả giữ trạng thái cuộc họp (ai giữ lượt) + CLI agent giả
// "phát biểu" bằng cách gọi điểm điều khiển của MCP giả. Hai agent mode none (không repo / git).
import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '../src/config';
import { MEETING_TURN_MAX_MIN, Runner } from '../src/runner';
import { Store } from '../src/store';

const S = '01a1d500-0000-7000-8000-0000000000aa', ROOM = '01a1d500-0000-7000-8000-0000000000bb';
const P = '01a1cb11-4644-716a-bf4d-8ab17b2f159b', T1 = '01a1ced9-0a22-713a-b89d-cbd02c09c92d';
const TOKENS: Record<string, { id: string; code: string }> = {
  ohk_meeting_secret_agent_120: { id: 'emp-1', code: 'NV120' },
  ohk_meeting_secret_agent_121: { id: 'emp-2', code: 'NV121' },
};
const root = mkdtempSync(join(tmpdir(), 'runner-meeting-'));
const dataDir = join(root, 'data');
let server: ReturnType<typeof Bun.serve>;
let runner: Runner, store: Store;

/** Trạng thái cuộc họp trên "OfficeHub": ai dự, ai giữ lượt; `next` = thứ tự nhận lượt sau mỗi lần nói / bỏ lượt. */
let meeting: { active: boolean; bots: string[]; speaker: string | null; next: (string | null)[] };
let spoken: string[], passes: string[], comments: string[], presence: any[];
const advance = () => { meeting.speaker = meeting.next.shift() ?? null; };

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      // CLI giả "phát biểu": chỉ nhận khi đúng lượt (như Api chặn 409)
      if (url.pathname === '/ctl/speak') {
        const agent = url.searchParams.get('agent')!;
        if (meeting.active && meeting.speaker === agent) { spoken.push(agent); advance(); return new Response('ok'); }
        return new Response('không phải lượt', { status: 409 });
      }
      const who = TOKENS[(req.headers.get('authorization') ?? '').replace('Bearer ', '')];
      if (!who) return new Response(null, { status: 401 });
      if (url.pathname === '/mcp/presence') { presence.push({ agent: who.code, ...(await req.json() as object) }); return new Response(null, { status: 204 }); }
      const m = await req.json() as any;
      const reply = (result: unknown) => Response.json({ jsonrpc: '2.0', id: m.id, result });
      if (m.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: {} });
      const { name, arguments: a } = m.params;
      const text = (o: unknown) => reply({ content: [{ type: 'text', text: JSON.stringify(o) }] });
      if (name === 'get_my_profile') return text({ employee: { id: who.id, code: who.code, fullName: `Bot ${who.code}` } });
      if (name === 'get_my_meeting') {
        if (!meeting.active || !meeting.bots.includes(who.code)) return text({ inMeeting: false });
        return text({ inMeeting: true, sessionId: S, conversation: ROOM, isChair: who.code === 'NV120', isMyTurn: meeting.speaker === who.code });
      }
      if (name === 'pass_turn') {
        if (meeting.speaker !== who.code) return reply({ isError: true, content: [{ type: 'text', text: 'Chưa tới lượt của bạn' }] });
        passes.push(who.code); advance();
        return text({ ok: true });
      }
      if (name === 'get_task') return text({ task: { id: T1, projectId: P, assigneeEmployeeId: who.id, done: false, title: 'Lập báo giá', code: 'TEST-45' }, dependsOn: [] });
      if (name === 'comment_task') { comments.push(a.content); return text({ ok: true }); }
      return reply({ isError: true, content: [{ type: 'text', text: 'tool lạ' }] });
    },
  });

  // CLI giả: ghi tham số + prompt; có file "speak" → phát biểu; có file "slow" → chạy 1 giây
  const bin = join(root, 'fake-agent.sh');
  writeFileSync(bin, `#!/bin/sh
[ "$1" = "--version" ] && { echo "fake 1.0"; exit 0; }
cwd="$3"; prompt="$5"; dir="$(dirname "$prompt")"
echo "$@" > "$dir/args.txt"
cp "$prompt" "$dir/prompt-copy.md"
[ -f "$(dirname "$0")/slow" ] && sleep 1
[ -f "$(dirname "$0")/speak" ] && curl -s -o /dev/null "$FAKE_CTL/speak?agent=$OFFICEHUB_AGENT"
cd "$cwd" || exit 3
echo '{"session_id":"sess-'$OFFICEHUB_AGENT'","model":"fake-model-1","cost_usd":0.05,"summary":"xong"}'
`);
  chmodSync(bin, 0o755);
  const envFile = join(root, 'agent.env');
  writeFileSync(envFile, `FAKE_CTL=http://localhost:${server.port}/ctl\n`);
  const agent = (code: string, n: number) => ({
    employee_code: code, telegram_bot: `@agent_biz0${n}_bot`, telegram_token: `12345678${n}:AAH-meeting-test-token-abcdefghijklmn`,
    token: Object.keys(TOKENS)[n - 1], env_file: envFile, workspace: { mode: 'none' },
    executor: { kind: 'custom', bin, home: join(root, 'home'), timeout_min: 60,
      args: ['run', '--cwd', '{cwd}', '--prompt', '{prompt_file}', '--mcp', '{mcp_config}'], resume_args: ['--session', '{session_id}'], output: { format: 'json' } },
  });
  const config = parseConfig({
    officehub: { mcp_url: `http://localhost:${server.port}/mcp` },
    telegram: { group_chat_id: '-1001234567890' },
    runner: { data_dir: dataDir, worktrees_dir: join(root, 'worktrees'), max_parallel: 2 },
    agents: [agent('NV120', 1), agent('NV121', 2)],
  });
  mkdirSync(dataDir, { recursive: true });
  store = new Store(join(dataDir, 'runner.db'));
  runner = new Runner(config, store);
  const lines = await runner.checkAgents(undefined, false);
  expect(lines.filter((l) => l.startsWith('✘'))).toEqual([]);
});

beforeEach(() => {
  meeting = { active: true, bots: ['NV120', 'NV121'], speaker: 'NV120', next: [] };
  spoken = []; passes = []; comments = []; presence = [];
  for (const f of ['speak', 'slow']) rmSync(join(root, f), { force: true });
  store.db.run(`DELETE FROM jobs`);
  store.db.run(`DELETE FROM task_sessions`);
});

afterAll(() => {
  runner?.stop();
  server?.stop();
  rmSync(root, { recursive: true, force: true });
});

const agentOf = (code: string) => runner.agents.get(code)!;
const turnMsg = (code: string, session = S) => ({
  message_id: 1, date: 0, chat: { id: -1001234567890, type: 'supergroup' },
  text: JSON.stringify({ employee_code: code, event: 'meeting_turn', session_id: session, conversation_id: ROOM }),
}) as any;
const runNext = async () => { const job = store.claimNext(2, ['NV120', 'NV121'])!; await runner.process(job); return store.getJob(job.id)!; };
const file = (job: { id: number }, name: string) => readFileSync(join(dataDir, 'jobs', String(job.id), name), 'utf8');

test('hai agent nói lần lượt: mỗi lượt một phiên ngắn chỉ tool MCP, nối phiên theo cuộc họp, không bình luận / không đổi trạng thái 3D', async () => {
  writeFileSync(join(root, 'speak'), '');
  meeting.next = ['NV121', 'NV120', null];

  // lượt 1: chủ trì NV120
  expect(await runner.onMessage(agentOf('NV121'), turnMsg('NV120'))).toBeNull(); // tin của agent khác → bỏ
  expect(await runner.onMessage(agentOf('NV121'), turnMsg('NV121'))).toBeNull(); // chưa tới lượt NV121
  const id = await runner.onMessage(agentOf('NV120'), turnMsg('NV120'));
  expect(id).not.toBeNull();
  const first = await runNext();
  expect(first).toMatchObject({ id: id!, agent: 'NV120', kind: 'meeting', status: 'done', task_id: `NV120:${S}`, cost_usd: 0.05 });
  expect(spoken).toEqual(['NV120']);
  expect(file(first, 'args.txt')).toContain(join(dataDir, 'work/NV120', `meeting-${S}`));
  expect(file(first, 'args.txt')).not.toContain('--session');
  const prompt = file(first, 'prompt-copy.md');
  for (const r of ['get_my_meeting', 'speak_in_meeting', 'pass_turn', 'get_my_role', S]) expect(prompt).toContain(r);
  expect(prompt).not.toContain('NỐI TIẾP');

  // lượt 2: NV121; lượt 3: NV120 nối phiên cũ của chính cuộc họp này
  await runner.onMessage(agentOf('NV121'), turnMsg('NV121'));
  expect(await runNext()).toMatchObject({ agent: 'NV121', task_id: `NV121:${S}`, status: 'done' }); // khoá riêng từng agent: không giẫm job / phiên của NV120
  await runner.onMessage(agentOf('NV120'), turnMsg('NV120'));
  const third = await runNext();
  expect(spoken).toEqual(['NV120', 'NV121', 'NV120']);
  expect(file(third, 'args.txt')).toContain('--session sess-NV120');
  expect(file(third, 'prompt-copy.md')).toContain('NỐI TIẾP');

  expect(passes).toEqual([]); // ai cũng dùng lượt của mình → runner không bỏ lượt thay
  expect(comments).toEqual([]);
  await Bun.sleep(200);
  expect(presence.some((p) => p.state === 'working')).toBe(false);
  expect(store.costsByKind('2000-01-01')).toEqual([{ kind: 'meeting', jobs: 3, cost: 0.15000000000000002 }]);
}, 30000);

test('agent không nói trong lượt → runner bỏ lượt thay; lượt đã qua / họp đã dừng → bỏ job, không gọi CLI', async () => {
  // CLI chạy xong mà không phát biểu (không có file speak)
  meeting.next = ['NV121'];
  await runner.onMessage(agentOf('NV120'), turnMsg('NV120'));
  const job = await runNext();
  expect(job.status).toBe('done');
  expect(spoken).toEqual([]);
  expect(passes).toEqual(['NV120']);
  expect(meeting.speaker).toBe('NV121');

  // lượt hết hạn trước khi job tới lượt chạy
  await runner.onMessage(agentOf('NV121'), turnMsg('NV121'));
  meeting.speaker = 'NV120';
  const late = await runNext();
  expect(late).toMatchObject({ status: 'skipped', reason: 'không phải lượt của agent' });
  expect(existsSync(join(dataDir, 'jobs', String(late.id), 'args.txt'))).toBe(false);
  expect(passes).toEqual(['NV120']); // không bỏ lượt của người khác

  // người thật đã dừng họp / tin của phiên khác
  expect(await runner.onMessage(agentOf('NV120'), turnMsg('NV120', '01a1d500-0000-7000-8000-0000000000ff'))).toBeNull();
  meeting.active = false;
  expect(await runner.onMessage(agentOf('NV120'), turnMsg('NV120'))).toBeNull();
});

test('một lượt họp tối đa 2,5 phút dù executor.timeout_min dài hơn; job họp được lấy trước job khác', () => {
  expect(MEETING_TURN_MAX_MIN).toBeLessThan(3); // hạn nói của OfficeHub là 3 phút
  const t = store.enqueue('NV120', T1, 'TEST-45', P)!;
  const m = store.enqueue('NV120', `NV120:${S}`, 'meeting:x', '', 'meeting')!;
  expect(store.enqueue('NV121', `NV121:${S}`, 'meeting:x', '', 'meeting')).not.toBeNull(); // bot khác cùng cuộc họp có job riêng
  store.db.run(`DELETE FROM jobs WHERE agent = 'NV121'`);
  expect(store.claimNext(2, ['NV120'])!.id).toBe(m);
  expect(store.claimNext(2, ['NV120'])).toBeNull(); // mỗi agent một phiên
  store.finish(m, 'done');
  expect(store.claimNext(2, ['NV120'])!.id).toBe(t);
});

test('đang họp thì không chạy việc: job việc hoãn tới khi cuộc họp kết thúc', async () => {
  meeting.speaker = 'NV121'; // NV120 dự họp nhưng chưa tới lượt
  const id = (await runner.accept(agentOf('NV120'), { employee_code: 'NV120', project_id: P, task_id: T1, task_code: 'TEST-45' }))!;
  const held = await runNext();
  expect(held).toMatchObject({ id, status: 'queued', reason: 'agent đang họp — chờ hết cuộc họp' });
  expect(Date.parse(held.not_before!)).toBeGreaterThan(Date.now() + 20_000);
  expect(existsSync(join(dataDir, 'jobs', String(id), 'args.txt'))).toBe(false); // CLI chưa chạy
  expect(store.claimNext(2, ['NV120', 'NV121'])).toBeNull(); // chưa tới giờ kiểm tra lại
  await Bun.sleep(200);
  expect(presence.some((p) => p.state === 'working')).toBe(false);

  // tới lượt NV120 trong lúc việc đang hoãn → lượt họp vẫn chạy
  writeFileSync(join(root, 'speak'), '');
  meeting.speaker = 'NV120';
  await runner.onMessage(agentOf('NV120'), turnMsg('NV120'));
  expect((await runNext()).kind).toBe('meeting');
  expect(spoken).toEqual(['NV120']);

  // hết họp → tới nhịp kiểm tra lại thì việc chạy bình thường
  meeting.active = false;
  store.db.run(`UPDATE jobs SET not_before = ? WHERE id = ?`, [new Date(Date.now() - 1000).toISOString(), id]);
  const done = await runNext();
  expect(done).toMatchObject({ id, status: 'done', kind: 'task' });
  expect(comments.length).toBe(1);
}, 30000);

test('agent đang chạy job việc mà tới lượt họp → runner bỏ lượt ngay, không xếp hàng', async () => {
  meeting.active = false; // việc bắt đầu khi chưa có cuộc họp
  writeFileSync(join(root, 'slow'), '');
  await runner.accept(agentOf('NV120'), { employee_code: 'NV120', project_id: P, task_id: T1, task_code: 'TEST-45' });
  const job = store.claimNext(2, ['NV120'])!;
  const running = runner.process(job);
  await Bun.sleep(300);
  meeting = { active: true, bots: ['NV120', 'NV121'], speaker: 'NV120', next: ['NV121'] }; // người thật mở họp, NV120 chủ trì
  expect(await runner.onMessage(agentOf('NV120'), turnMsg('NV120'))).toBeNull();
  expect(passes).toEqual(['NV120']);
  expect(meeting.speaker).toBe('NV121');
  expect(store.db.query<any, []>(`SELECT COUNT(*) n FROM jobs WHERE kind = 'meeting'`).get()!.n).toBe(0);
  await running;
  expect(store.getJob(job.id)!.status).toBe('done'); // việc đang làm không bị ngắt
}, 30000);

test('lượt mới tới khi job họp của cùng phiên đang chạy → xong thì xếp thêm một job (không bỏ lượt mới)', async () => {
  writeFileSync(join(root, 'speak'), '');
  writeFileSync(join(root, 'slow'), '');
  meeting.next = ['NV120', null]; // nói xong lượt lại quay về NV120 (vd chủ trì, không ai chờ)
  const id = (await runner.acceptMeeting(agentOf('NV120'), { employee_code: 'NV120', session_id: S, conversation_id: ROOM }))!;
  const job = store.claimNext(2, ['NV120'])!;
  const running = runner.process(job);
  await Bun.sleep(300);
  expect(await runner.acceptMeeting(agentOf('NV120'), { employee_code: 'NV120', session_id: S, conversation_id: ROOM })).toBeNull();
  expect(store.getJob(id)!.rerun).toBe(1);
  await running;
  expect(spoken).toEqual(['NV120']);
  expect(passes).toEqual([]); // lượt mới không bị runner bỏ
  const next = store.db.query<any, [string]>(`SELECT * FROM jobs WHERE task_id = ? AND status = 'queued'`).get(`NV120:${S}`);
  expect(next?.kind).toBe('meeting');
}, 30000);
