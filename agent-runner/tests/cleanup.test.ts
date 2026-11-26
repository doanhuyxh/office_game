// Dọn dữ liệu việc đã xong khỏi máy (TEST-247): Cleaner với repo git thật (origin là repo bare tạm) + OfficeHub giả (chỉ get_task).
import { afterAll, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig, type RunnerConfig } from '../src/config';
import type { AgentState } from '../src/core/agent';
import { Cleaner, cleanupDue } from '../src/core/cleanup';
import { jobDir, workDir } from '../src/core/paths';
import { claudeProjectDir } from '../src/executor/adapters/claude';
import type { CleanupCandidate } from '../src/store';
import { Store } from '../src/store';
import { Git, prepareWorktree, sh } from '../src/workspace';
import { baseRaw } from './fixtures/config';

const root = mkdtempSync(join(tmpdir(), 'runner-cleanup-'));
const DAY = 86_400_000;
const git = new Git(Bun.which('git')!);

async function run(cmd: string[], cwd: string) {
  const r = await sh(cmd, cwd);
  if (r.code !== 0) throw new Error(`${cmd.join(' ')}: ${r.err}`);
  return r.out;
}

afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
let dir: string, repo: string, home: string, config: RunnerConfig, store: Store;
/** Trạng thái `done` mà get_task giả trả theo id việc; không có → lỗi (việc đã xoá / mạng). */
let doneOf: Record<string, boolean>;
let taskCalls: string[];
let transcriptsOn: boolean;

beforeEach(async () => {
  dir = join(root, `c${++n}`);
  mkdirSync(dir);
  const origin = join(dir, 'origin.git'),
    seed = join(dir, 'seed');
  repo = join(dir, 'repo');
  home = join(dir, 'home');
  await run(['git', 'init', '--bare', '-b', 'main', origin], dir);
  await run(['git', 'init', '-b', 'main', seed], dir);
  writeFileSync(join(seed, 'README.md'), 'x\n');
  writeFileSync(join(seed, '.gitignore'), 'node_modules/\n');
  await run(['git', 'add', '.'], seed);
  await run(['git', '-c', 'user.name=a', '-c', 'user.email=a@b', 'commit', '-m', 'init'], seed);
  await run(['git', 'remote', 'add', 'origin', origin], seed);
  await run(['git', 'push', 'origin', 'main'], seed);
  await run(['git', 'clone', origin, repo], dir);
  await run(['git', 'config', 'user.name', 'Bot'], repo);
  await run(['git', 'config', 'user.email', 'bot@example.vn'], repo);

  const raw = baseRaw() as any;
  raw.runner.data_dir = join(dir, 'data');
  raw.runner.worktrees_dir = join(dir, 'worktrees');
  raw.agents[0].projects[0].repo = repo;
  raw.agents[0].executor.home = home;
  config = parseConfig(raw);
  store = new Store(':memory:');
  doneOf = {};
  taskCalls = [];
  transcriptsOn = false;
});

function cleaner(nowMs = Date.now() + 2 * DAY) {
  const s = {
    cfg: config.agents[0]!,
    hub: {
      getTask: async (id: string) => {
        taskCalls.push(id);
        if (!(id in doneOf)) throw new Error('get_task: Không tìm thấy việc');
        return { task: { id, done: doneOf[id] } };
      },
    },
    transcripts: transcriptsOn ? {} : undefined,
  } as unknown as AgentState;
  return new Cleaner(config, store, git, new Map([['NV120', s]]), () => nowMs);
}

/** Một phiên đã chạy xong của khoá `key` (job + task_sessions), id phiên `session`. */
function ranSession(
  key: string,
  cwd: string,
  session: string,
  o: { kind?: 'task' | 'chat' | 'follow'; branch?: string } = {},
) {
  store.enqueue('NV120', key, key, 'p', o.kind ?? 'task');
  const job = store.claimNext(1, ['NV120'])!;
  store.finish(job.id, 'done', { session_id: session });
  store.saveSession(key, 'NV120', session, o.branch ?? '', cwd);
  return job.id;
}

/** Transcript giả của phiên (file .jsonl + thư mục phụ) trong HOME của agent. */
function transcript(cwd: string, session: string) {
  const d = claudeProjectDir(home, cwd);
  mkdirSync(join(d, session), { recursive: true });
  writeFileSync(join(d, `${session}.jsonl`), '{"x":1}\n'.repeat(100));
  writeFileSync(join(d, session, 'tool.txt'), 'y');
  return d;
}

/** Worktree việc có một commit, đã push nhánh lên origin (như runner làm sau phiên). */
async function pushedWorktree(code: string) {
  const ws = await prepareWorktree(git, repo, config.worktreesDir, 'NV120', code, 'main');
  writeFileSync(join(ws.path, 'a.txt'), code);
  await run(['git', 'add', '.'], ws.path);
  await run(['git', 'commit', '-m', code], ws.path);
  await run(['git', 'push', 'origin', ws.branch], ws.path);
  mkdirSync(join(ws.path, 'node_modules', 'big'), { recursive: true });
  writeFileSync(join(ws.path, 'node_modules', 'big', 'f.bin'), Buffer.alloc(50_000));
  return ws;
}

test('việc đã Xong: --dry-run chỉ liệt kê; chạy thật xoá worktree + nhánh local + mọi transcript của cwd, đánh dấu đã dọn', async () => {
  const ws = await pushedWorktree('TEST-1');
  ranSession('t1', ws.path, 's1', { branch: ws.branch });
  ranSession('t1', ws.path, 's2', { branch: ws.branch }); // phiên mới sau 10 phút → transcript thứ hai
  const tdir = transcript(ws.path, 's1');
  transcript(ws.path, 's2');
  doneOf.t1 = true;

  const dry = await cleaner().run({ dryRun: true });
  expect(dry.items).toHaveLength(1);
  expect(dry.items[0]).toMatchObject({ key: 't1', reason: 'việc đã Xong', cwd: ws.path });
  expect(dry.items[0]!.transcripts).toContain(tdir);
  expect(dry.bytes).toBeGreaterThan(50_000);
  expect(existsSync(ws.path)).toBe(true);

  const r = await cleaner().run();
  expect(r.items[0]!.kept).toBeUndefined();
  expect(existsSync(ws.path)).toBe(false);
  expect(existsSync(tdir)).toBe(false);
  expect(await run(['git', 'branch', '--list', ws.branch], repo)).toBe('');
  expect(await run(['git', 'worktree', 'list'], repo)).not.toContain('TEST-1');
  expect(store.session('t1')).toMatchObject({ session_id: null });
  expect(store.session('t1')!.cleaned_at).not.toBeNull();

  // lượt sau không xét lại; việc mở lại → phiên mới bỏ dấu đã dọn, nhánh lấy lại từ origin
  expect((await cleaner().run()).items).toHaveLength(0);
  const again = await prepareWorktree(git, repo, config.worktreesDir, 'NV120', 'TEST-1', 'main');
  expect(again.existing).toBe('origin');
  store.saveSession('t1', 'NV120', 's3', again.branch, again.path);
  expect(store.session('t1')!.cleaned_at).toBeNull();
});

test('việc chưa Xong, chưa quá stale_days → không đụng; get_task lỗi → lượt sau; chưa quá after_done_hours → không hỏi OfficeHub', async () => {
  const ws = await pushedWorktree('TEST-2');
  ranSession('t2', ws.path, 's1', { branch: ws.branch });
  ranSession('t2b', join(config.worktreesDir, 'NV120', 'TEST-2B'), 's9');
  doneOf.t2 = false; // t2b: get_task lỗi
  expect((await cleaner().run()).items).toHaveLength(0);
  expect(taskCalls.sort()).toEqual(['t2', 't2b']);
  expect(existsSync(ws.path)).toBe(true);

  taskCalls = [];
  expect((await cleaner(Date.now() + 3_600_000).run()).items).toHaveLength(0); // mới chạy 1 giờ trước
  expect(taskCalls).toEqual([]);
});

test('worktree còn commit chưa push / thay đổi chưa commit → giữ lại, không xoá gì', async () => {
  const ws = await pushedWorktree('TEST-3');
  ranSession('t3', ws.path, 's1', { branch: ws.branch });
  transcript(ws.path, 's1');
  doneOf.t3 = true;
  writeFileSync(join(ws.path, 'b.txt'), 'local');
  await run(['git', 'add', '.'], ws.path);
  await run(['git', 'commit', '-m', 'chưa push'], ws.path);
  let r = await cleaner().run();
  expect(r.items[0]!.kept).toBe('1 commit chưa có trên origin');
  expect(r.bytes).toBe(0);
  expect(existsSync(ws.path)).toBe(true);
  expect(existsSync(claudeProjectDir(home, ws.path))).toBe(true);

  await run(['git', 'push', 'origin', ws.branch], ws.path);
  writeFileSync(join(ws.path, 'c.txt'), 'dirty');
  r = await cleaner().run();
  expect(r.items[0]!.kept).toBe('còn thay đổi chưa commit');
  expect(store.session('t3')!.cleaned_at).toBeNull();
});

test('in_place (cwd là repo dùng chung): chỉ xoá transcript của các phiên runner, không đụng repo / phiên khác', async () => {
  ranSession('t4', repo, 's1');
  const tdir = transcript(repo, 's1');
  transcript(repo, 'human-session');
  doneOf.t4 = true;
  const r = await cleaner().run();
  expect(r.items[0]).toMatchObject({ key: 't4', reason: 'việc đã Xong' });
  expect(r.items[0]!.cwd).toBeUndefined();
  expect(r.items[0]!.kept).toBeUndefined();
  expect(existsSync(join(tdir, 's1.jsonl'))).toBe(false);
  expect(existsSync(join(tdir, 's1'))).toBe(false);
  expect(existsSync(join(tdir, 'human-session.jsonl'))).toBe(true);
  expect(existsSync(join(repo, 'README.md'))).toBe(true);
});

test('chat / họp: quá after_done_hours là dọn thư mục chạy dưới data_dir, không hỏi OfficeHub', async () => {
  const cwd = workDir(config.dataDir, 'NV120', 'chat-c1');
  mkdirSync(cwd, { recursive: true });
  ranSession('NV120:c1', cwd, 's1', { kind: 'chat' });
  const tdir = transcript(cwd, 's1');
  const r = await cleaner().run();
  expect(r.items[0]).toMatchObject({ reason: 'phiên chat / họp đã xong', cwd });
  expect(existsSync(cwd)).toBe(false);
  expect(existsSync(tdir)).toBe(false);
  expect(taskCalls).toEqual([]);
});

test('lâu không chạy (quá stale_days) → dọn không cần hỏi; job đang chờ / transcript chưa gửi → giữ', async () => {
  const ws = await pushedWorktree('TEST-5');
  ranSession('t5', ws.path, 's1', { branch: ws.branch });
  const r = await cleaner(Date.now() + 31 * DAY).run();
  expect(r.items[0]).toMatchObject({ key: 't5', reason: 'không chạy 31 ngày' });
  expect(taskCalls).toEqual([]);
  expect(existsSync(ws.path)).toBe(false);

  const ws6 = await pushedWorktree('TEST-6');
  ranSession('t6', ws6.path, 's1', { branch: ws6.branch });
  const ws7 = await pushedWorktree('TEST-7');
  ranSession('t7', ws7.path, 's1', { branch: ws7.branch });
  store.markTranscript('t7', 'task', null);
  store.enqueue('NV120', 't6', 'TEST-6', 'p'); // việc bị mở lại, đang chờ chạy
  transcriptsOn = true;
  const kept = await cleaner(Date.now() + 31 * DAY).run();
  expect(kept.items.map((i) => i.key)).toEqual(['t7']);
  expect(kept.items[0]!.kept).toBe('transcript chưa gửi lên cloud');
  expect(existsSync(ws6.path)).toBe(true);
  expect(existsSync(ws7.path)).toBe(true);
});

test('log job: thư mục jobs/{id} của job kết thúc quá logs_keep_days bị xoá, job gần đây giữ', async () => {
  const id = ranSession('NV120:c2', workDir(config.dataDir, 'NV120', 'chat-c2'), 's1', { kind: 'chat' });
  mkdirSync(jobDir(config.dataDir, id), { recursive: true });
  writeFileSync(join(jobDir(config.dataDir, id), 'output.log'), 'x'.repeat(1000));
  expect((await cleaner(Date.now() + 2 * DAY).run()).logDirs).toBe(0);
  const r = await cleaner(Date.now() + 15 * DAY).run();
  expect(r.logDirs).toBe(1);
  expect(existsSync(jobDir(config.dataDir, id))).toBe(false);
});

test('cleanupDue + cấu hình runner.cleanup', () => {
  const cfg = { enabled: true, afterDoneHours: 24, staleDays: 30, logsKeepDays: 14 };
  const row = (kind: string, ageH: number) =>
    ({
      key: kind === 'task' ? 't' : 'NV1:x',
      job_kind: kind,
      updated_at: new Date(0).toISOString(),
      ageH,
    }) as unknown as CleanupCandidate;
  expect(cleanupDue(row('task', 0), 23 * 3_600_000, cfg, true)).toBeUndefined();
  expect(cleanupDue(row('task', 0), 25 * 3_600_000, cfg, true)).toBe('việc đã Xong');
  expect(cleanupDue(row('task', 0), 25 * 3_600_000, cfg, false)).toBeUndefined();
  expect(cleanupDue(row('follow', 0), 25 * 3_600_000, cfg)).toBeUndefined();
  expect(cleanupDue(row('meeting', 0), 25 * 3_600_000, cfg)).toBe('phiên chat / họp đã xong');

  expect(config.cleanup).toEqual({ enabled: true, afterDoneHours: 24, staleDays: 30, logsKeepDays: 14 });
  const raw = baseRaw() as any;
  raw.runner.cleanup = { enabled: false, after_done_hours: 0, stale_days: 7 };
  expect(parseConfig(raw).cleanup).toEqual({ enabled: false, afterDoneHours: 0, staleDays: 7, logsKeepDays: 14 });
  raw.runner.cleanup = { enabled: 'yes', stale_days: 0 };
  expect(() => parseConfig(raw)).toThrow('runner.cleanup.enabled');
  expect(() => parseConfig(raw)).toThrow('runner.cleanup.stale_days là số từ 1 đến 365');
});
