import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { type CleanupConfig, isInside, type RunnerConfig } from '../config';
import { adapters } from '../executor/run';
import { errText, log } from '../log';
import { CLEANUP_MAX_TASK_CHECKS } from '../policy';
import { type CleanupCandidate, type JobKind, type Store, taskIdOf } from '../store';
import { type Git, removeWorktree, worktreeLeftovers } from '../workspace';
import type { AgentState } from './agent';
import { agentHome } from './env';
import { jobDir } from './paths';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Một phiên (khoá job) đã / sẽ được dọn, hoặc bị giữ lại vì chưa an toàn. */
export interface CleanupItem {
  agent: string;
  /** Khoá job (`task_sessions.task_id`). */
  key: string;
  /** Vì sao dọn: việc đã Xong / lâu không chạy / phiên chat, họp đã xong. */
  reason: string;
  /** Thư mục chạy runner sẽ xoá (worktree / thư mục dưới `data_dir/work`); không có = chỉ xoá transcript (repo dùng chung, mode in_place). */
  cwd?: string;
  /** File / thư mục transcript của CLI sẽ xoá (chỉ cái đang có). */
  transcripts: string[];
  bytes: number;
  /** Có giá trị = KHÔNG dọn, lý do (còn thay đổi chưa commit, commit chưa push, transcript chưa gửi, lỗi git…). */
  kept?: string;
}

export interface CleanupReport {
  items: CleanupItem[];
  /** Thư mục log `jobs/{id}` đã / sẽ xoá. */
  logDirs: number;
  logBytes: number;
  /** Tổng dung lượng thu lại (không tính phiên bị giữ). */
  bytes: number;
}

type Workspace = 'worktree' | 'work' | 'shared';

/**
 * Phiên đến hạn dọn chưa (TEST-247), chưa xét an toàn: trả lý do, `undefined` = chưa. `done` = kết quả `get_task` (chỉ cần với việc chưa
 * quá `staleDays`; chưa hỏi → undefined).
 */
export function cleanupDue(c: CleanupCandidate, nowMs: number, cfg: CleanupConfig, done?: boolean): string | undefined {
  const ageMs = nowMs - Date.parse(c.updated_at);
  if (!(ageMs >= cfg.afterDoneHours * HOUR_MS)) return undefined;
  if (!taskIdOf({ kind: (c.job_kind ?? 'task') as JobKind, key: c.key })) return 'phiên chat / họp đã xong';
  if (ageMs >= cfg.staleDays * DAY_MS) return `không chạy ${Math.floor(ageMs / DAY_MS)} ngày`;
  return done ? 'việc đã Xong' : undefined;
}

/** Dung lượng một file / cây thư mục (không đi theo symlink). Lỗi đọc → bỏ qua phần đó. */
export function diskUsage(path: string): number {
  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(path);
  } catch {
    return 0;
  }
  if (!st.isDirectory()) return st.size;
  let total = 0;
  try {
    for (const name of readdirSync(path)) total += diskUsage(join(path, name));
  } catch {
    /* không đọc được thư mục */
  }
  return total;
}

/** "1.2 GB" / "340 MB" / "12 KB". */
export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

/**
 * Dọn dữ liệu việc đã xong khỏi máy (TEST-247): worktree + nhánh local, transcript CLI, thư mục chạy dưới `data_dir/work`, log job cũ.
 * Không mất gì: nhánh có trên origin (máy làm tiếp thì lấy lại — TEST-142), transcript có trên cloud (TEST-144), bộ nhớ của việc là bình
 * luận Bàn giao trên OfficeHub. Còn thay đổi chưa commit / commit chưa push / transcript chưa gửi → giữ lại, lượt sau xét tiếp.
 */
export class Cleaner {
  constructor(
    private readonly config: RunnerConfig,
    private readonly store: Store,
    private readonly git: Git,
    private readonly agents: Map<string, AgentState>,
    private readonly now: () => number = Date.now,
  ) {}

  async run(o: { dryRun?: boolean; agent?: string } = {}): Promise<CleanupReport> {
    const cfg = this.config.cleanup;
    const nowMs = this.now();
    const report: CleanupReport = { items: [], logDirs: 0, logBytes: 0, bytes: 0 };
    let taskChecks = 0;
    const before = new Date(nowMs - cfg.afterDoneHours * HOUR_MS).toISOString();
    for (const c of this.store.cleanupCandidates(before)) {
      if (c.active || (o.agent && c.agent !== o.agent)) continue;
      const s = this.agents.get(c.agent);
      if (!s) continue; // agent không còn trong cấu hình: không biết HOME / CLI → không đụng
      let reason = cleanupDue(c, nowMs, cfg);
      if (!reason) {
        const taskId = taskIdOf({ kind: (c.job_kind ?? 'task') as JobKind, key: c.key });
        if (!taskId || taskChecks >= CLEANUP_MAX_TASK_CHECKS) continue;
        taskChecks++;
        try {
          const detail = await s.hub.getTask(taskId);
          reason = cleanupDue(c, nowMs, cfg, detail?.task?.done === true);
        } catch {
          continue; // không hỏi được (mạng, việc đã xoá…) → lượt sau; quá staleDays thì dọn không cần hỏi
        }
        if (!reason) continue;
      }
      const item = await this.cleanOne(s, c, reason, !!o.dryRun);
      report.items.push(item);
      if (!item.kept) report.bytes += item.bytes;
    }
    this.cleanLogs(nowMs, o, report);
    report.bytes += report.logBytes;
    return report;
  }

  private workspaceOf(cwd: string): Workspace {
    const owned = (root: string) => !!cwd && isInside(cwd, root) && resolve(cwd) !== resolve(root);
    if (owned(this.config.worktreesDir)) return 'worktree';
    if (owned(join(this.config.dataDir, 'work'))) return 'work';
    return 'shared';
  }

  private async cleanOne(s: AgentState, c: CleanupCandidate, reason: string, dryRun: boolean): Promise<CleanupItem> {
    const item: CleanupItem = { agent: c.agent, key: c.key, reason, transcripts: [], bytes: 0 };
    const keep = (why: string) => {
      item.kept = why;
      log('info', 'dọn dẹp: giữ lại', { agent: c.agent, key: c.key, reason: why });
      return item;
    };
    if (c.transcript_pending === 1 && s.transcripts) return keep('transcript chưa gửi lên cloud');

    const kind = this.workspaceOf(c.worktree);
    const cwdExists = kind !== 'shared' && existsSync(c.worktree);
    // Worktree việc (không phải FOLLOW-: phiên theo dõi chỉ đọc, không push) → không còn gì chưa có trên origin mới xoá
    const follow = basename(c.worktree).startsWith('FOLLOW-');
    if (kind === 'worktree' && cwdExists && !follow) {
      try {
        const left = await worktreeLeftovers(this.git, c.worktree);
        if (left) return keep(left);
      } catch (e) {
        return keep(`không kiểm tra được worktree: ${errText(e)}`);
      }
    }

    // Đường dẫn transcript tính TRƯỚC khi xoá thư mục chạy (cần đường dẫn thật của cwd)
    const adapter = adapters[s.cfg.executor.kind];
    const home = agentHome(s.cfg);
    const sessions = [
      ...new Set([c.session_id, ...this.store.sessionIdsOf(c.key, c.agent)].filter(Boolean)),
    ] as string[];
    const paths =
      kind !== 'shared' && adapter?.cwdPaths
        ? adapter.cwdPaths(home, c.worktree)
        : sessions.flatMap((id) => adapter?.sessionPaths?.(home, c.worktree, id) ?? []);
    item.transcripts = [...new Set(paths)].filter((p) => existsSync(p));
    if (cwdExists) item.cwd = c.worktree;
    item.bytes = [...item.transcripts, ...(item.cwd ? [item.cwd] : [])].reduce((n, p) => n + diskUsage(p), 0);
    if (dryRun) return item;

    // Job mới của khoá này vừa được nhận trong lúc hỏi OfficeHub → để lượt sau
    if (this.store.hasActiveJob(c.key)) return keep('vừa có job mới');
    try {
      if (item.cwd && kind === 'worktree') {
        // Nhánh local của việc xoá luôn (có trên origin); worktree theo dõi detached → không có nhánh
        await removeWorktree(this.git, item.cwd, follow ? undefined : c.branch || undefined);
      } else if (item.cwd) rmSync(item.cwd, { recursive: true, force: true });
      for (const p of item.transcripts) rmSync(p, { recursive: true, force: true });
    } catch (e) {
      return keep(`xoá lỗi: ${errText(e)}`);
    }
    this.store.markCleaned(c.key);
    log('info', 'dọn dẹp: đã xoá', { agent: c.agent, key: c.key, reason, size: formatBytes(item.bytes) });
    return item;
  }

  /** Thư mục log `jobs/{id}` của job đã kết thúc quá `logsKeepDays` ngày. */
  private cleanLogs(nowMs: number, o: { dryRun?: boolean; agent?: string }, report: CleanupReport) {
    const before = new Date(nowMs - this.config.cleanup.logsKeepDays * DAY_MS).toISOString();
    for (const id of this.store.jobsFinishedBefore(before)) {
      if (o.agent && this.store.getJob(id)?.agent !== o.agent) continue;
      const dir = jobDir(this.config.dataDir, id);
      if (!existsSync(dir)) continue;
      report.logDirs++;
      report.logBytes += diskUsage(dir);
      if (!o.dryRun) rmSync(dir, { recursive: true, force: true });
    }
  }
}
