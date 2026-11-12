// Test tích hợp cả luồng, KHÔNG cần mạng / OfficeHub / Telegram thật:
// Telegram giả + MCP giả (Bun.serve) + CLI agent giả (script sh, adapter custom) + repo git có origin là repo bare tạm.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '../src/config';
import { Runner } from '../src/runner';
import { Store } from '../src/store';
import { sh } from '../src/workspace';

const P = '01a1cb11-4644-716a-bf4d-8ab17b2f159b';
const T1 = '01a1ced9-0a22-713a-b89d-cbd02c09c92d', T2 = '01a1ced9-3468-7c5f-a773-f45aea6d3732';
const TOKEN = 'ohk_flowtest_secret_123456', TG = '123456789:AAH-flow-test-token-abcdefghijklmnop';
const root = mkdtempSync(join(tmpdir(), 'runner-flow-'));
const comments: { task: string; content: string }[] = [];
let authOk = true;
let updatesServed = false;
const servers: { stop: () => void }[] = [];
let runner: Runner;
let store: Store;

const tasks: Record<string, any> = {
  [T1]: { task: { id: T1, projectId: P, assigneeEmployeeId: 'emp-1', done: false, title: 'Sửa nút lưu', code: 'TEST-45' }, dependsOn: [] },
  [T2]: { task: { id: T2, projectId: P, assigneeEmployeeId: 'emp-1', done: false, title: 'Việc chạm runner', code: 'TEST-46' }, dependsOn: [] },
  'TEST-45': null,
};

const run = async (cmd: string[], cwd: string) => {
  const r = await sh(cmd, cwd, { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } as any);
  if (r.code !== 0) throw new Error(`${cmd.join(' ')}: ${r.err}`);
  return r.out;
};

beforeAll(async () => {
  // repo: origin bare + bản clone của agent
  const origin = join(root, 'origin.git'), seed = join(root, 'seed'), repo = join(root, 'agent-repo');
  await run(['git', 'init', '--bare', '-b', 'main', origin], root);
  await run(['git', 'init', '-b', 'main', seed], root);
  writeFileSync(join(seed, 'AGENTS.md'), '# luật\n');
  await run(['git', 'add', '.'], seed);
  await run(['git', 'commit', '-m', 'init'], seed);
  await run(['git', 'remote', 'add', 'origin', origin], seed);
  await run(['git', 'push', 'origin', 'main'], seed);
  await run(['git', 'clone', origin, repo], root);

  // MCP giả
  const mcp = Bun.serve({
    port: 0,
    async fetch(req) {
      if (req.headers.get('authorization') !== `Bearer ${TOKEN}`) authOk = false;
      const m = await req.json() as any;
      const reply = (result: unknown) => Response.json({ jsonrpc: '2.0', id: m.id, result });
      if (m.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: {} });
      const { name, arguments: a } = m.params;
      const text = (o: unknown) => reply({ content: [{ type: 'text', text: JSON.stringify(o) }] });
      if (name === 'get_my_profile') return text({ employee: { id: 'emp-1', code: 'NV120', fullName: 'Bot Thử' } });
      if (name === 'get_task') return text(tasks[a.task] ?? tasks[T1]);
      if (name === 'comment_task') { comments.push({ task: a.task, content: a.content }); return text({ ok: true }); }
      return reply({ isError: true, content: [{ type: 'text', text: 'tool lạ' }] });
    },
  });
  // Telegram giả: lần đầu trả 2 tin (1 hợp lệ, 1 người thật giả mạo), sau đó trả rỗng
  const tg = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (!path.startsWith(`/bot${TG}/`)) return Response.json({ ok: false, description: 'Unauthorized' }, { status: 401 });
      if (path.endsWith('/getMe')) return Response.json({ ok: true, result: { id: 1, is_bot: true, username: 'Agent_Dev01_Bot' } });
      if (path.endsWith('/getUpdates')) {
        if (updatesServed) { await Bun.sleep(300); return Response.json({ ok: true, result: [] }); }
        updatesServed = true;
        const text = `@agent_dev01_bot\n{"employee_code":"NV120","project_id":"${P}","task_id":"${T1}","task_code":"TEST-45"}`;
        return Response.json({ ok: true, result: [
          { update_id: 10, message: { message_id: 1, date: 0, chat: { id: -1001234567890, type: 'supergroup' }, from: { id: 5, is_bot: false, username: 'hacker' }, text } },
          { update_id: 11, message: { message_id: 2, date: 0, chat: { id: -1001234567890, type: 'supergroup' }, from: { id: 9, is_bot: true, username: 'officehub_notify_bot' }, text } },
        ] });
      }
      return Response.json({ ok: false }, { status: 404 });
    },
  });
  servers.push(mcp, tg);

  // CLI agent giả: ghi tham số + kiểm tra env, commit một file (TEST-46: sửa agent-runner/), in dòng JSON kết quả
  const bin = join(root, 'fake-agent.sh');
  writeFileSync(bin, `#!/bin/sh
[ "$1" = "--version" ] && { echo "fake-agent 1.0"; exit 0; }
cwd="$3"; prompt="$5"; mcp="$7"
echo "$@" > "$(dirname "$prompt")/args.txt"
[ -n "$OFFICEHUB_TOKEN" ] && grep -q 'OFFICEHUB_TOKEN' "$mcp" && tok=yes || tok=no
cd "$cwd" || exit 3
case "$cwd" in
  *TEST-46) mkdir -p agent-runner && echo hack > agent-runner/x.ts ;;
  *) echo "đã sửa" > note-$(date +%s%N).txt ;;
esac
git add -A && git commit -qm "agent commit" || exit 4
echo '{"session_id":"sess-xyz","cost_usd":0.42,"input_tokens":1000,"output_tokens":200,"summary":"token='$tok' home='$HOME' secret='$LEAK'"}'
`);
  chmodSync(bin, 0o755);
  const envFile = join(root, 'agent.env');
  writeFileSync(envFile, 'GIT_AUTHOR_NAME=agent\nGIT_AUTHOR_EMAIL=a@a\nGIT_COMMITTER_NAME=agent\nGIT_COMMITTER_EMAIL=a@a\n');
  process.env.LEAK = 'runner-secret-should-not-pass';

  const config = parseConfig({
    officehub: { mcp_url: `http://localhost:${mcp.port}/mcp` },
    telegram: { api_url: `http://localhost:${tg.port}`, group_chat_id: '-1001234567890', notifier_bot: '@officehub_notify_bot' },
    runner: { data_dir: join(root, 'data'), worktrees_dir: join(root, 'worktrees'), max_parallel: 1 },
    agents: [{
      employee_code: 'NV120', telegram_bot: '@agent_dev01_bot', telegram_token: TG, token: TOKEN, repo, env_file: envFile,
      executor: { kind: 'custom', bin, home: join(root, 'home'), timeout_min: 1,
        args: ['run', '--cwd', '{cwd}', '--prompt', '{prompt_file}', '--mcp', '{mcp_config}'], resume_args: ['--session', '{session_id}'], output: { format: 'json' } },
    }],
  });
  require('node:fs').mkdirSync(config.dataDir, { recursive: true });
  store = new Store(join(config.dataDir, 'runner.db'));
  runner = new Runner(config, store);
});

afterAll(() => {
  runner?.stop();
  for (const s of servers) s.stop();
  rmSync(root, { recursive: true, force: true });
});

const waitFor = async (cond: () => boolean, ms = 15000) => { for (let i = 0; i < ms / 100 && !cond(); i++) await Bun.sleep(100); return cond(); };

test('doctor: CLI, token đúng nhân viên, repo + hook, bot Telegram', async () => {
  const lines = await runner.checkAgents();
  expect(lines.filter((l) => l.startsWith('✘'))).toEqual([]);
  expect(lines.join('\n')).toContain('token AI đúng nhân viên');
  expect(readFileSync(join(root, 'agent-repo/.git/hooks/pre-push'), 'utf8')).toContain('officehub-agent-runner');
}, 30000);

test('tin Telegram hợp lệ → job chạy trong worktree ngoài repo → push nhánh → bình luận chi phí; tin giả mạo bị bỏ', async () => {
  const s = runner.agents.get('NV120')!;
  void runner.listen(s);
  void runner.schedule();
  expect(await waitFor(() => comments.length >= 1)).toBe(true);
  expect(comments.length).toBe(1); // tin của người thật giả mạo không tạo job
  const c = comments[0]!;
  expect(c.task).toBe(T1);
  expect(c.content).toContain('agent-runner');
  expect(c.content).toContain('Chi phí: $0.42');
  expect(authOk).toBe(true);
  const wt = join(root, 'worktrees/NV120/TEST-45');
  expect(existsSync(join(wt, '.git'))).toBe(true);
  const remote = await sh(['git', 'ls-remote', '--heads', 'origin', 'agent/nv120/test-45'], join(root, 'agent-repo'));
  expect(remote.out).toContain('agent/nv120/test-45'); // runner đã push nhánh (gh có / không thì PR tuỳ máy)
  const job = store.db.query<any, []>(`SELECT * FROM jobs WHERE task_code = 'TEST-45'`).get()!;
  expect(job.status).toBe('done');
  expect(job.session_id).toBe('sess-xyz');
  expect(job.cost_usd).toBe(0.42);
  const log = readFileSync(join(root, 'data/jobs', String(job.id), 'output.log'), 'utf8');
  expect(log).toContain('token=yes'); // OFFICEHUB_TOKEN có trong env + mcp.json dùng biến, không chứa token
  expect(log).toContain(`home=${join(root, 'home')}`);
  expect(log).not.toContain('runner-secret-should-not-pass'); // env của runner không lọt sang CLI
  expect(log).not.toContain(TOKEN);
  expect(existsSync(join(root, 'data/jobs', String(job.id), 'mcp.json'))).toBe(false); // dọn file tạm
}, 30000);

test('việc được đánh thức lại → nối phiên cũ (resume_args) trong cùng worktree', async () => {
  const s = runner.agents.get('NV120')!;
  const before = comments.length;
  const id = await runner.accept(s, { employee_code: 'NV120', project_id: P, task_id: T1, task_code: 'TEST-45' });
  expect(id).not.toBeNull();
  expect(await waitFor(() => comments.length > before)).toBe(true);
  const args = readFileSync(join(root, 'data/jobs', String(id), 'args.txt'), 'utf8');
  expect(args).toContain('--session sess-xyz');
  expect(args).toContain(join(root, 'worktrees/NV120/TEST-45'));
}, 30000);

test('việc không còn giao cho agent → bỏ, không chạy', async () => {
  tasks['x'] = null;
  const s = runner.agents.get('NV120')!;
  const saved = tasks[T1];
  tasks[T1] = { ...saved, task: { ...saved.task, assigneeEmployeeId: 'nguoi-khac' } };
  expect(await runner.accept(s, { employee_code: 'NV120', project_id: P, task_id: T1, task_code: 'TEST-45' })).toBeNull();
  tasks[T1] = saved;
});

test('agent sửa agent-runner/ → runner không push, hook pre-push cũng chặn', async () => {
  const s = runner.agents.get('NV120')!;
  const before = comments.length;
  await runner.accept(s, { employee_code: 'NV120', project_id: P, task_id: T2, task_code: 'TEST-46' });
  expect(await waitFor(() => comments.length > before)).toBe(true);
  expect(comments.at(-1)!.content).toContain('agent-runner/');
  expect(comments.at(-1)!.content).toContain('KHÔNG push');
  const wt = join(root, 'worktrees/NV120/TEST-46');
  const remote = await sh(['git', 'ls-remote', '--heads', 'origin', 'agent/nv120/test-46'], wt);
  expect(remote.out).toBe('');
  const manual = await sh(['git', 'push', 'origin', 'agent/nv120/test-46'], wt);
  expect(manual.code).not.toBe(0);
  expect(manual.err).toContain('agent không được sửa bộ điều phối');
  const main = await sh(['git', 'push', 'origin', 'HEAD:main'], wt);
  expect(main.code).not.toBe(0);
}, 30000);
