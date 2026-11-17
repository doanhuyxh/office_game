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
  /** Phần token vào đọc / ghi cache (TEST-135; `input_tokens` vẫn là tổng gồm cache). CLI không báo → null. */
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  /** Loại CLI chạy phiên (`claude` / `custom`) — gửi lên OfficeHub làm `executor`. */
  executor: string | null;
  /**
   * Job có chạy CLI (có phiên để báo mức dùng AI, TEST-135): 1 = runner tự gửi sau phiên + gửi lại theo nhịp;
   * 2 = job cũ trước TEST-135 (đánh dấu lúc nâng cấp DB) — chỉ gửi bằng `usage push`; null = không chạy CLI (bỏ qua / lỗi trước khi chạy).
   */
  cli_ran: number | null;
  /** Đã gửi mức dùng AI lên OfficeHub lúc nào (null = chưa). */
  usage_sent_at: string | null;
  /** OfficeHub từ chối phiên (400) — câu lỗi; runner không tự gửi lại, `usage push` thử lại. */
  usage_error: string | null;
  /** 1 = có tin đánh thức mới cho cùng khoá trong lúc job đang chạy → xong thì runner kiểm tra lại và chạy thêm một lượt. */
  rerun: number | null;
  /** Job bị hoãn (agent đang họp): chưa tới giờ này thì chưa lấy ra chạy. */
  not_before: string | null;
}

/** Cột thêm sau khi bảng đã có trong runner.db cũ → `ALTER TABLE … ADD COLUMN` lúc mở (migration nhẹ, không mất dữ liệu). */
const JOB_COLUMNS_ADDED: [string, string][] = [
  ['model', 'TEXT'],
  ['model_usage', 'TEXT'],
  ['kind', 'TEXT'],
  ['rerun', 'INTEGER'],
  ['not_before', 'TEXT'],
  ['cache_read_tokens', 'INTEGER'],
  ['cache_write_tokens', 'INTEGER'],
  ['executor', 'TEXT'],
  ['cli_ran', 'INTEGER'],
  ['usage_sent_at', 'TEXT'],
  ['usage_error', 'TEXT'],
];

/** Job cũ (trước TEST-135) có dấu hiệu đã chạy CLI → `cli_ran = 2` (chỉ gửi bằng `usage push`). */
const LEGACY_CLI_RAN = `status IN ('done', 'failed') AND started_at IS NOT NULL
  AND (session_id IS NOT NULL OR model IS NOT NULL OR cost_usd IS NOT NULL OR turns IS NOT NULL OR input_tokens IS NOT NULL)`;

/**
 * Tổng theo loại job (`report`, TEST-139). `input` = tổng token vào GỒM cache; `input_with_cache` = phần `input` của các job có báo cache
 * (mẫu số của tỉ lệ đọc cache — job không báo cache không làm tỉ lệ sai); `costed` = số job có chi phí (mẫu số chi phí trung bình).
 */
export interface KindCost {
  kind: string;
  jobs: number;
  cost: number | null;
  costed: number;
  input: number | null;
  output: number | null;
  cache_read: number | null;
  cache_write: number | null;
  input_with_cache: number | null;
}

/** Phiên CLI gần nhất của một khoá (`task_sessions`). */
export interface SessionRow {
  task_id: string;
  agent: string;
  session_id: string | null;
  branch: string;
  worktree: string;
  updated_at: string;
  /** Số lần nối liên tiếp (TEST-142); null = DB cũ. */
  resumes: number | null;
  /** TEST-144: loại job của phiên (task / chat / meeting), bản bàn giao (câu cuối của agent), transcript chờ gửi lên cloud, sha256 bản đã gửi, lỗi 400. */
  kind: string | null;
  summary: string | null;
  transcript_pending: number | null;
  transcript_sha: string | null;
  transcript_error: string | null;
}

/** Kết quả phiên ghi vào job khi xong. */
export type JobResult = Partial<
  Pick<
    Job,
    | 'reason'
    | 'session_id'
    | 'cost_usd'
    | 'input_tokens'
    | 'output_tokens'
    | 'cache_read_tokens'
    | 'cache_write_tokens'
    | 'turns'
    | 'pr_url'
    | 'model'
    | 'model_usage'
    | 'executor'
    | 'cli_ran'
  >
>;

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
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    const have = new Set(
      this.db
        .query<{ name: string }, []>(`PRAGMA table_info(jobs)`)
        .all()
        .map((c) => c.name),
    );
    for (const [col, type] of JOB_COLUMNS_ADDED)
      if (!have.has(col)) this.db.exec(`ALTER TABLE jobs ADD COLUMN ${col} ${type}`);
    if (!have.has('cli_ran')) this.db.run(`UPDATE jobs SET cli_ran = 2 WHERE ${LEGACY_CLI_RAN}`);
    // TEST-142: số lần nối liên tiếp của phiên (họp: quá trần → phiên mới)
    const sessCols = new Set(
      this.db
        .query<{ name: string }, []>(`PRAGMA table_info(task_sessions)`)
        .all()
        .map((c) => c.name),
    );
    // TEST-144: transcript lên cloud — loại job, bản bàn giao, hàng chờ gửi
    for (const [col, type] of [
      ['resumes', 'INTEGER'],
      ['kind', 'TEXT'],
      ['summary', 'TEXT'],
      ['transcript_pending', 'INTEGER'],
      ['transcript_sha', 'TEXT'],
      ['transcript_error', 'TEXT'],
    ] as const)
      if (!sessCols.has(col)) this.db.exec(`ALTER TABLE task_sessions ADD COLUMN ${col} ${type}`);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS ix_jobs_usage_pending ON jobs(agent, id) WHERE cli_ran IS NOT NULL AND usage_sent_at IS NULL`,
    );
  }

  /**
   * Mã ngẫu nhiên của runner.db này (8 ký tự hex, tạo một lần). Nằm trong `sourceId` gửi OfficeHub: máy bị xoá → DB mới đếm job lại từ 1,
   * mã khác → phiên mới không ghi đè phiên cũ cùng số job.
   */
  dbId(): string {
    const row = this.db.query<{ value: string }, []>(`SELECT value FROM meta WHERE key = 'db_id'`).get();
    if (row) return row.value;
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    this.db.run(`INSERT OR IGNORE INTO meta (key, value) VALUES ('db_id', ?)`, [id]);
    return this.db.query<{ value: string }, []>(`SELECT value FROM meta WHERE key = 'db_id'`).get()!.value;
  }

  private now() {
    return new Date().toISOString();
  }

  /** Job đang chạy khi runner tắt đột ngột → đưa lại vào hàng đợi (phiên cũ nối tiếp được nếu CLI hỗ trợ). */
  recoverRunning(): number {
    return this.db.run(
      `UPDATE jobs SET status = 'queued', started_at = NULL, reason = 'runner khởi động lại' WHERE status = 'running'`,
    ).changes;
  }

  /**
   * Thêm job; khoá đã có job đang chờ / chạy → null (khoá theo task_id, không chạy trùng).
   * Job không phải việc (chat): khoá đang CHẠY → đánh dấu `rerun` để xong thì runner kiểm tra lại (tin mới tới giữa phiên không bị rơi);
   * đang chờ thì không cần (lúc chạy sẽ đọc cả tin mới).
   */
  enqueue(agent: string, taskId: string, taskCode: string, projectId: string, kind: JobKind = 'task'): number | null {
    try {
      const r = this.db.run(
        `INSERT INTO jobs (agent, task_id, task_code, project_id, status, created_at, kind) VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
        [agent, taskId, taskCode, projectId, this.now(), kind],
      );
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
      const job = this.db
        .query<Job, string[]>(`
        SELECT * FROM jobs WHERE status = 'queued' AND agent IN (${marks}) AND (not_before IS NULL OR not_before <= ?)
          AND agent NOT IN (SELECT agent FROM jobs WHERE status = 'running')
        ORDER BY CASE WHEN kind = 'meeting' THEN 0 ELSE 1 END, id LIMIT 1`)
        .get(...enabledAgents, this.now());
      if (!job) return null;
      this.db.run(`UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?`, [this.now(), job.id]);
      return { ...job, status: 'running' as const };
    })();
  }

  /** Hoãn job đang chạy dở khâu chuẩn bị (agent đang họp): về hàng đợi, tới `untilIso` mới được lấy lại. */
  hold(id: number, untilIso: string, reason: string) {
    this.db.run(`UPDATE jobs SET status = 'queued', started_at = NULL, not_before = ?, reason = ? WHERE id = ?`, [
      untilIso,
      reason,
      id,
    ]);
  }

  /** Runner được dừng giữa phiên (SIGTERM / deploy): job đang chạy về hàng đợi, lần khởi động sau chạy lại — không tính là phiên lỗi. */
  requeue(id: number, reason: string) {
    this.db.run(
      `UPDATE jobs SET status = 'queued', started_at = NULL, reason = ? WHERE id = ? AND status = 'running'`,
      [reason, id],
    );
  }

  /** Job đang chạy của một agent (mỗi agent tối đa 1). */
  runningJob(agent: string) {
    return this.db.query<Job, [string]>(`SELECT * FROM jobs WHERE status = 'running' AND agent = ?`).get(agent);
  }

  finish(id: number, status: Exclude<JobStatus, 'queued' | 'running'>, f: JobResult = {}) {
    this.db.run(
      `UPDATE jobs SET status = ?, finished_at = ?, reason = ?, session_id = ?, cost_usd = ?, input_tokens = ?, output_tokens = ?, turns = ?, pr_url = ?,
        model = ?, model_usage = ?, cache_read_tokens = ?, cache_write_tokens = ?, executor = ?, cli_ran = ?, usage_sent_at = NULL, usage_error = NULL WHERE id = ?`,
      [
        status,
        this.now(),
        f.reason ?? null,
        f.session_id ?? null,
        f.cost_usd ?? null,
        f.input_tokens ?? null,
        f.output_tokens ?? null,
        f.turns ?? null,
        f.pr_url ?? null,
        f.model ?? null,
        f.model_usage ?? null,
        f.cache_read_tokens ?? null,
        f.cache_write_tokens ?? null,
        f.executor ?? null,
        f.cli_ran ?? null,
        id,
      ],
    );
  }

  /**
   * Phiên chưa gửi mức dùng AI của một agent, theo id tăng dần, sau `afterId` (con trỏ — phiên bị từ chối không làm vòng gửi lặp mãi).
   * Mặc định (runner tự gửi): chỉ job chạy sau TEST-135, chưa bị OfficeHub từ chối. `all` (`usage push`): cả job cũ + job bị từ chối.
   */
  pendingUsage(agent: string, o: { afterId?: number; limit?: number; all?: boolean; sinceIso?: string } = {}): Job[] {
    const cond = o.all ? 'cli_ran IS NOT NULL' : 'cli_ran = 1 AND usage_error IS NULL';
    return this.db
      .query<Job, [string, number, string, number]>(`
      SELECT * FROM jobs WHERE agent = ? AND ${cond} AND usage_sent_at IS NULL AND status IN ('done', 'failed') AND id > ? AND finished_at >= ?
      ORDER BY id LIMIT ?`)
      .all(agent, o.afterId ?? 0, o.sinceIso ?? '', o.limit ?? 50);
  }

  /** Agent có phiên chưa gửi (kể cả job cũ / bị từ chối) — `usage push` liệt kê agent không còn trong cấu hình. */
  pendingUsageAgents(sinceIso = ''): { agent: string; n: number }[] {
    return this.db
      .query<{ agent: string; n: number }, [string]>(`
      SELECT agent, COUNT(*) n FROM jobs WHERE cli_ran IS NOT NULL AND usage_sent_at IS NULL AND status IN ('done', 'failed') AND finished_at >= ?
      GROUP BY agent ORDER BY agent`)
      .all(sinceIso);
  }

  markUsageSent(ids: number[]) {
    if (!ids.length) return;
    this.db.run(`UPDATE jobs SET usage_sent_at = ?, usage_error = NULL WHERE id IN (${ids.map(() => '?').join(',')})`, [
      this.now(),
      ...ids,
    ]);
  }

  markUsageRejected(id: number, error: string) {
    this.db.run(`UPDATE jobs SET usage_error = ? WHERE id = ?`, [error.slice(0, 500), id]);
  }

  getJob(id: number) {
    return this.db.query<Job, [number]>(`SELECT * FROM jobs WHERE id = ?`).get(id);
  }

  session(taskId: string) {
    return this.db.query<SessionRow, [string]>(`SELECT * FROM task_sessions WHERE task_id = ?`).get(taskId);
  }

  /**
   * Ghi phiên CLI của một khoá (việc / hội thoại / cuộc họp) sau mỗi lần chạy. `resumed` = lần này nối phiên cũ → `resumes` + 1; phiên mới → 0.
   * Bảng này chỉ là cache: mất (máy mới) thì lần sau mở phiên mới, không lỗi (TEST-142).
   */
  saveSession(
    taskId: string,
    agent: string,
    sessionId: string | null,
    branch: string,
    worktree: string,
    resumed = false,
  ) {
    this.db.run(
      `INSERT INTO task_sessions (task_id, agent, session_id, branch, worktree, updated_at, resumes) VALUES (?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(task_id) DO UPDATE SET agent = excluded.agent, session_id = COALESCE(excluded.session_id, task_sessions.session_id),
        branch = excluded.branch, worktree = excluded.worktree, updated_at = excluded.updated_at,
        resumes = CASE WHEN ? THEN COALESCE(task_sessions.resumes, 0) + 1 ELSE 0 END`,
      [taskId, agent, sessionId, branch, worktree, this.now(), resumed ? 1 : 0],
    );
  }

  /** Sau phiên CLI có transcript (TEST-144): ghi loại job + bản bàn giao, đưa vào hàng chờ gửi lên cloud. */
  markTranscript(taskId: string, kind: string, summary: string | null) {
    this.db.run(
      `UPDATE task_sessions SET kind = ?, summary = ?, transcript_pending = 1, transcript_error = NULL WHERE task_id = ? AND session_id IS NOT NULL`,
      [kind, summary, taskId],
    );
  }

  /** Phiên chờ gửi transcript của một agent (cũ trước). */
  pendingTranscripts(agent: string, limit = 20) {
    return this.db
      .query<SessionRow, [string, number]>(
        `SELECT * FROM task_sessions WHERE agent = ? AND transcript_pending = 1 AND session_id IS NOT NULL ORDER BY updated_at LIMIT ?`,
      )
      .all(agent, limit);
  }

  /** Kết quả gửi transcript: `sha` = đã gửi (hoặc bản trên cloud đã khớp); `error` = bỏ, không gửi lại (400 / quá lớn / không còn file). */
  doneTranscript(taskId: string, r: { sha?: string; error?: string }) {
    this.db.run(
      `UPDATE task_sessions SET transcript_pending = 0, transcript_sha = COALESCE(?, transcript_sha), transcript_error = ? WHERE task_id = ?`,
      [r.sha ?? null, r.error ?? null, taskId],
    );
  }

  offset(bot: string) {
    return (
      this.db.query<{ next_offset: number }, [string]>(`SELECT next_offset FROM tg_offsets WHERE bot = ?`).get(bot)
        ?.next_offset ?? 0
    );
  }

  setOffset(bot: string, next: number) {
    this.db.run(
      `INSERT INTO tg_offsets (bot, next_offset) VALUES (?, ?) ON CONFLICT(bot) DO UPDATE SET next_offset = excluded.next_offset`,
      [bot, next],
    );
  }

  /** Tổng chi phí theo ngày (UTC) — lệnh `report`. */
  costs(sinceIso: string) {
    return this.db
      .query<
        { agent: string; jobs: number; cost: number | null; input: number | null; output: number | null },
        [string]
      >(`
      SELECT agent, COUNT(*) jobs, SUM(cost_usd) cost, SUM(input_tokens) input, SUM(output_tokens) output
      FROM jobs WHERE finished_at >= ? GROUP BY agent ORDER BY agent`)
      .all(sinceIso);
  }

  /** Chi phí theo loại job (việc / chat / họp) — lệnh `report`. */
  costsByKind(sinceIso: string) {
    return this.db
      .query<KindCost, [string]>(`
      SELECT COALESCE(kind, 'task') kind, COUNT(*) jobs, SUM(cost_usd) cost, COUNT(cost_usd) costed,
        SUM(input_tokens) input, SUM(output_tokens) output, SUM(cache_read_tokens) cache_read, SUM(cache_write_tokens) cache_write,
        SUM(CASE WHEN cache_read_tokens IS NOT NULL OR cache_write_tokens IS NOT NULL THEN input_tokens END) input_with_cache
      FROM jobs WHERE finished_at >= ? GROUP BY 1 ORDER BY 1`)
      .all(sinceIso);
  }

  /** Chi phí theo agent + model chính (TEST-64, lệnh `report`); job không rõ model → model null. */
  costsByModel(sinceIso: string) {
    return this.db
      .query<
        {
          agent: string;
          kind: string;
          model: string | null;
          jobs: number;
          cost: number | null;
          input: number | null;
          output: number | null;
        },
        [string]
      >(`
      SELECT agent, COALESCE(kind, 'task') kind, model, COUNT(*) jobs, SUM(cost_usd) cost, SUM(input_tokens) input, SUM(output_tokens) output
      FROM jobs WHERE finished_at >= ? GROUP BY agent, 2, model ORDER BY agent, 2, cost DESC`)
      .all(sinceIso);
  }
}
