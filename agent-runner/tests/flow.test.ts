// Test tích hợp cả luồng, KHÔNG cần mạng / OfficeHub / Telegram thật:
// Telegram giả + MCP giả (Bun.serve) + CLI agent giả (script sh, adapter custom) + repo git có origin là repo bare tạm.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '../src/config';
import { Runner } from '../src/runner';
import { formatFinding } from '../src/doctor/finding';
import { Store } from '../src/store';
import { sh } from '../src/workspace';
import type { RunnerConfig } from '../src/config';

const P = '01a1cb11-4644-716a-bf4d-8ab17b2f159b';
const T1 = '01a1ced9-0a22-713a-b89d-cbd02c09c92d',
  T2 = '01a1ced9-3468-7c5f-a773-f45aea6d3732';
const TOKEN = 'ohk_flowtest_secret_123456',
  TG = '123456789:AAH-flow-test-token-abcdefghijklmnop';
const root = mkdtempSync(join(tmpdir(), 'runner-flow-'));
const comments: { task: string; content: string }[] = [];
let authOk = true;
const presence: any[] = [];
/** Phiên mức dùng AI runner gửi tới /mcp/usage (TEST-135), theo thứ tự nhận. */
const usage: any[] = [];
/** Sự kiện xem trực tiếp runner gửi tới /mcp/activity (TEST-99), theo thứ tự nhận. */
const activity: any[] = [];
/** true = /mcp/activity nhận request rồi im lặng (máy chủ treo) — job vẫn phải xong. */
let activityHang = false;
/** Kết quả MCP list_my_tasks (TEST-158); null = tool chưa có (OfficeHub bản cũ) → lỗi. */
let mine: any[] | null = null;
let mineCalls = 0;
/** Thay kết quả MCP get_task trong một test (TEST-180: đọc lại việc sau phiên follow); null = dùng `tasks`. */
let getTaskHook: ((a: any) => any) | null = null;
/** > 0 → get_task trả lỗi MCP ngần ấy lần (máy chủ tạm lỗi — runner phải thử lại nhận tin). */
let getTaskFails = 0;
/** Kết quả MCP list_chats (TEST-81). */
let chats: any[] = [];
let updatesServed = false;
const servers: { stop: () => void }[] = [];
let runner: Runner;
let gitBin = '';
let store: Store;

const tasks: Record<string, any> = {
  [T1]: {
    task: { id: T1, projectId: P, assigneeEmployeeId: 'emp-1', done: false, title: 'Sửa nút lưu', code: 'TEST-45' },
    dependsOn: [],
  },
  [T2]: {
    task: {
      id: T2,
      projectId: P,
      assigneeEmployeeId: 'emp-1',
      done: false,
      title: 'Việc chạm runner',
      code: 'TEST-46',
    },
    dependsOn: [],
  },
  'TEST-45': null,
};

const run = async (cmd: string[], cwd: string) => {
  const r = await sh(cmd, cwd, {
    ...process.env,
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t',
  } as any);
  if (r.code !== 0) throw new Error(`${cmd.join(' ')}: ${r.err}`);
  return r.out;
};

beforeAll(async () => {
  // repo: origin bare + bản clone của agent
  const origin = join(root, 'origin.git'),
    seed = join(root, 'seed'),
    repo = join(root, 'agent-repo');
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
      if (new URL(req.url).pathname === '/mcp/presence') {
        presence.push(await req.json());
        return new Response(null, { status: 204 });
      }
      if (new URL(req.url).pathname === '/mcp/usage') {
        const b = (await req.json()) as any;
        usage.push(...b.sessions);
        return Response.json({ accepted: b.sessions.length, created: b.sessions.length, updated: 0 });
      }
      if (new URL(req.url).pathname === '/mcp/activity' && activityHang) {
        await Bun.sleep(20_000);
        return new Response(null, { status: 503 });
      }
      if (new URL(req.url).pathname === '/mcp/activity') {
        activity.push(...((await req.json()) as any).events);
        return new Response(null, { status: 204 });
      }
      const m = (await req.json()) as any;
      const reply = (result: unknown) => Response.json({ jsonrpc: '2.0', id: m.id, result });
      if (m.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: {} });
      const { name, arguments: a } = m.params;
      const text = (o: unknown) => reply({ content: [{ type: 'text', text: JSON.stringify(o) }] });
      if (name === 'get_my_profile') return text({ employee: { id: 'emp-1', code: 'NV120', fullName: 'Bot Thử' } });
      if (name === 'get_task' && getTaskFails > 0) {
        getTaskFails--;
        return reply({ isError: true, content: [{ type: 'text', text: 'máy chủ đang khởi động lại' }] });
      }
      if (name === 'get_task') return text(getTaskHook?.(a) ?? tasks[a.task] ?? tasks[T1]);
      if (name === 'list_chats') return text(chats);
      if (name === 'list_my_tasks') {
        mineCalls++;
        if (mine) return text(mine);
      }
      if (name === 'comment_task') {
        comments.push({ task: a.task, content: a.content });
        return text({ ok: true });
      }
      return reply({ isError: true, content: [{ type: 'text', text: 'tool lạ' }] });
    },
  });
  // Telegram giả: lần đầu trả 2 tin (1 hợp lệ, 1 người thật giả mạo), sau đó trả rỗng
  const tg = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (!path.startsWith(`/bot${TG}/`))
        return Response.json({ ok: false, description: 'Unauthorized' }, { status: 401 });
      if (path.endsWith('/getMe'))
        return Response.json({ ok: true, result: { id: 1, is_bot: true, username: 'Agent_Dev01_Bot' } });
      if (path.endsWith('/getUpdates')) {
        if (updatesServed) {
          await Bun.sleep(300);
          return Response.json({ ok: true, result: [] });
        }
        updatesServed = true;
        const text = `@agent_dev01_bot\n{"employee_code":"NV120","project_id":"${P}","task_id":"${T1}","task_code":"TEST-45"}`;
        return Response.json({
          ok: true,
          result: [
            {
              update_id: 10,
              message: {
                message_id: 1,
                date: 0,
                chat: { id: -1001234567890, type: 'supergroup' },
                from: { id: 5, is_bot: false, username: 'hacker' },
                text,
              },
            },
            {
              update_id: 11,
              message: {
                message_id: 2,
                date: 0,
                chat: { id: -1001234567890, type: 'supergroup' },
                from: { id: 9, is_bot: true, username: 'officehub_notify_bot' },
                text,
              },
            },
          ],
        });
      }
      return Response.json({ ok: false }, { status: 404 });
    },
  });
  servers.push(mcp, tg);

  // CLI agent giả: ghi tham số + kiểm tra env, commit một file (TEST-46: sửa agent-runner/), in dòng JSON kết quả
  const bin = join(root, 'fake-agent.sh');
  writeFileSync(
    bin,
    `#!/bin/sh
[ "$1" = "--version" ] && { echo "fake-agent 1.0"; exit 0; }
cwd="$3"; prompt="$5"; mcp="$7"
echo "$@" > "$(dirname "$prompt")/args.txt"
cp "$prompt" "$(dirname "$prompt")/prompt-copy.md"
[ -n "$OFFICEHUB_TOKEN" ] && grep -q 'OFFICEHUB_TOKEN' "$mcp" && tok=yes || tok=no
cd "$cwd" || exit 3
case "$cwd" in
  *TEST-46|*-prot) mkdir -p agent-runner && echo hack > agent-runner/x.ts && f=agent-runner/x.ts ;;
  *) f=note-$(date +%s%N).txt && echo "đã sửa" > "$f" ;;
esac
git add "$f" && git commit -qm "agent commit" || exit 4
echo '{"session_id":"sess-xyz","model":"fake-model-1","cost_usd":0.42,"input_tokens":1000,"output_tokens":200,"summary":"token='$tok' home='$HOME' secret='$LEAK'"}'
`,
  );
  chmodSync(bin, 0o755);
  const envFile = join(root, 'agent.env');
  writeFileSync(envFile, 'APP_MODE=test\n'); // env_file chỉ cho biến thử nghiệm — không còn đặt danh tính git
  process.env.LEAK = 'runner-secret-should-not-pass';

  gitBin = Bun.which('git')!;
  const config = parseConfig({
    git: { executable: gitBin },
    officehub: { mcp_url: `http://localhost:${mcp.port}/mcp` },
    telegram: {
      api_url: `http://localhost:${tg.port}`,
      group_chat_id: '-1001234567890',
      notifier_bot: '@officehub_notify_bot',
    },
    runner: { data_dir: join(root, 'data'), worktrees_dir: join(root, 'worktrees'), max_parallel: 1 },
    agents: [
      {
        employee_code: 'NV120',
        telegram_bot: '@agent_dev01_bot',
        telegram_token: TG,
        token: TOKEN,
        repo,
        env_file: envFile,
        executor: {
          kind: 'custom',
          bin,
          home: join(root, 'home'),
          timeout_min: 1,
          args: ['run', '--cwd', '{cwd}', '--prompt', '{prompt_file}', '--mcp', '{mcp_config}'],
          resume_args: ['--session', '{session_id}'],
          output: { format: 'json' },
        },
      },
    ],
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

const waitFor = async (cond: () => boolean, ms = 15000) => {
  for (let i = 0; i < ms / 100 && !cond(); i++) await Bun.sleep(100);
  return cond();
};

test('doctor: CLI, token đúng nhân viên, repo + hook, bot Telegram', async () => {
  const lines = (await runner.checkAgents()).map(formatFinding);
  expect(lines.filter((l) => l.startsWith('✘'))).toEqual([]);
  expect(lines.join('\n')).toContain('token AI đúng nhân viên');
  expect(lines.join('\n')).toContain('NV120: CLI custom'); // TEST-64: kind + bin + version + model cấu hình
  expect(lines.join('\n')).toContain('model: mặc định của CLI');
  expect(lines.join('\n')).toContain('commit đứng tên Chu Du An <owner@example.vn>');
  expect(lines[0]).toContain(`(${gitBin})`);
  expect(lines.join('\n')).toContain(
    '⚠ NV120: repo đang ở nhánh main — nhánh việc tách từ origin/main và PR merge vào main',
  ); // cảnh báo, không chặn
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
  // TEST-121: push được nhưng gh không tạo được PR (origin là repo bare, không phải GitHub) → ⚠ "Không tạo được PR" thay vì rảnh
  const after = presence.slice(working + 1);
  if (job.pr_url) expect(after.some((p) => p.state === 'idle')).toBe(true);
  else
    expect(after.at(-1)).toEqual({
      state: 'error',
      task: 'TEST-45 · Sửa nút lưu',
      error: 'Không tạo được PR',
      taskId: T1,
      projectId: P,
    });
  // Xem trực tiếp (TEST-99): bắt đầu phiên kèm tên việc → kết thúc phiên kèm chi phí + model thật
  const start = activity.findIndex((e) => e.kind === 'session_start');
  expect(activity[start]).toMatchObject({ id: 'session', kind: 'session_start' }); // agent thử không cấu hình model → model thật chỉ có ở session_end
  expect(activity[start].task).toStartWith('TEST-45 · ');
  // Bộ gửi chạy ở nền (job không chờ nó) → kết thúc phiên tới ngay sau, không nhất thiết trước bình luận
  expect(await waitFor(() => activity.slice(start + 1).some((e) => e.kind === 'session_end'), 3000)).toBe(true);
  const end = activity.slice(start + 1).find((e) => e.kind === 'session_end');
  expect(end).toMatchObject({ id: 'session-end', ok: true, costUsd: 0.42, model: 'fake-model-1' });
  expect(JSON.stringify(activity)).not.toContain(TOKEN);
  // Mức dùng AI (TEST-135): sau phiên runner gửi /mcp/usage ở nền (CLI tự khai báo: không báo cache → null, không phải 0)
  expect(await waitFor(() => usage.some((u) => u.taskCode === 'TEST-45'), 3000)).toBe(true);
  const u = usage.find((x) => x.taskCode === 'TEST-45');
  expect(u).toMatchObject({ kind: 'task', taskId: T1, projectId: P, executor: 'custom', costUsd: 0.42, turns: null });
  expect(u.sourceId).toEndWith(`:${store.dbId()}:NV120:${job.id}`);
  expect(['done', 'failed']).toContain(u.status);
  expect(u.models).toEqual([
    {
      model: 'fake-model-1',
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      costUsd: 0.42,
    },
  ]);
  expect(await waitFor(() => !!store.getJob(job.id)!.usage_sent_at, 3000)).toBe(true);
}, 30000);

test('việc được đánh thức lại → nối phiên cũ (resume_args) trong cùng worktree', async () => {
  const s = runner.agents.get('NV120')!;
  const before = comments.length;
  // Lỗi 2026-11-14 (job TEST-97): bộ gửi "xem trực tiếp" làm runner treo ở cuối job → không ghi kết quả, không bình luận chi phí.
  // Ở đây /mcp/activity treo hẳn: job vẫn phải xong, ghi kết quả và bình luận như thường (bộ gửi không nằm trên đường đi của job).
  activityHang = true;
  const t0 = Date.now();
  const id = await runner.accept(s, {
    kind: 'task',
    employee_code: 'NV120',
    project_id: P,
    task_id: T1,
    task_code: 'TEST-45',
  });
  expect(id).not.toBeNull();
  expect(await waitFor(() => comments.length > before)).toBe(true);
  expect(await waitFor(() => store.getJob(id!)?.status === 'done', 3000)).toBe(true);
  expect(Date.now() - t0).toBeLessThan(10_000);
  expect(comments.at(-1)!.content).toContain('Chi phí: $0.42');
  activityHang = false;
  const args = readFileSync(join(root, 'data/jobs', String(id), 'args.txt'), 'utf8');
  expect(args).toContain('--session sess-xyz');
  expect(args).toContain(join(root, 'worktrees/NV120/TEST-45'));
  // TEST-142: nối phiên → bỏ đọc lại vai trò / dự án; prompt luôn đòi mục Bàn giao
  const prompt = readFileSync(join(root, 'data/jobs', String(id), 'prompt-copy.md'), 'utf8');
  expect(prompt).toContain('NỐI TIẾP');
  expect(prompt).not.toContain('1. get_my_role');
  expect(prompt).toContain('**Bàn giao**');
}, 30000);

test('TEST-142: lần trước cách > 10 phút → phiên mới + đọc Bàn giao; máy mới (mất worktree, nhánh local, runner.db) → lấy nhánh việc từ origin, làm tiếp, push fast-forward', async () => {
  const s = runner.agents.get('NV120')!;
  const repo = join(root, 'agent-repo'),
    wt = join(root, 'worktrees/NV120/TEST-45'),
    branch = 'agent/nv120/test-45';
  const runTask = async () => {
    const id = await runner.accept(s, {
      kind: 'task',
      employee_code: 'NV120',
      project_id: P,
      task_id: T1,
      task_code: 'TEST-45',
    });
    expect(id).not.toBeNull();
    expect(await waitFor(() => ['done', 'failed'].includes(store.getJob(id!)?.status ?? ''), 15000)).toBe(true);
    const dir = join(root, 'data/jobs', String(id));
    return {
      job: store.getJob(id!)!,
      args: readFileSync(join(dir, 'args.txt'), 'utf8'),
      prompt: readFileSync(join(dir, 'prompt-copy.md'), 'utf8'),
    };
  };
  const remoteHead = async () =>
    (await sh(['git', 'ls-remote', '--heads', 'origin', branch], repo)).out.split(/\s/)[0]!;

  // 1) cách 11 phút → không nối phiên (cache đã hết), prompt bảo đọc Bàn giao + lịch sử nhánh
  store.db.run(`UPDATE task_sessions SET updated_at = ? WHERE task_id = ?`, [
    new Date(Date.now() - 11 * 60_000).toISOString(),
    T1,
  ]);
  const gap = await runTask();
  expect(gap.args).not.toContain('--session');
  expect(gap.prompt).toContain('ĐÃ TỪNG LÀM');
  expect(gap.prompt).toContain('1. get_my_role');
  expect(store.session(T1)!.resumes).toBe(0);

  // 2) máy mới: xoá worktree + nhánh local + bảng phiên; nhánh vẫn còn trên origin (đã push ở các job trước)
  const before = await remoteHead();
  expect(before).toMatch(/^[0-9a-f]{40}$/);
  await run(['git', 'worktree', 'remove', '--force', wt], repo);
  await run(['git', 'branch', '-D', branch], repo);
  store.db.run(`DELETE FROM task_sessions`);
  const fresh = await runTask();
  expect(fresh.args).not.toContain('--session');
  expect(fresh.prompt).toContain('ĐÃ TỪNG LÀM'); // nhánh có trên origin → làm tiếp
  // worktree dựng lại từ origin/<nhánh>: có commit cũ, commit mới nằm trên, push được (fast-forward, hook không chặn)
  expect((await sh(['git', 'merge-base', '--is-ancestor', before, 'HEAD'], wt)).code).toBe(0);
  const after = await remoteHead();
  expect(after).not.toBe(before);
  expect((await sh(['git', 'merge-base', '--is-ancestor', before, after], repo)).code).toBe(0);
  expect(comments.at(-1)!.content).not.toContain('git push lỗi'); // (gh không đăng nhập trên máy test → chỉ phần tạo PR báo lỗi)
}, 60000);

test('việc không còn giao cho agent → bỏ, không chạy', async () => {
  tasks['x'] = null;
  const s = runner.agents.get('NV120')!;
  const saved = tasks[T1];
  tasks[T1] = { ...saved, task: { ...saved.task, assigneeEmployeeId: 'nguoi-khac' } };
  expect(
    await runner.accept(s, { kind: 'task', employee_code: 'NV120', project_id: P, task_id: T1, task_code: 'TEST-45' }),
  ).toBeNull();
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
  await sh(['git', '-c', 'user.name=Nguoi', '-c', 'user.email=n@n', 'commit', '-qm', 'người sửa'], wt, {
    ...process.env,
    OFFICEHUB_AGENT: '',
  } as any);
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
  const lines = (await bad.checkAgents({ telegram: false })).map(formatFinding);
  expect(lines.join('\n')).toContain('git.executable /khong/co/git không tồn tại');
  expect(bad.agents.get('NV120')!.enabled).toBe(false);
  expect(
    await bad.accept(bad.agents.get('NV120')!, {
      kind: 'task',
      employee_code: 'NV120',
      project_id: P,
      task_id: T1,
      task_code: 'TEST-45',
    }),
  ).toBeNull();
});

test('agent sửa agent-runner/ → runner không push, hook pre-push cũng chặn', async () => {
  const s = runner.agents.get('NV120')!;
  const before = comments.length;
  await runner.accept(s, { kind: 'task', employee_code: 'NV120', project_id: P, task_id: T2, task_code: 'TEST-46' });
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

// ---------------- mode in_place: commit thẳng vào nhánh đang checkout, runner push nhánh đó — không PR ----------------
const inPlaceSetup = async (name = 'agent-repo-ip', branch = 'work') => {
  const repo = join(root, name);
  if (!existsSync(repo)) {
    await run(['git', 'clone', join(root, 'origin.git'), repo], root);
    await run(['git', 'config', 'user.name', 'Chu Du An'], repo);
    await run(['git', 'config', 'user.email', 'owner@example.vn'], repo);
    await run(['git', 'checkout', '-b', branch], repo);
  }
  const base = runner.config.agents[0]!;
  const config: RunnerConfig = {
    ...runner.config,
    dataDir: join(root, `data-${name}`),
    agents: [
      {
        ...base,
        repo,
        workspace: { mode: 'in_place', allowBaseBranch: false, allowEnvFiles: false, builtinTools: false },
      },
    ],
  };
  require('node:fs').mkdirSync(config.dataDir, { recursive: true });
  const st = new Store(join(config.dataDir, 'runner.db'));
  const r = new Runner(config, st);
  const lines = (await r.checkAgents({ only: 'NV120', telegram: false })).map(formatFinding);
  const exec = async () => {
    const s = r.agents.get('NV120')!;
    const id = await r.accept(s, {
      kind: 'task',
      employee_code: 'NV120',
      project_id: P,
      task_id: T1,
      task_code: 'TEST-45',
    });
    const job = st.claimNext(1, ['NV120'])!;
    await r.process(job);
    return { id, job: st.getJob(job.id)! };
  };
  return { repo, r, st, lines, exec };
};

test('in_place: commit vào nhánh đang checkout → runner push nhánh đó lên origin, KHÔNG PR / worktree / hook', async () => {
  const { repo, lines, exec } = await inPlaceSetup();
  expect(lines.filter((l) => l.startsWith('✘'))).toEqual([]);
  expect(lines.join('\n')).toContain('workspace in_place');
  const before = comments.length;
  const headBefore = await run(['git', 'rev-parse', 'HEAD'], repo);
  const { job } = await exec();
  expect(job.status).toBe('done');
  expect(job.pr_url).toBeNull();
  expect(comments.length).toBe(before + 1);
  expect(comments.at(-1)!.content).toContain('đã push lên origin');
  expect(comments.at(-1)!.content).not.toContain('CHƯA push');
  expect(comments.at(-1)!.content).toContain('`work`');
  expect(await run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], repo)).toBe('work'); // vẫn nhánh cũ
  expect(await run(['git', 'rev-list', '--count', `${headBefore}..HEAD`], repo)).toBe('1');
  const msg = await run(['git', 'log', '-1', '--format=%an <%ae>%n%B'], repo);
  expect(msg).toContain('Chu Du An <owner@example.vn>');
  expect(msg).not.toContain('Agent: NV120'); // không có hook commit-msg → không có trailer
  // runner đã push đúng commit của agent lên origin/work
  expect(await run(['git', 'ls-remote', '--heads', 'origin', 'work'], repo)).toStartWith(
    await run(['git', 'rev-parse', 'HEAD'], repo),
  );
  expect((await run(['git', 'worktree', 'list'], repo)).split('\n').length).toBe(1); // không tạo worktree
  // in_place không dùng hook: runner không cài hook nào trong repo này
  expect(existsSync(join(repo, '.git/hooks/pre-push'))).toBe(false);
  expect(existsSync(join(repo, '.git/hooks/commit-msg'))).toBe(false);
}, 30000);

test('in_place: repo còn thay đổi chưa commit → không chạy agent, báo lại trong việc', async () => {
  const { repo, exec } = await inPlaceSetup();
  writeFileSync(join(repo, 'dang-lam-do.txt'), 'của người');
  const before = comments.length,
    head = await run(['git', 'rev-parse', 'HEAD'], repo);
  const { job } = await exec();
  expect(job.status).toBe('skipped');
  expect(job.reason).toContain('chưa commit');
  expect(comments.length).toBe(before + 1);
  expect(comments.at(-1)!.content).toContain('KHÔNG chạy');
  expect(await run(['git', 'rev-parse', 'HEAD'], repo)).toBe(head); // agent không chạy → không có commit
  expect(await waitFor(() => presence.at(-1)?.error === 'Không chạy được', 3000)).toBe(true); // TEST-121
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

test('in_place: remote đã có commit khác → không push được, báo trong việc, commit vẫn ở máy (không force)', async () => {
  const { repo, exec } = await inPlaceSetup();
  // người khác đẩy commit lên origin/work sau lần push trước
  const other = join(root, 'other-clone');
  await run(['git', 'clone', '-q', '-b', 'work', join(root, 'origin.git'), other], root);
  writeFileSync(join(other, 'cua-nguoi-khac.txt'), 'x');
  await run(['git', 'add', '.'], other);
  await run(['git', 'commit', '-qm', 'người khác'], other);
  await run(['git', 'push', '-q', 'origin', 'work'], other);
  const remoteHead = await run(['git', 'rev-parse', 'HEAD'], other);
  const { job } = await exec();
  expect(job.status).toBe('done');
  expect(comments.at(-1)!.content).toContain('CHƯA push — git push lỗi');
  expect(await waitFor(() => presence.at(-1)?.error === 'Không push được', 3000)).toBe(true); // TEST-121
  expect(await run(['git', 'ls-remote', '--heads', 'origin', 'work'], repo)).toStartWith(remoteHead); // remote không bị đè
  // người thật xử lý (pull --rebase) → lần sau push lại được cả commit cũ
  await run(['git', 'pull', '-q', '--rebase', 'origin', 'work'], repo);
  await exec();
  expect(comments.at(-1)!.content).toContain('đã push lên origin');
}, 30000);

test('in_place: agent chạm agent-runner/ → runner KHÔNG push', async () => {
  const { repo, exec } = await inPlaceSetup('agent-repo-prot', 'work-prot');
  const { job } = await exec();
  expect(job.status).toBe('done');
  expect(comments.at(-1)!.content).toContain('agent-runner/');
  expect(comments.at(-1)!.content).toContain('runner KHÔNG push');
  expect(await waitFor(() => presence.at(-1)?.error === 'Không push được', 3000)).toBe(true); // TEST-121
  expect(await run(['git', 'ls-remote', '--heads', 'origin', 'work-prot'], repo)).toBe('');
}, 30000);

test('in_place: repo có .env ở gốc → doctor tắt agent (trừ allow_env_files)', async () => {
  const { repo, r } = await inPlaceSetup();
  writeFileSync(join(repo, '.env'), 'X=1\n');
  await run(['git', 'update-index', '--assume-unchanged', '.env'], repo).catch(() => undefined);
  const lines = (await r.checkAgents({ only: 'NV120', telegram: false })).map(formatFinding);
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
  expect(
    await runner.accept(s, { kind: 'task', employee_code: 'NV120', project_id: P, task_id: T1, task_code: 'TEST-45' }),
  ).not.toBeNull();
  expect(await waitFor(() => comments.length > before)).toBe(true);
  expect(readFileSync(join(hooks, 'pre-push'), 'utf8')).toContain('officehub-agent-runner');
  expect(readFileSync(join(hooks, 'commit-msg'), 'utf8')).toContain('officehub-agent-runner');
  // commit của job vừa chạy đã có trailer → hook có mặt TRƯỚC khi agent commit
  const wt = join(root, 'worktrees/NV120/TEST-45');
  expect((await sh(['git', 'log', '-1', '--format=%B'], wt)).out).toContain('Agent: NV120');
}, 30000);

/** Việc T1 đang ở cột đánh thức bot theo dõi, NV120 (emp-1) là người theo dõi, người làm là người khác (TEST-180). */
const followTask = (over: Record<string, unknown> = {}, followers: any[] = [{ employeeId: 'emp-1' }]) => ({
  ...tasks[T1],
  task: { ...tasks[T1].task, assigneeEmployeeId: 'emp-9', columnId: 'c-deploy', ...over },
  columns: [{ id: 'c-doing' }, { id: 'c-rev', wakeFollowers: true }, { id: 'c-deploy', wakeFollowers: true }],
  followers,
  comments: [{ id: 'c-old', authorName: 'Bot Thử', byBot: true }],
  activities: [],
});
/** Như {@link followTask} nhưng từ lần đọc thứ `from` trở đi có thêm bình luận mới của chính agent (= agent đã làm bước của mình). */
const actedAfter = (detail: any, from: number) => {
  let calls = 0;
  return () =>
    ++calls >= from
      ? { ...detail, comments: [...detail.comments, { id: 'c-new', authorName: 'Bot Thử', byBot: true }] }
      : detail;
};
const followWake = {
  kind: 'follow' as const,
  employee_code: 'NV120',
  project_id: P,
  task_id: T1,
  task_code: 'TEST-45',
};

test('column_entered (TEST-180) mode worktree: không theo dõi / cột không đánh thức → bỏ; chạy ở worktree FOLLOW-<mã> chỉ đọc, không push / PR', async () => {
  const s = runner.agents.get('NV120')!;
  const saved = tasks[T1];
  try {
    tasks[T1] = followTask({}, [{ employeeId: 'nguoi-khac' }]);
    expect(await runner.accept(s, followWake)).toBeNull();
    tasks[T1] = followTask({ columnId: 'c-doing' });
    expect(await runner.accept(s, followWake)).toBeNull();
    // TEST-185: cột chọn bot khác → bỏ; chọn chính agent → chạy (ca dưới dùng cột có agent trong danh sách)
    const picked = (ids: string[]) => {
      const d = followTask();
      return {
        ...d,
        columns: d.columns.map((c: { id: string }) => (c.id === 'c-deploy' ? { ...c, wakeBotIds: ids } : c)),
      };
    };
    tasks[T1] = picked(['emp-khac']);
    expect(await runner.accept(s, followWake)).toBeNull();
    // agent có làm (bình luận mới sau phiên: lần đọc thứ 3 = sau phiên) → runner bình luận chi phí
    const detail = picked(['emp-khac', 'emp-1']);
    getTaskHook = actedAfter(detail, 3);
    const before = comments.length;
    const id = await runner.accept(s, followWake);
    expect(id).not.toBeNull();
    expect(await waitFor(() => store.getJob(id!)?.status === 'done', 15000)).toBe(true);
    const job = store.getJob(id!)!;
    expect(job.kind).toBe('follow');
    expect(job.key).toBe(`NV120:${T1}`); // khoá riêng agent — không đụng job việc của người làm
    expect(job.pr_url).toBeNull();
    expect(comments.length).toBe(before + 1);
    expect(comments.at(-1)!.task).toBe(T1);
    expect(comments.at(-1)!.content).toContain('Phiên theo dõi — repo chỉ đọc, không push');
    const wt = join(root, 'worktrees/NV120/FOLLOW-TEST-45');
    expect(readFileSync(join(root, 'data/jobs', String(id), 'args.txt'), 'utf8')).toContain(wt);
    const prompt = readFileSync(join(root, 'data/jobs', String(id), 'prompt-copy.md'), 'utf8');
    for (const t of ['NGƯỜI THEO DÕI', 'CÓ columnGuide', 'DỪNG NGAY', 'gh pr checkout', 'Repo CHỈ ĐỌC'])
      expect(prompt).toContain(t);
    // commit CLI giả tạo trong worktree không được push lên origin
    expect((await sh(['git', 'ls-remote', '--heads', 'origin'], wt)).out).not.toContain('FOLLOW');
    // hook pre-push chặn mọi push khi phiên chỉ đọc
    const push = await sh(['git', 'push', 'origin', 'HEAD:refs/heads/thu-follow'], wt, {
      ...process.env,
      OFFICEHUB_READONLY: '1',
    } as any);
    expect(push.code).not.toBe(0);
    expect(push.err).toContain('chỉ đọc');
    // lần sau: dùng lại worktree, đưa về origin/main (bỏ commit cũ); agent KHÔNG làm gì (cột không phải bước của nó) → không bình luận
    const head = (await sh(['git', 'rev-parse', 'HEAD'], wt)).out;
    getTaskHook = () => detail;
    const quiet = comments.length;
    const again = await runner.accept(s, followWake);
    expect(await waitFor(() => store.getJob(again!)?.status === 'done', 15000)).toBe(true);
    expect(comments.length).toBe(quiet);
    expect(store.getJob(again!)!.cost_usd).toBe(0.42); // chi phí vẫn ghi (gửi "Mức dùng AI"), chỉ không bình luận lên việc
    const originMain = (await sh(['git', 'rev-parse', 'origin/main'], wt)).out;
    expect((await sh(['git', 'rev-parse', 'HEAD~1'], wt)).out).toBe(originMain);
    expect((await sh(['git', 'rev-parse', 'HEAD'], wt)).out).not.toBe(head);
  } finally {
    tasks[T1] = saved;
    getTaskHook = null;
  }
}, 40000);

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
const noneSetup = async (
  workspace: Record<string, unknown> = { mode: 'none' },
  executorExtra: Record<string, unknown> = {},
) => {
  // CLI giả không đụng git: ghi tham số + thư mục chạy, in dòng JSON kết quả
  const bin = join(root, 'fake-biz-agent.sh');
  writeFileSync(
    bin,
    `#!/bin/sh
[ "$1" = "--version" ] && { echo "fake-biz 1.0"; exit 0; }
cwd="$3"; prompt="$5"
echo "$@" > "$(dirname "$prompt")/args.txt"
cp "$prompt" "$(dirname "$prompt")/prompt-copy.md"
[ -f "$(dirname "$0")/slow" ] && sleep 1
cd "$cwd" || exit 3
echo '{"session_id":"sess-biz","model":"fake-model-1","cost_usd":0.1,"summary":"cwd='$(pwd -P)' files='$(ls -A | wc -l | tr -d " ")'"}'
`,
  );
  chmodSync(bin, 0o755);
  const base = runner.config.agents[0]!;
  const raw = {
    git: { executable: '/khong/co/git' }, // mode none không cần git
    officehub: { mcp_url: runner.config.mcpUrl },
    telegram: { api_url: runner.config.telegramApiUrl, group_chat_id: '-1001234567890' },
    runner: { data_dir: join(root, 'data-none'), worktrees_dir: join(root, 'worktrees'), max_parallel: 1 },
    agents: [
      {
        employee_code: 'NV120',
        telegram_bot: '@agent_dev01_bot',
        telegram_token: TG,
        token: TOKEN,
        workspace,
        executor: {
          kind: 'custom',
          bin,
          home: base.executor.home,
          timeout_min: 1,
          args: ['run', '--cwd', '{cwd}', '--prompt', '{prompt_file}', '--mcp', '{mcp_config}'],
          resume_args: ['--session', '{session_id}'],
          output: { format: 'json' },
          ...executorExtra,
        },
      },
    ],
  };
  const config = parseConfig(raw);
  require('node:fs').mkdirSync(config.dataDir, { recursive: true });
  const st = new Store(join(config.dataDir, 'runner.db'));
  const r = new Runner(config, st);
  const lines = (await r.checkAgents({ only: 'NV120', telegram: false })).map(formatFinding);
  const exec = async () => {
    const s = r.agents.get('NV120')!;
    const id = await r.accept(s, {
      kind: 'task',
      employee_code: 'NV120',
      project_id: P,
      task_id: T1,
      task_code: 'TEST-45',
    });
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

test('none + builtin_tools (TEST-163): doctor cảnh báo có shell, prompt phiên việc có shell + tải ảnh lên', async () => {
  const { lines, exec, dataDir } = await noneSetup({ mode: 'none', builtin_tools: true });
  expect(lines.filter((l) => l.startsWith('✘'))).toEqual([]);
  const text = lines.join('\n');
  expect(text).toContain('workspace none + builtin_tools');
  expect(text).not.toContain('runner không tắt được công cụ có sẵn'); // có shell là chủ ý → không cảnh báo adapter
  const { job } = await exec();
  expect(job.status).toBe('done');
  const prompt = readFileSync(join(dataDir, 'jobs', String(job.id), 'prompt-copy.md'), 'utf8');
  expect(prompt).toContain('shell trong thư mục hiện tại');
  expect(prompt).toContain('create_upload');
  expect(prompt).not.toContain('CHỈ bằng tool MCP');
}, 30000);

test('column_entered (TEST-180) mode none + builtin_tools: thư mục trống có shell; agent làm → bình luận chi phí; tin cũ task_done cũng chạy', async () => {
  const { r, st, dataDir } = await noneSetup({ mode: 'none', builtin_tools: true });
  const s = r.agents.get('NV120')!;
  const saved = tasks[T1];
  try {
    tasks[T1] = followTask({ done: true, columnId: 'c-done' }, [{ employeeId: 'emp-1' }]);
    expect(await r.accept(s, followWake)).toBeNull(); // cột hoàn thành không bật đánh thức
    getTaskHook = actedAfter(followTask(), 3);
    const before = comments.length;
    const id = await r.accept(s, followWake);
    expect(id).not.toBeNull();
    const job = st.claimNext(1, ['NV120'])!;
    expect(job.kind).toBe('follow');
    await r.process(job);
    expect(st.getJob(id!)!.status).toBe('done');
    const prompt = readFileSync(join(dataDir, 'jobs', String(id), 'prompt-copy.md'), 'utf8');
    for (const t of ['NGƯỜI THEO DÕI', 'KHÔNG có repo', 'CHỈ chạy lệnh có trong hướng dẫn'])
      expect(prompt).toContain(t);
    expect(prompt).not.toContain('gh pr checkout');
    expect(comments.length).toBe(before + 1);
    expect(comments.at(-1)!.content).toContain('Phiên theo dõi — có shell, không repo');
  } finally {
    tasks[T1] = saved;
    getTaskHook = null;
  }
}, 30000);

test('column_entered (TEST-180) mode none không shell: chạy được (trước đây bị từ chối), prompt chỉ tool MCP', async () => {
  const { r, st, dataDir } = await noneSetup({ mode: 'none' });
  const s = r.agents.get('NV120')!;
  getTaskHook = () => followTask();
  try {
    const id = await r.accept(s, followWake);
    expect(id).not.toBeNull();
    await r.process(st.claimNext(1, ['NV120'])!);
    expect(st.getJob(id!)!.status).toBe('done');
    const prompt = readFileSync(join(dataDir, 'jobs', String(id), 'prompt-copy.md'), 'utf8');
    expect(prompt).toContain('CHỈ có tool MCP');
    expect(prompt).not.toContain('create_upload');
  } finally {
    getTaskHook = null;
  }
}, 30000);

test('column_entered (TEST-180) mode in_place → không chạy CLI, bình luận lý do', async () => {
  const { r, st } = await inPlaceSetup('agent-repo-ip-follow');
  const s = r.agents.get('NV120')!;
  getTaskHook = () => followTask();
  try {
    const before = comments.length;
    const id = await r.accept(s, followWake);
    expect(id).not.toBeNull();
    await r.process(st.claimNext(1, ['NV120'])!);
    expect(st.getJob(id!)!.status).toBe('skipped');
    expect(st.getJob(id!)!.cli_ran).toBeFalsy();
    expect(comments.length).toBe(before + 1);
    expect(comments.at(-1)!.content).toContain('KHÔNG chạy bước theo dõi');
  } finally {
    getTaskHook = null;
  }
}, 30000);

test('job review / deploy cũ còn trong hàng đợi lúc nâng cấp → chạy bằng handler follow', async () => {
  const { r, st } = await noneSetup({ mode: 'none' });
  getTaskHook = () => followTask();
  try {
    const id = st.enqueue('NV120', `NV120:${T1}`, 'TEST-45', P, 'deploy');
    await r.process(st.claimNext(1, ['NV120'])!);
    expect(st.getJob(id!)!.status).toBe('done');
    expect(st.getJob(id!)!.cli_ran).toBe(1);
  } finally {
    getTaskHook = null;
  }
}, 30000);

test('executor.required_bins (TEST-180): thiếu lệnh trong PATH của agent → doctor báo lỗi, agent tắt', async () => {
  const ok = await noneSetup({ mode: 'none', builtin_tools: true }, { required_bins: ['sh'] });
  expect(ok.lines.filter((l) => l.startsWith('✘'))).toEqual([]);
  expect(ok.lines.join('\n')).toContain('có đủ lệnh: sh');
  const bad = await noneSetup({ mode: 'none', builtin_tools: true }, { required_bins: ['sh', 'khong-co-lenh-nay'] });
  expect(bad.lines.join('\n')).toContain('✘ NV120: thiếu lệnh khong-co-lenh-nay');
  expect(bad.r.agents.get('NV120')!.enabled).toBe(false);
}, 30000);

test('job hết giờ → văn phòng 3D báo lỗi "Hết giờ" (không bị finally ghi đè bằng rảnh); job kế → đang làm rồi rảnh (TEST-121)', async () => {
  const { r, exec } = await noneSetup();
  const ex = r.agents.get('NV120')!.cfg.executor;
  const min = ex.timeoutMin;
  writeFileSync(join(root, 'slow'), '');
  ex.timeoutMin = 0.005; // 300 ms < sleep 1 của CLI giả
  try {
    const before = presence.length;
    const { job } = await exec();
    expect(job.status).toBe('failed');
    expect(job.reason).toBe('hết giờ');
    expect(await waitFor(() => presence.at(-1)?.state === 'error', 3000)).toBe(true);
    expect(presence.at(-1)).toEqual({
      state: 'error',
      task: 'TEST-45 · Sửa nút lưu',
      error: 'Hết giờ',
      taskId: T1,
      projectId: P,
    });
    expect(presence.slice(before).some((p) => p.state === 'working')).toBe(true);
    await Bun.sleep(200);
    expect(presence.at(-1)?.state).toBe('error'); // finally gọi idle() không xoá lỗi
  } finally {
    rmSync(join(root, 'slow'), { force: true });
    ex.timeoutMin = min;
  }
  const before = presence.length;
  const { job } = await exec();
  expect(job.status).toBe('done');
  expect(await waitFor(() => presence.at(-1)?.state === 'idle', 3000)).toBe(true);
  expect(presence.slice(before).map((p) => p.state)).toEqual(['working', 'idle']); // job kế xoá lỗi
  r.stop();
}, 30000);

test('runner dừng giữa phiên → job về hàng đợi (không ghi lỗi, không bình luận "phiên lỗi"); khởi động lại thì chạy tiếp', async () => {
  const { r, st } = await noneSetup();
  writeFileSync(join(root, 'slow'), ''); // CLI giả ngủ 1 giây
  const before = comments.length;
  try {
    const s = r.agents.get('NV120')!;
    await r.accept(s, { kind: 'task', employee_code: 'NV120', project_id: P, task_id: T1, task_code: 'TEST-45' });
    const job = st.claimNext(1, ['NV120'])!;
    const running = r.process(job);
    await Bun.sleep(300);
    r.stop();
    await running;
    const after = st.getJob(job.id)!;
    expect(after.status).toBe('queued');
    expect(after.reason).toBe('runner dừng giữa phiên');
    expect(after.started_at).toBeNull();
    expect(comments.length).toBe(before);
    expect(r.agents.get('NV120')!.presence.state.state).toBe('idle'); // không báo lỗi lên văn phòng 3D
    // lần khởi động sau lấy lại đúng job đó
    expect(st.claimNext(1, ['NV120'])?.id).toBe(job.id);
    st.finish(job.id, 'skipped', { reason: 'dọn test' });
  } finally {
    rmSync(join(root, 'slow'), { force: true });
  }
}, 30000);

// ---------------- bắt bù lúc khởi động (TEST-158) ----------------
test('TEST-158: start → việc đang giao chưa có tin Telegram được chạy luôn; việc chờ người không chạy; khởi động lại không chạy lại; --no-catchup / cấu hình tắt → không hỏi', async () => {
  const T3 = '01a1ced9-0a22-713a-b89d-00000000c158',
    T4 = '01a1ced9-0a22-713a-b89d-00000000d158';
  tasks[T3] = {
    task: { id: T3, projectId: P, assigneeEmployeeId: 'emp-1', done: false, title: 'Việc bắt bù', code: 'TEST-158' },
    dependsOn: [],
  };
  const row = (id: string, code: string, awaitingHuman: boolean) => ({
    id,
    projectId: P,
    code,
    waitingOn: 0,
    awaitingHuman,
    projectActive: true,
  });
  mine = [row(T4, 'TEST-159', true), row(T3, 'TEST-158', false)];
  const jobsOf = (st: Store, key: string) =>
    st.db.query<any, [string]>(`SELECT * FROM jobs WHERE task_id = ?`).all(key);
  try {
    // 1) khởi động: không có tin Telegram nào cho T3 → vẫn chạy
    const a = await noneSetup();
    const before = comments.length;
    const calls = mineCalls;
    const started = a.r.start({ modelCheck: false });
    expect(await waitFor(() => comments.slice(before).some((c) => c.task === T3))).toBe(true);
    expect(await waitFor(() => jobsOf(a.st, T3)[0]?.status === 'done', 3000)).toBe(true);
    expect(mineCalls).toBe(calls + 1);
    expect(jobsOf(a.st, T4)).toEqual([]); // bot đã báo, đang chờ người duyệt
    a.r.stop();
    await started;

    // 2) khởi động lại ngay (cùng runner.db): việc vừa xong không chạy lại
    const b = await noneSetup();
    const again = b.r.start({ modelCheck: false });
    expect(await waitFor(() => mineCalls === calls + 2, 5000)).toBe(true);
    await Bun.sleep(500);
    expect(jobsOf(b.st, T3).length).toBe(1);
    b.r.stop();
    await again;

    // 3) --no-catchup → không hỏi list_my_tasks
    const c = await noneSetup();
    const off = c.r.start({ modelCheck: false, catchUp: false });
    await Bun.sleep(700);
    expect(mineCalls).toBe(calls + 2);
    c.r.stop();
    await off;

    // 4) runner.startup_catchup: false → cũng không hỏi
    const d = await noneSetup();
    d.r.config.startupCatchup = false;
    const offCfg = d.r.start({ modelCheck: false });
    await Bun.sleep(700);
    expect(mineCalls).toBe(calls + 2);
    d.r.stop();
    await offCfg;
  } finally {
    mine = null;
    delete tasks[T3];
  }
}, 60000);

// ---------------- log từng bước lúc khởi động (TEST-159) ----------------
test('TEST-159: checkAgents có progress → mỗi bước báo TRƯỚC kết quả của nó, kết quả báo ngay trùng danh sách trả về', async () => {
  const seen: { kind: 'step' | 'finding'; text: string; agent?: string }[] = [];
  const findings = await runner.checkAgents({
    modelCheck: false,
    progress: {
      step: (text, agent) => seen.push({ kind: 'step', text, agent }),
      finding: (f) => seen.push({ kind: 'finding', text: formatFinding(f), agent: f.agent }),
    },
  });
  expect(seen.filter((e) => e.kind === 'finding').map((e) => e.text)).toEqual(findings.map(formatFinding));
  const steps = seen.filter((e) => e.kind === 'step');
  expect(steps[0]).toMatchObject({ agent: undefined });
  expect(steps[0]!.text).toContain('kiểm tra git của runner');
  expect(steps.slice(1).every((e) => e.agent === 'NV120')).toBe(true);
  const order = [
    'kiểm tra agent 1/1',
    'kiểm tra CLI',
    'kiểm tra token AI',
    'kiểm tra workspace',
    'kiểm tra bot Telegram',
  ];
  const at = order.map((o) => steps.findIndex((e) => e.text.startsWith(o)));
  expect(at.every((i) => i >= 0)).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
  expect(steps.at(-1)!.text).toContain('không chạy thử'); // --no-model-check: nói rõ không chạy thử
  // bước tới trước kết quả của chính nó
  const i = (kind: string, part: string) => seen.findIndex((e) => e.kind === kind && e.text.includes(part));
  expect(i('step', 'kiểm tra git của runner')).toBeLessThan(i('finding', 'git: '));
  expect(i('step', 'kiểm tra token AI')).toBeLessThan(i('finding', 'token AI đúng nhân viên'));
  expect(i('finding', 'CLI custom')).toBeLessThan(i('step', 'kiểm tra token AI')); // kết quả bước trước có trước khi sang bước sau
  expect(i('step', 'kiểm tra bot Telegram')).toBeLessThan(i('finding', 'bot Telegram @agent_dev01_bot'));
}, 30000);

test('TEST-159: start → log đủ 6 giai đoạn đúng thứ tự, bước kiểm tra + kết quả nằm giữa giai đoạn 2 và 3, kết thúc bằng dòng sẵn sàng', async () => {
  const { r } = await noneSetup();
  const lines: any[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => {
    try {
      lines.push(JSON.parse(String(a[0])));
    } catch {
      /* dòng không phải log JSON */
    }
  };
  let started: Promise<void>;
  try {
    started = r.start({ modelCheck: false, catchUp: false });
    expect(await waitFor(() => lines.some((l) => String(l.msg).startsWith('khởi động 6/6')), 10000)).toBe(true);
  } finally {
    console.log = orig;
    r.stop();
  }
  await started!;
  const msgs = lines.map((l) => String(l.msg));
  const phases = msgs.filter((m) => m.startsWith('khởi động '));
  expect(phases.map((m) => m.slice(0, 'khởi động n/6'.length))).toEqual(
    [1, 2, 3, 4, 5, 6].map((n) => `khởi động ${n}/6`),
  );
  expect(phases[3]).toContain('bỏ qua bắt bù việc đang giao (--no-catchup)');
  expect(phases[5]).toContain('sẵn sàng');
  const at = (part: string) => msgs.findIndex((m) => m.includes(part));
  for (const part of [
    '→ kiểm tra git của runner',
    '→ kiểm tra CLI custom',
    '→ kiểm tra token AI',
    '✔ NV120: token AI đúng nhân viên',
  ]) {
    expect(at(part)).toBeGreaterThan(at('khởi động 2/6'));
    expect(at(part)).toBeLessThan(at('khởi động 3/6'));
  }
  expect(at('→ đang nghe Telegram')).toBeGreaterThan(at('khởi động 3/6'));
  expect(lines.find((l) => String(l.msg).startsWith('khởi động 6/6'))).toMatchObject({
    agents: 'NV120',
    maxParallel: 1,
  });
}, 30000);

// ---------------- chat_mention (TEST-81): người thật @nhắc bot trong chat → phiên ngắn chỉ có tool MCP ----------------
test('chat_mention: tin Telegram → job chat trong thư mục riêng của hội thoại, không bình luận vào việc, nối phiên ≤ 10 phút; đã đọc hết → bỏ', async () => {
  const { r, st, dataDir } = await noneSetup();
  const s = r.agents.get('NV120')!;
  const C = '01a1d000-0000-7000-8000-00000000c0de';
  const tgMsg = (o: object) =>
    ({ message_id: 1, date: 0, chat: { id: -1001234567890, type: 'supergroup' }, text: JSON.stringify(o) }) as any;
  const wake = tgMsg({
    employee_code: 'NV120',
    event: 'chat_mention',
    conversation_id: C,
    message_id: '01a1d000-0000-7000-8000-00000000beef',
  });
  const runNext = async () => {
    const job = st.claimNext(1, ['NV120'])!;
    await r.process(job);
    return st.getJob(job.id)!;
  };
  const file = (job: { id: number }, name: string) => readFileSync(join(dataDir, 'jobs', String(job.id), name), 'utf8');

  chats = [{ conversation: C, type: 'room', unread: 0, mentionedUnread: 0 }];
  expect(await r.onMessage(s, wake)).toBeNull(); // không còn tin nhắc chưa đọc → không xếp hàng

  chats = [{ conversation: C, type: 'room', unread: 3, mentionedUnread: 1 }];
  const before = comments.length,
    presenceBefore = presence.length,
    activityBefore = activity.length;
  const id = await r.onMessage(s, wake);
  expect(id).not.toBeNull();
  expect(await r.onMessage(s, wake)).toBeNull(); // tin lặp khi job còn chờ → gộp
  const job = await runNext();
  expect(job).toMatchObject({
    id: id!,
    kind: 'chat',
    status: 'done',
    key: `NV120:${C}`,
    cost_usd: 0.1,
    pr_url: null,
  });
  expect(comments.length).toBe(before); // không bình luận vào việc
  const work = join(dataDir, 'work/NV120', `chat-${C}`);
  expect(file(job, 'args.txt')).toContain(work);
  expect(file(job, 'args.txt')).not.toContain('--session');
  const prompt = file(job, 'prompt-copy.md');
  expect(prompt).toContain(`read_chat ${C}`);
  expect(prompt).not.toContain('NỐI TIẾP');
  await Bun.sleep(300);
  expect(presence.slice(presenceBefore).some((p) => p.state === 'working')).toBe(false); // chat không đổi trạng thái 3D
  // Xem trực tiếp: phiên chat chỉ có nhãn chung, không có nội dung / id hội thoại
  expect(
    activity
      .slice(activityBefore)
      .filter((e) => e.kind === 'session_start')
      .map((e) => e.task),
  ).toEqual(['Trả lời tin nhắn']);
  // Mức dùng AI (TEST-135): phiên chat cũng được gửi, không có id / mã việc
  // mỗi test dựng runner.db mới (số job đếm lại từ 1) → so cả mã DB trong sourceId
  const sid = `:${st.dbId()}:NV120:${job.id}`;
  expect(await waitFor(() => usage.some((x) => x.sourceId.endsWith(sid)), 3000)).toBe(true);
  const u = usage.find((x) => x.sourceId.endsWith(sid));
  expect(u).toMatchObject({ kind: 'chat', status: 'done', costUsd: 0.1 });
  expect(u.taskId).toBeUndefined();
  expect(u.taskCode).toBeUndefined();

  // nhắc lần nữa trong 10 phút → nối phiên cũ của hội thoại
  await r.onMessage(s, wake);
  const second = await runNext();
  expect(file(second, 'args.txt')).toContain('--session sess-biz');
  expect(file(second, 'prompt-copy.md')).toContain('NỐI TIẾP');
  // phiên cũ quá 10 phút (TEST-142) → mở phiên mới
  st.db.run(`UPDATE task_sessions SET updated_at = ? WHERE task_id = ?`, [
    new Date(Date.now() - 11 * 60_000).toISOString(),
    `NV120:${C}`,
  ]);
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
    const id = (await r.accept(s, { kind: 'chat', ...w }))!;
    const job = st.claimNext(1, ['NV120'])!;
    const running = r.process(job);
    await Bun.sleep(300);
    expect(await r.accept(s, { kind: 'chat', ...w })).toBeNull(); // đang chạy → không xếp thêm, đánh dấu rerun
    expect(st.getJob(id)!.rerun).toBe(1);
    await running;
    expect(st.getJob(id)!.status).toBe('done');
    expect(readFileSync(join(dataDir, 'jobs', String(id), 'prompt-copy.md'), 'utf8')).toContain('read_chat office');
    const next = st.db
      .query<any, [string]>(`SELECT * FROM jobs WHERE task_id = ? AND status = 'queued'`)
      .get(`NV120:${OFFICE}`);
    expect(next?.kind).toBe('chat'); // lượt chạy thêm đã vào hàng đợi
    st.finish(next.id, 'skipped');
  } finally {
    rmSync(join(root, 'slow'), { force: true });
  }
}, 30000);

test('việc: tin đánh thức mới tới khi job cùng việc đang chạy (người trả việc / bình luận) → xong thì chạy thêm một lượt, nối phiên', async () => {
  const { r, st, dataDir } = await noneSetup();
  const s = r.agents.get('NV120')!;
  const wake = { kind: 'task' as const, employee_code: 'NV120', project_id: P, task_id: T1, task_code: 'TEST-45' };
  st.db.run(`DELETE FROM jobs WHERE task_id = ? AND status IN ('queued', 'running')`, [T1]);
  writeFileSync(join(root, 'slow'), ''); // CLI giả chạy 1 giây
  try {
    const id = (await r.accept(s, wake))!;
    const running = r.process(st.claimNext(1, ['NV120'])!);
    await Bun.sleep(300);
    expect(await r.accept(s, wake)).toBeNull(); // đang chạy → không xếp thêm, đánh dấu rerun
    expect(st.getJob(id)!.rerun).toBe(1);
    await running;
    expect(st.getJob(id)!.status).toBe('done');
    const next = st.db.query<any, [string]>(`SELECT * FROM jobs WHERE task_id = ? AND status = 'queued'`).get(T1);
    expect(next).toMatchObject({ kind: 'task', task_code: 'TEST-45' }); // lượt chạy thêm đã vào hàng đợi
    rmSync(join(root, 'slow'), { force: true });
    await r.process(st.claimNext(1, ['NV120'])!);
    expect(st.getJob(next.id)!.status).toBe('done');
    expect(st.getJob(next.id)!.rerun).toBeNull(); // không có tin mới giữa lượt này → không chạy thêm nữa
    expect(readFileSync(join(dataDir, 'jobs', String(next.id), 'args.txt'), 'utf8')).toContain('--session sess-biz');
    expect(st.db.query(`SELECT 1 FROM jobs WHERE task_id = ? AND status = 'queued'`).get(T1)).toBeNull();
  } finally {
    rmSync(join(root, 'slow'), { force: true });
  }
}, 30000);

test('nhận tin: không hỏi lại được OfficeHub → thử lại theo nhịp rồi xếp hàng; hết lượt thì bỏ; lệnh run và stop() không thử lại', async () => {
  const { r, st } = await noneSetup();
  const s = r.agents.get('NV120')!;
  const wake = { kind: 'task' as const, employee_code: 'NV120', project_id: P, task_id: T1, task_code: 'TEST-45' };
  const queued = () => st.db.query<any, [string]>(`SELECT * FROM jobs WHERE task_id = ? AND status = 'queued'`).get(T1);
  st.db.run(`DELETE FROM jobs WHERE task_id = ? AND status IN ('queued', 'running')`, [T1]);
  r.admitRetryMs = [50, 50];
  try {
    // lỗi 2 lần → lần thử lại thứ 2 thành công
    getTaskFails = 2;
    expect(await r.accept(s, wake)).toBeNull();
    expect(await waitFor(() => !!queued(), 3000)).toBe(true);
    expect(getTaskFails).toBe(0);
    st.finish(queued().id, 'skipped');

    // lỗi quá số lượt thử lại → bỏ hẳn
    getTaskFails = 5;
    await r.accept(s, wake);
    await Bun.sleep(400);
    expect(getTaskFails).toBe(2); // 1 lần đầu + 2 lần thử lại
    expect(queued()).toBeNull();

    // lệnh run: không thử lại
    getTaskFails = 1;
    expect(await r.runNow(s, wake)).toEqual({ problem: 'Việc không chạy được (xem log ở trên)' });
    await Bun.sleep(200);
    expect(queued()).toBeNull();

    // stop() huỷ lần thử lại đang chờ
    getTaskFails = 1;
    r.admitRetryMs = [150];
    await r.accept(s, wake);
    r.stop();
    await Bun.sleep(300);
    expect(queued()).toBeNull();
  } finally {
    getTaskFails = 0;
  }
}, 30000);
