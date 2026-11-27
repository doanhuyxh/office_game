import { Database } from 'bun:sqlite';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'skipped';

/**
 * Loại job: việc được giao / chat / họp / bước của người theo dõi khi việc vào cột "Đánh thức bot theo dõi" (`follow`, TEST-180).
 * `follow` khoá theo `<mã NV>:<id việc>` (nhiều bot cùng theo dõi một việc) — báo mức dùng AI / transcript lên OfficeHub là loại `task`
 * ({@link reportKind}, máy chủ chỉ nhận task / chat / meeting) kèm id việc thật ({@link taskIdOf}).
 * `review` / `deploy` (TEST-167 / 168) là loại cũ: không còn tạo mới, chỉ còn trong DB (lịch sử, job đang chờ lúc nâng cấp → chạy bằng handler
 * `follow`, xem {@link currentKind}).
 */
export type JobKind = 'task' | 'chat' | 'meeting' | 'follow' | LegacyJobKind;
export type LegacyJobKind = 'review' | 'deploy';

/** Loại job trên một việc của người khác (khoá `<mã NV>:<id việc>`). */
const FOLLOW_KINDS: readonly string[] = ['follow', 'review', 'deploy'];

/** Loại job dùng để chọn handler: loại cũ review / deploy → follow. */
export const currentKind = (kind: JobKind): Exclude<JobKind, LegacyJobKind> =>
  FOLLOW_KINDS.includes(kind) ? 'follow' : (kind as Exclude<JobKind, LegacyJobKind>);

/** Loại phiên gửi lên OfficeHub (mức dùng AI, transcript). */
export const reportKind = (kind: JobKind | string): string => (FOLLOW_KINDS.includes(kind) ? 'task' : kind);

/** Id việc của job việc / follow (bỏ tiền tố `<mã NV>:` của khoá); job khác → undefined. */
export function taskIdOf(job: Pick<Job, 'kind' | 'key'>): string | undefined {
  if (job.kind === 'task') return job.key;
  if (FOLLOW_KINDS.includes(job.kind)) return job.key.slice(job.key.indexOf(':') + 1);
  return undefined;
}

export interface Job {
  id: number;
  agent: string;
  /** Khoá của job: id việc; job chat = `<mã NV>:<id hội thoại>`; job họp = `<mã NV>:<id phiên họp>` (riêng từng agent). Một khoá chỉ một job đang chờ / chạy. */
  key: string;
  /** Mã việc; job chat / họp = nhãn hiển thị trong log (`chat:<8 ký tự đầu>`). Cột `task_code`. */
  label: string;
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
  kind: JobKind;
  /** Phần token vào đọc / ghi cache (TEST-135; `input_tokens` vẫn là tổng gồm cache). CLI không báo → null. */
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  /** Loại CLI chạy phiên (`claude` / `codex` / `custom`) — gửi lên OfficeHub làm `executor`. */
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

/** Cột thêm vào `task_sessions`: số lần nối liên tiếp (TEST-142); loại job, bản bàn giao, hàng chờ gửi transcript (TEST-144). */
const SESSION_COLUMNS_ADDED: [string, string][] = [
  ['resumes', 'INTEGER'],
  ['kind', 'TEXT'],
  ['summary', 'TEXT'],
  ['transcript_pending', 'INTEGER'],
  ['transcript_sha', 'TEXT'],
  ['transcript_error', 'TEXT'],
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
  /** Khoá job của phiên (cột `task_id`). */
  key: string;
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
  /** Lúc runner đã dọn worktree / transcript / thư mục chạy trên máy (TEST-247); null = chưa dọn, hoặc chạy lại sau khi dọn. */
  cleaned_at: string | null;
}

/** Phiên chờ xét dọn (TEST-247): dòng `task_sessions` + loại job mới nhất của khoá + khoá còn job đang chờ / chạy. */
export interface CleanupCandidate extends SessionRow {
  job_kind: string | null;
  active: number;
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
 * Cột đọc ra của `jobs` / `task_sessions`. Tên cột trong DB giữ nguyên từ bản đầu (`task_id`, `task_code`) để bản runner cũ vẫn mở được
 * runner.db; trong mã dùng tên đúng nghĩa: `key` (khoá job) và `label` (nhãn).
 */
const JOB_SELECT = `SELECT id, agent, task_id AS "key", task_code AS label, project_id, status, reason, created_at, started_at, finished_at,
  session_id, cost_usd, input_tokens, output_tokens, turns, pr_url, model, model_usage, kind, cache_read_tokens, cache_write_tokens,
  executor, cli_ran, usage_sent_at, usage_error, rerun, not_before FROM jobs`;
const SESSION_SELECT = `SELECT task_id AS "key", agent, session_id, branch, worktree, updated_at, resumes, kind, summary,
  transcript_pending, transcript_sha, transcript_error, cleaned_at FROM task_sessions`;

/** Dòng `task_sessions` + loại job mới nhất của khoá + khoá còn job đang chờ / chạy (TEST-247). */
const CANDIDATE_SELECT = `SELECT task_id AS "key", agent, session_id, branch, worktree, updated_at, resumes, kind, summary, transcript_pending,
    transcript_sha, transcript_error, cleaned_at,
    (SELECT j.kind FROM jobs j WHERE j.task_id = s.task_id ORDER BY j.id DESC LIMIT 1) AS job_kind,
    EXISTS (SELECT 1 FROM jobs j WHERE j.task_id = s.task_id AND j.status IN ('queued', 'running')) AS active
  FROM task_sessions s`;

const columnsOf = (db: Database, table: string) =>
  new Set(
    db
      .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
      .all()
      .map((c) => c.name),
  );

function addMissingColumns(db: Database, table: string, columns: readonly (readonly [string, string])[]) {
  const have = columnsOf(db, table);
  for (const [name, type] of columns) if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
}

/**
 * Các bước nâng cấp runner.db, chạy lần lượt theo `PRAGMA user_version` (bước thứ n đưa DB lên phiên bản n). CHỈ THÊM bước mới vào cuối,
 * không sửa bước cũ; mỗi bước phải giữ cho bản runner trước đó vẫn mở được DB (chỉ thêm cột / điền dữ liệu, không đổi tên / xoá cột).
 */
const MIGRATIONS: ((db: Database) => void)[] = [
  // 1: lược đồ tới TEST-144. DB có trước khi dùng user_version đang ở phiên bản 0 với số cột tuỳ bản → bước này tự bù phần thiếu.
  (db) => {
    db.exec(`
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
    const hadCliRan = columnsOf(db, 'jobs').has('cli_ran');
    addMissingColumns(db, 'jobs', JOB_COLUMNS_ADDED);
    if (!hadCliRan) db.run(`UPDATE jobs SET cli_ran = 2 WHERE ${LEGACY_CLI_RAN}`);
    addMissingColumns(db, 'task_sessions', SESSION_COLUMNS_ADDED);
    db.exec(
      `CREATE INDEX IF NOT EXISTS ix_jobs_usage_pending ON jobs(agent, id) WHERE cli_ran IS NOT NULL AND usage_sent_at IS NULL`,
    );
  },
  // 2: job cũ (trước khi có chat / họp) để `kind` trống = việc → điền hẳn 'task', mã không còn phải đoán `kind ?? 'task'`.
  (db) => {
    db.run(`UPDATE jobs SET kind = 'task' WHERE kind IS NULL`);
  },
  // 3 (TEST-247): đánh dấu phiên đã được dọn khỏi máy (worktree, transcript, thư mục chạy).
  (db) => {
    addMissingColumns(db, 'task_sessions', [['cleaned_at', 'TEXT']]);
  },
];

/** Đưa runner.db lên phiên bản mới nhất. DB của bản runner MỚI hơn mã này → từ chối mở (không đoán lược đồ lạ). */
function migrate(db: Database) {
  const current = db.query<{ user_version: number }, []>('PRAGMA user_version').get()!.user_version;
  if (current > MIGRATIONS.length)
    throw new Error(
      `runner.db ở phiên bản ${current}, mới hơn bản runner này (${MIGRATIONS.length}) — dùng bản runner mới hơn hoặc data_dir khác`,
    );
  for (let version = current + 1; version <= MIGRATIONS.length; version++) {
    db.transaction(() => {
      MIGRATIONS[version - 1]!(db);
      db.exec(`PRAGMA user_version = ${version}`);
    })();
  }
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
    migrate(this.db);
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
      `UPDATE jobs SET status = 'queued', started_at = NULL, rerun = NULL, reason = 'runner khởi động lại' WHERE status = 'running'`,
    ).changes;
  }

  /**
   * Thêm job; khoá đã có job đang chờ / chạy → null (khoá theo task_id, không chạy trùng).
   * Khoá đang CHẠY → đánh dấu `rerun` để xong thì handler kiểm tra lại (tin mới tới giữa phiên không bị rơi — mọi loại job, kể cả việc:
   * người thật trả việc / bình luận trong lúc bot đang làm); đang chờ thì không cần (lúc chạy sẽ đọc cả tin mới).
   */
  enqueue(agent: string, key: string, label: string, projectId: string, kind: JobKind = 'task'): number | null {
    try {
      const r = this.db.run(
        `INSERT INTO jobs (agent, task_id, task_code, project_id, status, created_at, kind) VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
        [agent, key, label, projectId, this.now(), kind],
      );
      return Number(r.lastInsertRowid);
    } catch (e) {
      if (!String(e).includes('UNIQUE')) throw e;
      this.db.run(`UPDATE jobs SET rerun = 1 WHERE task_id = ? AND status = 'running'`, [key]);
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
        ${JOB_SELECT} WHERE status = 'queued' AND agent IN (${marks}) AND (not_before IS NULL OR not_before <= ?)
          AND agent NOT IN (SELECT agent FROM jobs WHERE status = 'running')
        ORDER BY CASE WHEN kind = 'meeting' THEN 0 ELSE 1 END, id LIMIT 1`)
        .get(...enabledAgents, this.now());
      if (!job) return null;
      this.db.run(`UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?`, [this.now(), job.id]);
      return { ...job, status: 'running' as const };
    })();
  }

  /**
   * Hoãn job đang chạy dở khâu chuẩn bị (agent đang họp): về hàng đợi, tới `untilIso` mới được lấy lại.
   * Về hàng đợi = lúc chạy sẽ đọc trạng thái mới → bỏ `rerun` (như {@link requeue}, {@link recoverRunning}).
   */
  hold(id: number, untilIso: string, reason: string) {
    this.db.run(
      `UPDATE jobs SET status = 'queued', started_at = NULL, rerun = NULL, not_before = ?, reason = ? WHERE id = ?`,
      [untilIso, reason, id],
    );
  }

  /** Runner được dừng giữa phiên (SIGTERM / deploy): job đang chạy về hàng đợi, lần khởi động sau chạy lại — không tính là phiên lỗi. */
  requeue(id: number, reason: string) {
    this.db.run(
      `UPDATE jobs SET status = 'queued', started_at = NULL, rerun = NULL, reason = ? WHERE id = ? AND status = 'running'`,
      [reason, id],
    );
  }

  /** Job đang chạy của một agent (mỗi agent tối đa 1). */
  runningJob(agent: string) {
    return this.db.query<Job, [string]>(`${JOB_SELECT} WHERE status = 'running' AND agent = ?`).get(agent);
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
      ${JOB_SELECT} WHERE agent = ? AND ${cond} AND usage_sent_at IS NULL AND status IN ('done', 'failed') AND id > ? AND finished_at >= ?
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

  /** Khoá này có job nào kết thúc sau `sinceIso` không (bắt bù lúc khởi động không chạy lại việc vừa xong — TEST-158). */
  finishedSince(key: string, sinceIso: string): boolean {
    return !!this.db
      .query<{ id: number }, [string, string]>(`SELECT id FROM jobs WHERE task_id = ? AND finished_at > ? LIMIT 1`)
      .get(key, sinceIso);
  }

  getJob(id: number) {
    return this.db.query<Job, [number]>(`${JOB_SELECT} WHERE id = ?`).get(id);
  }

  session(key: string) {
    return this.db.query<SessionRow, [string]>(`${SESSION_SELECT} WHERE task_id = ?`).get(key);
  }

  /**
   * Ghi phiên CLI của một khoá (việc / hội thoại / cuộc họp) sau mỗi lần chạy. `resumed` = lần này nối phiên cũ → `resumes` + 1; phiên mới → 0.
   * Bảng này chỉ là cache: mất (máy mới) thì lần sau mở phiên mới, không lỗi (TEST-142).
   */
  saveSession(key: string, agent: string, sessionId: string | null, branch: string, worktree: string, resumed = false) {
    this.db.run(
      `INSERT INTO task_sessions (task_id, agent, session_id, branch, worktree, updated_at, resumes) VALUES (?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(task_id) DO UPDATE SET agent = excluded.agent, session_id = COALESCE(excluded.session_id, task_sessions.session_id),
        branch = excluded.branch, worktree = excluded.worktree, updated_at = excluded.updated_at, cleaned_at = NULL,
        resumes = CASE WHEN ? THEN COALESCE(task_sessions.resumes, 0) + 1 ELSE 0 END`,
      [key, agent, sessionId, branch, worktree, this.now(), resumed ? 1 : 0],
    );
  }

  /** Sau phiên CLI có transcript (TEST-144): ghi loại job + bản bàn giao, đưa vào hàng chờ gửi lên cloud. */
  markTranscript(key: string, kind: string, summary: string | null) {
    this.db.run(
      `UPDATE task_sessions SET kind = ?, summary = ?, transcript_pending = 1, transcript_error = NULL WHERE task_id = ? AND session_id IS NOT NULL`,
      [kind, summary, key],
    );
  }

  /** Phiên chờ gửi transcript của một agent (cũ trước). */
  pendingTranscripts(agent: string, limit = 20) {
    return this.db
      .query<SessionRow, [string, number]>(
        `${SESSION_SELECT} WHERE agent = ? AND transcript_pending = 1 AND session_id IS NOT NULL ORDER BY updated_at LIMIT ?`,
      )
      .all(agent, limit);
  }

  /** Kết quả gửi transcript: `sha` = đã gửi (hoặc bản trên cloud đã khớp); `error` = bỏ, không gửi lại (400 / quá lớn / không còn file). */
  doneTranscript(key: string, r: { sha?: string; error?: string }) {
    this.db.run(
      `UPDATE task_sessions SET transcript_pending = 0, transcript_sha = COALESCE(?, transcript_sha), transcript_error = ? WHERE task_id = ?`,
      [r.sha ?? null, r.error ?? null, key],
    );
  }

  /**
   * Phiên chưa dọn, chạy lần cuối trước `beforeIso` (TEST-247), cũ trước. `job_kind` = loại job mới nhất của khoá (task / follow / chat / meeting);
   * `active` = khoá còn job đang chờ / chạy.
   */
  cleanupCandidates(beforeIso: string): CleanupCandidate[] {
    return this.db
      .query<CleanupCandidate, [string]>(
        `${CANDIDATE_SELECT} WHERE cleaned_at IS NULL AND updated_at < ? ORDER BY updated_at`,
      )
      .all(beforeIso);
  }

  /** Phiên chưa dọn của một khoá (dọn ngay khi việc sang Xong, TEST-247); không có / đã dọn → null. */
  cleanupCandidateOf(key: string): CleanupCandidate | null {
    return this.db
      .query<CleanupCandidate, [string]>(`${CANDIDATE_SELECT} WHERE cleaned_at IS NULL AND task_id = ?`)
      .get(key);
  }

  /** Khoá còn job đang chờ / chạy. */
  hasActiveJob(key: string): boolean {
    return !!this.db
      .query<{ n: number }, [string]>(
        `SELECT 1 AS n FROM jobs WHERE task_id = ? AND status IN ('queued', 'running') LIMIT 1`,
      )
      .get(key);
  }

  /** Mọi id phiên CLI từng chạy cho một khoá của agent (mỗi lần mở phiên mới là một transcript riêng trên máy). */
  sessionIdsOf(key: string, agent: string): string[] {
    return this.db
      .query<{ session_id: string }, [string, string]>(
        `SELECT DISTINCT session_id FROM jobs WHERE task_id = ? AND agent = ? AND session_id IS NOT NULL`,
      )
      .all(key, agent)
      .map((r) => r.session_id);
  }

  /** Đã dọn phiên khỏi máy: bỏ id phiên (lần sau mở phiên mới, không thử nối) + ghi lúc dọn. */
  markCleaned(key: string) {
    this.db.run(`UPDATE task_sessions SET session_id = NULL, cleaned_at = ? WHERE task_id = ?`, [this.now(), key]);
  }

  /** Job đã kết thúc trước `beforeIso` (dọn thư mục log `jobs/{id}`). */
  jobsFinishedBefore(beforeIso: string): number[] {
    return this.db
      .query<{ id: number }, [string]>(
        `SELECT id FROM jobs WHERE status NOT IN ('queued', 'running') AND finished_at IS NOT NULL AND finished_at < ?`,
      )
      .all(beforeIso)
      .map((r) => r.id);
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
