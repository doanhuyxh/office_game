import { Database } from 'bun:sqlite';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'skipped';

/** Loại job: việc (mặc định, DB cũ = null) | chat (tin @nhắc trong một hội thoại, TEST-81) | meeting (một lượt nói trong cuộc họp agent, TEST-84). */
export type JobKind = 'task' | 'chat' | 'meeting';

export interface Job {
  id: number;
  agent: string;
  /** Khoá của job: id việc; job chat = `<mã NV>:<id hội thoại>`; job họp = `<mã NV>:<id phiên họp>` (riêng từng agent). Một khoá chỉ một job đang chờ / chạy. */
  task_id: string;
  /** Mã việc; job chat = nhãn hiển thị trong log (`chat:<8 ký tự đầu>`). */
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
  /** Model chính agent thật sự dùng (TEST-64); `model_usage` = JSON mọi model của phiên `{ model: { costUsd, inputTokens, outputTokens } }`. */
  model: string | null;
  model_usage: string | null;
  kind: JobKind | null;
  /** 1 = có tin đánh thức mới cho cùng khoá trong lúc job đang chạy → xong thì runner kiểm tra lại và chạy thêm một lượt. */
  rerun: number | null;
  /** Job bị hoãn (agent đang họp): chưa tới giờ này thì chưa lấy ra chạy. */
  not_before: string | null;
}

/** Cột thêm sau khi bảng đã có trong runner.db cũ → `ALTER TABLE … ADD COLUMN` lúc mở (migration nhẹ, không mất dữ liệu). */
const JOB_COLUMNS_ADDED: [string, string][] = [['model', 'TEXT'], ['model_usage', 'TEXT'], ['kind', 'TEXT'], ['rerun', 'INTEGER'], ['not_before', 'TEXT']];

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
        session_id TEXT, cost_usd REAL, input_tokens INTEGER, output_tokens INTEGER, turns INTEGER, pr_url TEXT, model TEXT, model_usage TEXT,
        kind TEXT, rerun INTEGER, not_before TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_jobs_active ON jobs(task_id) WHERE status IN ('queued', 'running');
      CREATE TABLE IF NOT EXISTS task_sessions (
        task_id TEXT PRIMARY KEY, agent TEXT NOT NULL, session_id TEXT, branch TEXT NOT NULL, worktree TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tg_offsets (bot TEXT PRIMARY KEY, next_offset INTEGER NOT NULL);
    `);
    const have = new Set(this.db.query<{ name: string }, []>(`PRAGMA table_info(jobs)`).all().map((c) => c.name));
    for (const [col, type] of JOB_COLUMNS_ADDED) if (!have.has(col)) this.db.exec(`ALTER TABLE jobs ADD COLUMN ${col} ${type}`);
  }

  private now() { return new Date().toISOString(); }

  /** Job đang chạy khi runner tắt đột ngột → đưa lại vào hàng đợi (phiên cũ nối tiếp được nếu CLI hỗ trợ). */
  recoverRunning(): number {
    return this.db.run(`UPDATE jobs SET status = 'queued', started_at = NULL, reason = 'runner khởi động lại' WHERE status = 'running'`).changes;
  }

  /**
   * Thêm job; khoá đã có job đang chờ / chạy → null (khoá theo task_id, không chạy trùng).
   * Job không phải việc (chat): khoá đang CHẠY → đánh dấu `rerun` để xong thì runner kiểm tra lại (tin mới tới giữa phiên không bị rơi);
   * đang chờ thì không cần (lúc chạy sẽ đọc cả tin mới).
   */
  enqueue(agent: string, taskId: string, taskCode: string, projectId: string, kind: JobKind = 'task'): number | null {
    try {
      const r = this.db.run(`INSERT INTO jobs (agent, task_id, task_code, project_id, status, created_at, kind) VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
        [agent, taskId, taskCode, projectId, this.now(), kind]);
      return Number(r.lastInsertRowid);
    } catch (e) {
      if (!String(e).includes('UNIQUE')) throw e;
      if (kind !== 'task') this.db.run(`UPDATE jobs SET rerun = 1 WHERE task_id = ? AND status = 'running'`, [taskId]);
      return null;
    }
  }

  /**
   * Lấy job kế cho một slot trống: tổng job đang chạy < maxParallel, agent của job chưa có job nào đang chạy (mỗi agent 1 phiên, mọi loại).
   * Job họp lấy trước (người đang chờ trong phòng, lượt nói có hạn), còn lại FIFO; job đang hoãn (`not_before` chưa tới) bị bỏ qua.
   * Đánh dấu running trong cùng transaction.
   */
  claimNext(maxParallel: number, enabledAgents: string[]): Job | null {
    return this.db.transaction(() => {
      const running = this.db.query<{ n: number }, []>(`SELECT COUNT(*) n FROM jobs WHERE status = 'running'`).get()!.n;
      if (running >= maxParallel || enabledAgents.length === 0) return null;
      const marks = enabledAgents.map(() => '?').join(',');
      const job = this.db.query<Job, string[]>(`
        SELECT * FROM jobs WHERE status = 'queued' AND agent IN (${marks}) AND (not_before IS NULL OR not_before <= ?)
          AND agent NOT IN (SELECT agent FROM jobs WHERE status = 'running')
        ORDER BY CASE WHEN kind = 'meeting' THEN 0 ELSE 1 END, id LIMIT 1`).get(...enabledAgents, this.now());
      if (!job) return null;
      this.db.run(`UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?`, [this.now(), job.id]);
      return { ...job, status: 'running' as const };
    })();
  }

  /** Hoãn job đang chạy dở khâu chuẩn bị (agent đang họp): về hàng đợi, tới `untilIso` mới được lấy lại. */
  hold(id: number, untilIso: string, reason: string) {
    this.db.run(`UPDATE jobs SET status = 'queued', started_at = NULL, not_before = ?, reason = ? WHERE id = ?`, [untilIso, reason, id]);
  }

  /** Job đang chạy của một agent (mỗi agent tối đa 1). */
  runningJob(agent: string) { return this.db.query<Job, [string]>(`SELECT * FROM jobs WHERE status = 'running' AND agent = ?`).get(agent); }

  finish(id: number, status: Exclude<JobStatus, 'queued' | 'running'>,
    f: Partial<Pick<Job, 'reason' | 'session_id' | 'cost_usd' | 'input_tokens' | 'output_tokens' | 'turns' | 'pr_url' | 'model' | 'model_usage'>> = {}) {
    this.db.run(`UPDATE jobs SET status = ?, finished_at = ?, reason = ?, session_id = ?, cost_usd = ?, input_tokens = ?, output_tokens = ?, turns = ?, pr_url = ?,
        model = ?, model_usage = ? WHERE id = ?`,
      [status, this.now(), f.reason ?? null, f.session_id ?? null, f.cost_usd ?? null, f.input_tokens ?? null, f.output_tokens ?? null, f.turns ?? null, f.pr_url ?? null,
        f.model ?? null, f.model_usage ?? null, id]);
  }

  getJob(id: number) { return this.db.query<Job, [number]>(`SELECT * FROM jobs WHERE id = ?`).get(id); }

  session(taskId: string) {
    return this.db.query<{ task_id: string; agent: string; session_id: string | null; branch: string; worktree: string; updated_at: string }, [string]>(
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

  /** Chi phí theo loại job (việc / chat / họp) — lệnh `report`. */
  costsByKind(sinceIso: string) {
    return this.db.query<{ kind: string; jobs: number; cost: number | null }, [string]>(`
      SELECT COALESCE(kind, 'task') kind, COUNT(*) jobs, SUM(cost_usd) cost FROM jobs WHERE finished_at >= ? GROUP BY 1 ORDER BY 1`).all(sinceIso);
  }

  /** Chi phí theo agent + model chính (TEST-64, lệnh `report`); job không rõ model → model null. */
  costsByModel(sinceIso: string) {
    return this.db.query<{ agent: string; model: string | null; jobs: number; cost: number | null; input: number | null; output: number | null }, [string]>(`
      SELECT agent, model, COUNT(*) jobs, SUM(cost_usd) cost, SUM(input_tokens) input, SUM(output_tokens) output
      FROM jobs WHERE finished_at >= ? GROUP BY agent, model ORDER BY agent, cost DESC`).all(sinceIso);
  }
}
