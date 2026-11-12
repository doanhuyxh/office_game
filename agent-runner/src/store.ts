import { Database } from 'bun:sqlite';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'skipped';

export interface Job {
  id: number;
  agent: string;
  task_id: string;
  task_code: string;
  project_id: string;
  status: JobStatus;
  reason: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  session_id: string | null;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  turns: number | null;
  pr_url: string | null;
}

/**
 * SQLite của runner (`{data_dir}/runner.db`): hàng đợi job, khoá theo task_id (một task chỉ một job đang chờ / chạy — index unique có điều kiện),
 * phiên CLI của từng việc (nối phiên khi việc bị trả về), offset getUpdates của từng bot, chi phí.
 */
export class Store {
  readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT NOT NULL, task_id TEXT NOT NULL, task_code TEXT NOT NULL, project_id TEXT NOT NULL,
        status TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
        session_id TEXT, cost_usd REAL, input_tokens INTEGER, output_tokens INTEGER, turns INTEGER, pr_url TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_jobs_active ON jobs(task_id) WHERE status IN ('queued', 'running');
      CREATE TABLE IF NOT EXISTS task_sessions (
        task_id TEXT PRIMARY KEY, agent TEXT NOT NULL, session_id TEXT, branch TEXT NOT NULL, worktree TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tg_offsets (bot TEXT PRIMARY KEY, next_offset INTEGER NOT NULL);
    `);
  }

  private now() { return new Date().toISOString(); }

  /** Job đang chạy khi runner tắt đột ngột → đưa lại vào hàng đợi (phiên cũ nối tiếp được nếu CLI hỗ trợ). */
  recoverRunning(): number {
    return this.db.run(`UPDATE jobs SET status = 'queued', started_at = NULL, reason = 'runner khởi động lại' WHERE status = 'running'`).changes;
  }

  /** Thêm job; task đã có job đang chờ / chạy → null (khoá theo task_id, không chạy trùng). */
  enqueue(agent: string, taskId: string, taskCode: string, projectId: string): number | null {
    try {
      const r = this.db.run(`INSERT INTO jobs (agent, task_id, task_code, project_id, status, created_at) VALUES (?, ?, ?, ?, 'queued', ?)`,
        [agent, taskId, taskCode, projectId, this.now()]);
      return Number(r.lastInsertRowid);
    } catch (e) {
      if (String(e).includes('UNIQUE')) return null;
      throw e;
    }
  }

  /**
   * Lấy job kế (FIFO) cho một slot trống: tổng job đang chạy < maxParallel, agent của job chưa có job nào đang chạy.
   * Đánh dấu running trong cùng transaction.
   */
  claimNext(maxParallel: number, enabledAgents: string[]): Job | null {
    return this.db.transaction(() => {
      const running = this.db.query<{ n: number }, []>(`SELECT COUNT(*) n FROM jobs WHERE status = 'running'`).get()!.n;
      if (running >= maxParallel || enabledAgents.length === 0) return null;
      const marks = enabledAgents.map(() => '?').join(',');
      const job = this.db.query<Job, string[]>(`
        SELECT * FROM jobs WHERE status = 'queued' AND agent IN (${marks})
          AND agent NOT IN (SELECT agent FROM jobs WHERE status = 'running')
        ORDER BY id LIMIT 1`).get(...enabledAgents);
      if (!job) return null;
      this.db.run(`UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?`, [this.now(), job.id]);
      return { ...job, status: 'running' as const };
    })();
  }

  finish(id: number, status: Exclude<JobStatus, 'queued' | 'running'>, f: Partial<Pick<Job, 'reason' | 'session_id' | 'cost_usd' | 'input_tokens' | 'output_tokens' | 'turns' | 'pr_url'>> = {}) {
    this.db.run(`UPDATE jobs SET status = ?, finished_at = ?, reason = ?, session_id = ?, cost_usd = ?, input_tokens = ?, output_tokens = ?, turns = ?, pr_url = ? WHERE id = ?`,
      [status, this.now(), f.reason ?? null, f.session_id ?? null, f.cost_usd ?? null, f.input_tokens ?? null, f.output_tokens ?? null, f.turns ?? null, f.pr_url ?? null, id]);
  }

  getJob(id: number) { return this.db.query<Job, [number]>(`SELECT * FROM jobs WHERE id = ?`).get(id); }

  session(taskId: string) {
    return this.db.query<{ task_id: string; agent: string; session_id: string | null; branch: string; worktree: string }, [string]>(
      `SELECT * FROM task_sessions WHERE task_id = ?`).get(taskId);
  }

  saveSession(taskId: string, agent: string, sessionId: string | null, branch: string, worktree: string) {
    this.db.run(`INSERT INTO task_sessions (task_id, agent, session_id, branch, worktree, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET agent = excluded.agent, session_id = COALESCE(excluded.session_id, task_sessions.session_id),
        branch = excluded.branch, worktree = excluded.worktree, updated_at = excluded.updated_at`,
      [taskId, agent, sessionId, branch, worktree, this.now()]);
  }

  offset(bot: string) { return this.db.query<{ next_offset: number }, [string]>(`SELECT next_offset FROM tg_offsets WHERE bot = ?`).get(bot)?.next_offset ?? 0; }

  setOffset(bot: string, next: number) {
    this.db.run(`INSERT INTO tg_offsets (bot, next_offset) VALUES (?, ?) ON CONFLICT(bot) DO UPDATE SET next_offset = excluded.next_offset`, [bot, next]);
  }

  /** Tổng chi phí theo ngày (UTC) — lệnh `report`. */
  costs(sinceIso: string) {
    return this.db.query<{ agent: string; jobs: number; cost: number | null; input: number | null; output: number | null }, [string]>(`
      SELECT agent, COUNT(*) jobs, SUM(cost_usd) cost, SUM(input_tokens) input, SUM(output_tokens) output
      FROM jobs WHERE finished_at >= ? GROUP BY agent ORDER BY agent`).all(sinceIso);
  }
}
