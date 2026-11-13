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
import type { RunnerConfig } from '../src/config';

const P = '01a1cb11-4644-716a-bf4d-8ab17b2f159b';
const T1 = '01a1ced9-0a22-713a-b89d-cbd02c09c92d', T2 = '01a1ced9-3468-7c5f-a773-f45aea6d3732';
const TOKEN = 'ohk_flowtest_secret_123456', TG = '123456789:AAH-flow-test-token-abcdefghijklmnop';
const root = mkdtempSync(join(tmpdir(), 'runner-flow-'));
const comments: { task: string; content: string }[] = [];
let authOk = true;
const presence: any[] = [];
/** Kết quả MCP list_chats (TEST-81). */
let chats: any[] = [];
let updatesServed = false;
const servers: { stop: () => void }[] = [];
let runner: Runner;
let gitBin = '';
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
  // TEST-46: danh tính lấy từ cấu hình git sẵn có (ở đây: cấu hình của repo) — runner không tự đặt
  await run(['git', 'config', 'user.name', 'Chu Du An'], repo);
  await run(['git', 'config', 'user.email', 'owner@example.vn'], repo);

  // MCP giả
  const mcp = Bun.serve({
    port: 0,
    async fetch(req) {
      if (req.headers.get('authorization') !== `Bearer ${TOKEN}`) authOk = false;
      if (new URL(req.url).pathname === '/mcp/presence') { presence.push(await req.json()); return new Response(null, { status: 204 }); }
      const m = await req.json() as any;
      const reply = (result: unknown) => Response.json({ jsonrpc: '2.0', id: m.id, result });
      if (m.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: {} });
      const { name, arguments: a } = m.params;
      const text = (o: unknown) => reply({ content: [{ type: 'text', text: JSON.stringify(o) }] });
      if (name === 'get_my_profile') return text({ employee: { id: 'emp-1', code: 'NV120', fullName: 'Bot Thử' } });
      if (name === 'get_task') return text(tasks[a.task] ?? tasks[T1]);
      if (name === 'list_chats') return text(chats);
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
  *TEST-46) mkdir -p agent-runner && echo hack > agent-runner/x.ts && f=agent-runner/x.ts ;;
  *) f=note-$(date +%s%N).txt && echo "đã sửa" > "$f" ;;
esac
git add "$f" && git commit -qm "agent commit" || exit 4
echo '{"session_id":"sess-xyz","model":"fake-model-1","cost_usd":0.42,"input_tokens":1000,"output_tokens":200,"summary":"token='$tok' home='$HOME' secret='$LEAK'"}'
`);
  chmodSync(bin, 0o755);
  const envFile = join(root, 'agent.env');
  writeFileSync(envFile, 'APP_MODE=test\n'); // env_file chỉ cho biến thử nghiệm — không còn đặt danh tính git
  process.env.LEAK = 'runner-secret-should-not-pass';

  gitBin = Bun.which('git')!;
  const config = parseConfig({
    git: { executable: gitBin },
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
  expect(lines.join('\n')).toContain('NV120: CLI custom'); // TEST-64: kind + bin + version + model cấu hình
  expect(lines.join('\n')).toContain('model: mặc định của CLI');
  expect(lines.join('\n')).toContain('commit đứng tên Chu Du An <owner@example.vn>');
  expect(lines[0]).toContain(`(${gitBin})`);
  expect(existsSync(join(root, 'agent-repo/.git/hooks/commit-msg'))).toBe(true);
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
  expect(c.content).toContain('- Model: fake-model-1'); // TEST-64: model CLI báo
  expect(authOk).toBe(true);
  const wt = join(root, 'worktrees/NV120/TEST-45');
  expect(existsSync(join(wt, '.git'))).toBe(true);
  const remote = await sh(['git', 'ls-remote', '--heads', 'origin', 'agent/nv120/test-45'], join(root, 'agent-repo'));
  expect(remote.out).toContain('agent/nv120/test-45'); // runner đã push nhánh (gh có / không thì PR tuỳ máy)
  const job = store.db.query<any, []>(`SELECT * FROM jobs WHERE task_code = 'TEST-45'`).get()!;
  expect(job.status).toBe('done');
  expect(job.model).toBe('fake-model-1');
  expect(job.session_id).toBe('sess-xyz');
  expect(job.cost_usd).toBe(0.42);
  const log = readFileSync(join(root, 'data/jobs', String(job.id), 'output.log'), 'utf8');
  expect(log).toContain('token=yes'); // OFFICEHUB_TOKEN có trong env + mcp.json dùng biến, không chứa token
  expect(log).toContain(`home=${join(root, 'home')}`);
  expect(log).not.toContain('runner-secret-should-not-pass'); // env của runner không lọt sang CLI
  expect(log).not.toContain(TOKEN);
  expect(existsSync(join(root, 'data/jobs', String(job.id), 'mcp.json'))).toBe(false); // dọn file tạm
  // Văn phòng 3D: báo đang làm việc TEST-45 khi bắt đầu, rảnh khi xong
  const working = presence.findIndex((p) => p.state === 'working');
  expect(presence[working]?.task).toStartWith('TEST-45');
  expect(presence.slice(working + 1).some((p) => p.state === 'idle')).toBe(true);
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

test('commit đứng tên tài khoản git của máy + trailer Agent / Task; force push bị chặn', async () => {
  const wt = join(root, 'worktrees/NV120/TEST-45');
  const log = await sh(['git', 'log', '-1', '--format=%an <%ae>%n%B'], wt);
  expect(log.out).toContain('Chu Du An <owner@example.vn>');
  expect(log.out).toContain('Agent: NV120');
  expect(log.out).toContain('Task: TEST-45');
  // commit của người (không có biến OFFICEHUB_AGENT) → hook không thêm gì
  writeFileSync(join(wt, 'human.txt'), 'x');
  await sh(['git', 'add', 'human.txt'], wt);
  await sh(['git', '-c', 'user.name=Nguoi', '-c', 'user.email=n@n', 'commit', '-qm', 'người sửa'], wt, { ...process.env, OFFICEHUB_AGENT: '' } as any);
  expect((await sh(['git', 'log', '-1', '--format=%B'], wt)).out).not.toContain('Agent:');
  // viết lại lịch sử rồi đẩy đè → hook chặn
  await sh(['git', 'reset', '-q', '--hard', 'HEAD~2'], wt);
  writeFileSync(join(wt, 'other.txt'), 'y');
  await sh(['git', 'add', 'other.txt'], wt);
  await sh(['git', '-c', 'user.name=Nguoi', '-c', 'user.email=n@n', 'commit', '-qm', 'lịch sử khác'], wt);
  const force = await sh(['git', 'push', '--force', 'origin', 'agent/nv120/test-45'], wt);
  expect(force.code).not.toBe(0);
  expect(force.err).toContain('không force push');
}, 30000);

test('git.executable sai → doctor báo lỗi, agent không nhận việc', async () => {
  const bad = new Runner({ ...runner.config, gitBin: '/khong/co/git' }, store);
  const lines = await bad.checkAgents(undefined, false);
  expect(lines.join('\n')).toContain('git.executable /khong/co/git không tồn tại');
  expect(bad.agents.get('NV120')!.enabled).toBe(false);
  expect(await bad.accept(bad.agents.get('NV120')!, { employee_code: 'NV120', project_id: P, task_id: T1, task_code: 'TEST-45' })).toBeNull();
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

// ---------------- mode in_place: commit thẳng vào nhánh đang checkout, không push / PR ----------------
const inPlaceSetup = async () => {
  const repo = join(root, 'agent-repo-ip');
  if (!existsSync(repo)) {
    await run(['git', 'clone', join(root, 'origin.git'), repo], root);
    await run(['git', 'config', 'user.name', 'Chu Du An'], repo);
    await run(['git', 'config', 'user.email', 'owner@example.vn'], repo);
    await run(['git', 'checkout', '-b', 'work'], repo);
  }
  const base = runner.config.agents[0]!;
  const config: RunnerConfig = { ...runner.config, dataDir: join(root, 'data-ip'), agents: [{ ...base, repo, workspace: { mode: 'in_place', allowBaseBranch: false, allowEnvFiles: false } }] };
  require('node:fs').mkdirSync(config.dataDir, { recursive: true });
  const st = new Store(join(config.dataDir, 'runner.db'));
  const r = new Runner(config, st);
  const lines = await r.checkAgents('NV120', false);
  const exec = async () => {
    const s = r.agents.get('NV120')!;
    const id = await r.accept(s, { employee_code: 'NV120', project_id: P, task_id: T1, task_code: 'TEST-45' });
    const job = st.claimNext(1, ['NV120'])!;
    await r.process(job);
    return { id, job: st.getJob(job.id)! };
  };
  return { repo, r, st, lines, exec };
};

test('in_place: commit vào nhánh đang checkout, KHÔNG push / PR / worktree / hook', async () => {
  const { repo, lines, exec } = await inPlaceSetup();
  expect(lines.filter((l) => l.startsWith('✘'))).toEqual([]);
  expect(lines.join('\n')).toContain('workspace in_place');
  const before = comments.length;
  const headBefore = await run(['git', 'rev-parse', 'HEAD'], repo);
  const { job } = await exec();
  expect(job.status).toBe('done');
  expect(job.pr_url).toBeNull();
  expect(comments.length).toBe(before + 1);
  expect(comments.at(-1)!.content).toContain('CHƯA push');
  expect(comments.at(-1)!.content).toContain('`work`');
  expect(await run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], repo)).toBe('work'); // vẫn nhánh cũ
  expect(await run(['git', 'rev-list', '--count', `${headBefore}..HEAD`], repo)).toBe('1');
  const msg = await run(['git', 'log', '-1', '--format=%an <%ae>%n%B'], repo);
  expect(msg).toContain('Chu Du An <owner@example.vn>');
  expect(msg).not.toContain('Agent: NV120'); // không có hook commit-msg → không có trailer
  expect((await run(['git', 'ls-remote', '--heads', 'origin', 'work'], repo))).toBe(''); // không có gì lên remote
  expect((await run(['git', 'worktree', 'list'], repo)).split('\n').length).toBe(1); // không tạo worktree
  // in_place không dùng hook: runner không cài hook nào trong repo này
  expect(existsSync(join(repo, '.git/hooks/pre-push'))).toBe(false);
  expect(existsSync(join(repo, '.git/hooks/commit-msg'))).toBe(false);
}, 30000);

test('in_place: repo còn thay đổi chưa commit → không chạy agent, báo lại trong việc', async () => {
  const { repo, exec } = await inPlaceSetup();
  writeFileSync(join(repo, 'dang-lam-do.txt'), 'của người');
  const before = comments.length, head = await run(['git', 'rev-parse', 'HEAD'], repo);
  const { job } = await exec();
  expect(job.status).toBe('skipped');
  expect(job.reason).toContain('chưa commit');
  expect(comments.length).toBe(before + 1);
  expect(comments.at(-1)!.content).toContain('KHÔNG chạy');
  expect(await run(['git', 'rev-parse', 'HEAD'], repo)).toBe(head); // agent không chạy → không có commit
  rmSync(join(repo, 'dang-lam-do.txt'));
}, 30000);

test('in_place: đang ở nhánh main hoặc detached HEAD → từ chối', async () => {
  const { repo, exec } = await inPlaceSetup();
  await run(['git', 'checkout', '-q', 'main'], repo);
  expect((await exec()).job.reason).toContain('nhánh main');
  await run(['git', 'checkout', '-q', '--detach'], repo);
  expect((await exec()).job.reason).toContain('detached HEAD');
  await run(['git', 'checkout', '-q', 'work'], repo);
}, 30000);

test('in_place: repo có .env ở gốc → doctor tắt agent (trừ allow_env_files)', async () => {
  const { repo, r } = await inPlaceSetup();
  writeFileSync(join(repo, '.env'), 'X=1\n');
  await run(['git', 'update-index', '--assume-unchanged', '.env'], repo).catch(() => undefined);
  const lines = await r.checkAgents('NV120', false);
  expect(lines.join('\n')).toContain('repo có .env');
  expect(r.agents.get('NV120')!.enabled).toBe(false);
  rmSync(join(repo, '.env'));
}, 30000);

test('hook pre-push bị xoá → job kế tiếp tự tạo lại trước khi chạy (mode worktree)', async () => {
  const hooks = join(root, 'agent-repo/.git/hooks');
  rmSync(join(hooks, 'pre-push'));
  rmSync(join(hooks, 'commit-msg'));
  expect(existsSync(join(hooks, 'pre-push'))).toBe(false);
  const s = runner.agents.get('NV120')!;
  const before = comments.length;
  expect(await runner.accept(s, { employee_code: 'NV120', project_id: P, task_id: T1, task_code: 'TEST-45' })).not.toBeNull();
  expect(await waitFor(() => comments.length > before)).toBe(true);
  expect(readFileSync(join(hooks, 'pre-push'), 'utf8')).toContain('officehub-agent-runner');
  expect(readFileSync(join(hooks, 'commit-msg'), 'utf8')).toContain('officehub-agent-runner');
  // commit của job vừa chạy đã có trailer → hook có mặt TRƯỚC khi agent commit
  const wt = join(root, 'worktrees/NV120/TEST-45');
  expect((await sh(['git', 'log', '-1', '--format=%B'], wt)).out).toContain('Agent: NV120');
}, 30000);

test('in_place: gỡ hook do runner cài, giữ nguyên hook của người dùng', async () => {
  const { repo, exec } = await inPlaceSetup();
  const hooks = join(repo, '.git/hooks');
  // hook của runner (có dấu) bị gỡ — cả ở lần job kế tiếp, không chỉ ở doctor
  writeFileSync(join(hooks, 'commit-msg'), '#!/bin/sh\n# officehub-agent-runner commit-msg — do runner cài\nexit 0\n');
  // hook của người dùng (không có dấu) giữ nguyên
  writeFileSync(join(hooks, 'pre-push'), '#!/bin/sh\n# hook riêng của chủ máy\nexit 0\n');
  const { job } = await exec();
  expect(job.status).toBe('done');
  expect(existsSync(join(hooks, 'commit-msg'))).toBe(false);
  expect(readFileSync(join(hooks, 'pre-push'), 'utf8')).toContain('hook riêng của chủ máy');
  rmSync(join(hooks, 'pre-push'));
}, 30000);

// ---------------- mode none (TEST-80): agent nghiệp vụ — không repo / git / PR, chỉ tool MCP ----------------
const noneSetup = async () => {
  // CLI giả không đụng git: ghi tham số + thư mục chạy, in dòng JSON kết quả
  const bin = join(root, 'fake-biz-agent.sh');
  writeFileSync(bin, `#!/bin/sh
[ "$1" = "--version" ] && { echo "fake-biz 1.0"; exit 0; }
cwd="$3"; prompt="$5"
echo "$@" > "$(dirname "$prompt")/args.txt"
cp "$prompt" "$(dirname "$prompt")/prompt-copy.md"
[ -f "$(dirname "$0")/slow" ] && sleep 1
cd "$cwd" || exit 3
echo '{"session_id":"sess-biz","model":"fake-model-1","cost_usd":0.1,"summary":"cwd='$(pwd -P)' files='$(ls -A | wc -l | tr -d " ")'"}'
`);
  chmodSync(bin, 0o755);
  const base = runner.config.agents[0]!;
  const raw = {
    git: { executable: '/khong/co/git' }, // mode none không cần git
    officehub: { mcp_url: runner.config.mcpUrl },
    telegram: { api_url: runner.config.telegramApiUrl, group_chat_id: '-1001234567890' },
    runner: { data_dir: join(root, 'data-none'), worktrees_dir: join(root, 'worktrees'), max_parallel: 1 },
    agents: [{
      employee_code: 'NV120', telegram_bot: '@agent_dev01_bot', telegram_token: TG, token: TOKEN, workspace: { mode: 'none' },
      executor: { kind: 'custom', bin, home: base.executor.home, timeout_min: 1,
        args: ['run', '--cwd', '{cwd}', '--prompt', '{prompt_file}', '--mcp', '{mcp_config}'], resume_args: ['--session', '{session_id}'], output: { format: 'json' } },
    }],
  };
  const config = parseConfig(raw);
  require('node:fs').mkdirSync(config.dataDir, { recursive: true });
  const st = new Store(join(config.dataDir, 'runner.db'));
  const r = new Runner(config, st);
  const lines = await r.checkAgents('NV120', false);
  const exec = async () => {
    const s = r.agents.get('NV120')!;
    const id = await r.accept(s, { employee_code: 'NV120', project_id: P, task_id: T1, task_code: 'TEST-45' });
    const job = st.claimNext(1, ['NV120'])!;
    await r.process(job);
    return { id, job: st.getJob(job.id)! };
  };
  return { r, st, lines, exec, dataDir: config.dataDir };
};

test('none: doctor không cần repo / git / gh; job chạy trong thư mục trống cố định, bình luận không có PR, nối phiên cùng thư mục', async () => {
  const { lines, exec, dataDir } = await noneSetup();
  expect(lines.filter((l) => l.startsWith('✘'))).toEqual([]); // git.executable sai không tắt agent mode none
  const text = lines.join('\n');
  expect(text).toContain('workspace none');
  expect(text).toContain('runner không tắt được công cụ có sẵn'); // adapter custom: cảnh báo
  expect(text).not.toContain('gh ');
  expect(text).not.toContain('hook');
  const before = comments.length;
  const { job } = await exec();
  expect(job.status).toBe('done');
  expect(job.pr_url).toBeNull();
  expect(job.cost_usd).toBe(0.1);
  expect(comments.length).toBe(before + 1);
  const c = comments.at(-1)!.content;
  expect(c).toContain('phiên kết thúc');
  expect(c).toContain('Chi phí: $0.10');
  expect(c).not.toContain('PR');
  expect(c).not.toContain('commit');
  const work = join(dataDir, 'work/NV120/TEST-45');
  const out1 = readFileSync(join(dataDir, 'jobs', String(job.id), 'output.log'), 'utf8');
  expect(out1).toContain(`cwd=${require('node:fs').realpathSync(work)}`);
  expect(out1).toContain('files=0'); // thư mục trống: prompt / mcp.json nằm ở thư mục job, không nằm trong nơi CLI chạy
  expect(readFileSync(join(dataDir, 'jobs', String(job.id), 'args.txt'), 'utf8')).not.toContain('--session');
  expect(existsSync(join(root, 'worktrees/NV120/TEST-45/.git'))).toBe(true); // của test worktree trước đó — mode none không tạo gì thêm
  expect(existsSync(join(dataDir, 'jobs', String(job.id), 'mcp.json'))).toBe(false);
  // việc bị trả về → cùng thư mục + nối phiên cũ
  const again = await exec();
  const args = readFileSync(join(dataDir, 'jobs', String(again.job.id), 'args.txt'), 'utf8');
  expect(args).toContain('--session sess-biz');
  expect(args).toContain(work);
  // 3D: vẫn báo đang làm → rảnh
  expect(await waitFor(() => presence.at(-1)?.state === 'idle', 3000)).toBe(true);
}, 30000);

// ---------------- chat_mention (TEST-81): người thật @nhắc bot trong chat → phiên ngắn chỉ có tool MCP ----------------
test('chat_mention: tin Telegram → job chat trong thư mục riêng của hội thoại, không bình luận vào việc, nối phiên ≤ 24 giờ; đã đọc hết → bỏ', async () => {
  const { r, st, dataDir } = await noneSetup();
  const s = r.agents.get('NV120')!;
  const C = '01a1d000-0000-7000-8000-00000000c0de';
  const tgMsg = (o: object) => ({ message_id: 1, date: 0, chat: { id: -1001234567890, type: 'supergroup' }, text: JSON.stringify(o) }) as any;
  const wake = tgMsg({ employee_code: 'NV120', event: 'chat_mention', conversation_id: C, message_id: '01a1d000-0000-7000-8000-00000000beef' });
  const runNext = async () => { const job = st.claimNext(1, ['NV120'])!; await r.process(job); return st.getJob(job.id)!; };
  const file = (job: { id: number }, name: string) => readFileSync(join(dataDir, 'jobs', String(job.id), name), 'utf8');

  chats = [{ conversation: C, type: 'room', unread: 0, mentionedUnread: 0 }];
  expect(await r.onMessage(s, wake)).toBeNull(); // không còn tin nhắc chưa đọc → không xếp hàng

  chats = [{ conversation: C, type: 'room', unread: 3, mentionedUnread: 1 }];
  const before = comments.length, presenceBefore = presence.length;
  const id = await r.onMessage(s, wake);
  expect(id).not.toBeNull();
  expect(await r.onMessage(s, wake)).toBeNull(); // tin lặp khi job còn chờ → gộp
  const job = await runNext();
  expect(job).toMatchObject({ id: id!, kind: 'chat', status: 'done', task_id: C, cost_usd: 0.1, pr_url: null });
  expect(comments.length).toBe(before); // không bình luận vào việc
  const work = join(dataDir, 'work/NV120', `chat-${C}`);
  expect(file(job, 'args.txt')).toContain(work);
  expect(file(job, 'args.txt')).not.toContain('--session');
  const prompt = file(job, 'prompt-copy.md');
  expect(prompt).toContain(`read_chat ${C}`);
  expect(prompt).not.toContain('NỐI TIẾP');
  await Bun.sleep(300);
  expect(presence.slice(presenceBefore).some((p) => p.state === 'working')).toBe(false); // chat không đổi trạng thái 3D

  // nhắc lần nữa trong 24 giờ → nối phiên cũ của hội thoại
  await r.onMessage(s, wake);
  const second = await runNext();
  expect(file(second, 'args.txt')).toContain('--session sess-biz');
  expect(file(second, 'prompt-copy.md')).toContain('NỐI TIẾP');
  // phiên cũ quá 24 giờ → mở phiên mới
  st.db.run(`UPDATE task_sessions SET updated_at = ? WHERE task_id = ?`, [new Date(Date.now() - 25 * 3_600_000).toISOString(), C]);
  await r.onMessage(s, wake);
  expect(file(await runNext(), 'args.txt')).not.toContain('--session');

  // agent đã đọc hết trước khi tới lượt chạy → job bị bỏ, không gọi CLI
  await r.onMessage(s, wake);
  chats = [{ conversation: C, type: 'room', unread: 0, mentionedUnread: 0 }];
  const skipped = await runNext();
  expect(skipped).toMatchObject({ status: 'skipped', reason: 'không còn tin nhắc chưa đọc' });
  expect(existsSync(join(dataDir, 'jobs', String(skipped.id), 'args.txt'))).toBe(false);
}, 30000);

test('chat_mention: tin nhắc mới tới khi job cùng hội thoại đang chạy → xong thì chạy thêm một lượt; kênh office dùng "office"', async () => {
  const { r, st, dataDir } = await noneSetup();
  const s = r.agents.get('NV120')!;
  const OFFICE = '01a1d000-0000-7000-8000-0000000ff1ce';
  chats = [{ conversation: 'office', type: 'office', unread: 1, mentionedUnread: 1 }];
  const w = { employee_code: 'NV120', conversation_id: OFFICE, message_id: '01a1d000-0000-7000-8000-00000000beef' };
  writeFileSync(join(root, 'slow'), ''); // CLI giả chạy 1 giây
  try {
    const id = (await r.acceptChat(s, w))!;
    const job = st.claimNext(1, ['NV120'])!;
    const running = r.process(job);
    await Bun.sleep(300);
    expect(await r.acceptChat(s, w)).toBeNull(); // đang chạy → không xếp thêm, đánh dấu rerun
    expect(st.getJob(id)!.rerun).toBe(1);
    await running;
    expect(st.getJob(id)!.status).toBe('done');
    expect(readFileSync(join(dataDir, 'jobs', String(id), 'prompt-copy.md'), 'utf8')).toContain('read_chat office');
    const next = st.db.query<any, [string]>(`SELECT * FROM jobs WHERE task_id = ? AND status = 'queued'`).get(OFFICE);
    expect(next?.kind).toBe('chat'); // lượt chạy thêm đã vào hàng đợi
    st.finish(next.id, 'skipped');
  } finally {
    rmSync(join(root, 'slow'), { force: true });
  }
}, 30000);
