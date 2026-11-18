import { hostname } from 'node:os';
import { log } from '../log';
import { type Job, reportKind, type Store, taskIdOf } from '../store';
import { FailureLog, failureKey, HubEndpoint, hubUrl } from './endpoint';
import type { ModelUse } from '../executor/types';

/**
 * Gửi mức dùng AI (chi phí / token) của từng phiên agent lên OfficeHub (TEST-135) — xem theo ngày / tháng / năm, theo model ở
 * Kết nối AI → "Mức dùng AI". POST `<mcp_url>/usage` (token AI của bot) `{ sessions: AiUsageSession[] }`; hợp đồng ở
 * `backend/src/BuildingBlocks/OfficeHub.BuildingBlocks/Ai/AiUsage.cs`, mô tả ở `.agent/business/ai-usage.md`.
 * - Mọi loại job (việc / chat / họp), cả thành công lẫn lỗi — miễn là đã chạy CLI (`jobs.cli_ran`).
 * - Không biết chi phí / token → null (không gửi 0). Token vào = tổng − cache khi CLI báo cache; không báo → tổng, cache null.
 * - Không bao giờ làm hỏng job: chạy nền, lỗi chỉ ghi log; `jobs.usage_sent_at` đánh dấu đã gửi, phiên chưa gửi được gửi lại theo nhịp.
 * - Máy chủ upsert theo `sourceId` → gửi lại không đếm hai lần.
 */

/** Giới hạn của máy chủ (`AiUsageRoute`). */
export const USAGE_MAX_SESSIONS = 50;
const MAX_MODELS = 20,
  MAX_MODEL = 100,
  MAX_TASK_CODE = 50,
  MAX_EXECUTOR = 30;

/** Nhịp gửi lại phiên chưa gửi (máy chủ tạm lỗi / chưa có bản mới). */
export const USAGE_RETRY_MS = 5 * 60_000;

export interface AiUsageModel {
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costUsd: number | null;
}

export interface AiUsageSession {
  sourceId: string;
  kind: 'task' | 'chat' | 'meeting' | 'other';
  taskId?: string;
  projectId?: string;
  taskCode?: string;
  executor?: string;
  status: 'done' | 'failed';
  startedAt: string;
  finishedAt: string;
  turns: number | null;
  costUsd: number | null;
  models?: AiUsageModel[];
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tên máy trong `sourceId`: bỏ dấu `:` (ngăn cách), tối đa 40 ký tự. */
export function sourceHost(name = hostname()): string {
  return (
    name
      .trim()
      .replace(/[:\s]+/g, '-')
      .slice(0, 40) || 'runner'
  );
}

/** `<máy>:<mã runner.db>:<mã NV>:<id job>` — duy nhất theo tài khoản bot; DB mới (máy bị xoá) có mã khác → không ghi đè phiên cũ. */
export function sourceId(job: Pick<Job, 'id' | 'agent'>, host: string, dbId: string): string {
  return `${host}:${dbId}:${job.agent}:${job.id}`;
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const tokens = (x: unknown): number | null => {
  const n = num(x);
  return n === null ? null : Math.max(0, Math.round(n));
};

/** Tổng token vào (gồm cache) + phần cache → token vào không cache / đọc cache / ghi cache (thiếu cache → giữ tổng, cache null). */
export function splitInput(total: number | null, read: number | null, write: number | null) {
  if (read === null && write === null) return { inputTokens: total, cacheReadTokens: null, cacheWriteTokens: null };
  return {
    inputTokens: total === null ? null : Math.max(0, total - (read ?? 0) - (write ?? 0)),
    cacheReadTokens: read,
    cacheWriteTokens: write,
  };
}

/** Model của phiên: `model_usage` (mọi model) → từng dòng; không có → một dòng = model chính với số tổng của phiên; không rõ model → không gửi (máy chủ ghi "không rõ"). */
export function usageModels(job: Job): AiUsageModel[] | undefined {
  let usage: Record<string, ModelUse> | undefined;
  try {
    usage = job.model_usage ? JSON.parse(job.model_usage) : undefined;
  } catch {
    usage = undefined;
  }
  const rows = Object.entries(usage ?? {})
    .filter(([n]) => n.trim())
    .slice(0, MAX_MODELS)
    .map(
      ([name, u]): AiUsageModel => ({
        model: name.trim().slice(0, MAX_MODEL),
        ...splitInput(tokens(u?.inputTokens), tokens(u?.cacheReadTokens), tokens(u?.cacheWriteTokens)),
        outputTokens: tokens(u?.outputTokens),
        costUsd: num(u?.costUsd),
      }),
    );
  if (rows.length) return rows;
  // `jobs.model` có thể kèm " (cấu hình)" (CLI không báo model → model cấu hình) — gửi tên model
  const model = job.model?.replace(/\s*\(cấu hình\)$/, '').trim();
  if (!model) return undefined;
  return [
    {
      model: model.slice(0, MAX_MODEL),
      ...splitInput(tokens(job.input_tokens), tokens(job.cache_read_tokens), tokens(job.cache_write_tokens)),
      outputTokens: tokens(job.output_tokens),
      costUsd: num(job.cost_usd),
    },
  ];
}

/** Job đã xong → một phiên theo hợp đồng `AiUsageSession`. `executor` của job cũ (trước TEST-135) lấy từ cấu hình agent hiện tại. */
export function usageSession(job: Job, host: string, dbId: string, fallbackExecutor?: string): AiUsageSession {
  const kind = reportKind(job.kind) as AiUsageSession['kind'];
  const s: AiUsageSession = {
    sourceId: sourceId(job, host, dbId),
    kind,
    status: job.status === 'done' ? 'done' : 'failed',
    startedAt: job.started_at ?? job.finished_at ?? job.created_at,
    finishedAt: job.finished_at ?? job.created_at,
    turns: job.turns ?? null,
    costUsd: num(job.cost_usd),
  };
  if (kind === 'task') {
    // Chat / họp: task_id là khoá `<mã NV>:<id>`, task_code là nhãn log — không phải việc. Review / deploy: id việc sau tiền tố.
    const taskId = taskIdOf(job);
    if (taskId && GUID.test(taskId)) s.taskId = taskId;
    if (GUID.test(job.project_id)) s.projectId = job.project_id;
    if (job.label.trim()) s.taskCode = job.label.trim().slice(0, MAX_TASK_CODE);
  }
  const executor = (job.executor ?? fallbackExecutor)?.trim();
  if (executor) s.executor = executor.slice(0, MAX_EXECUTOR);
  const models = usageModels(job);
  if (models) s.models = models;
  return s;
}

/** `http://host/mcp` → `http://host/mcp/usage`. */
export const usageUrl = (mcpUrl: string) => hubUrl(mcpUrl, 'usage');

export interface UsageFlushResult {
  sent: number;
  rejected: number;
  /** Dừng giữa chừng (mạng / máy chủ lỗi / chưa có endpoint / bị từ chối token) — phiên còn lại gửi sau. */
  stopped?: string;
}

/**
 * Bộ gửi mức dùng AI của MỘT agent (token AI riêng). `flush()` gửi các phiên chưa gửi theo lô ≤ 50:
 * - 200 → đánh dấu đã gửi.
 * - 400 / 413 (dữ liệu sai / lô quá lớn) → gửi lại từng phiên; phiên vẫn 400 → ghi `usage_error`, runner không tự gửi lại (`usage push` thử lại).
 * - 401 / 403 (token sai / tài khoản không phải bot) → ngừng gửi cho agent này, log một lần (như `presence`).
 * - 404 / 405 (máy chủ chưa có bản mới) và lỗi khác → giữ nguyên, thử lại ở nhịp sau, log một lần.
 */
export class UsageReporter {
  private disabled = false;
  private sending?: Promise<UsageFlushResult>;
  private again = false;
  private readonly endpoint: HubEndpoint;
  private readonly failures: FailureLog;

  constructor(
    mcpUrl: string,
    token: string,
    readonly agent: string,
    private readonly store: Store,
    private readonly source: { host: string; dbId: string; executor?: string },
  ) {
    this.endpoint = new HubEndpoint(mcpUrl, 'usage', token);
    this.failures = new FailureLog(agent);
  }

  get url(): string {
    return this.endpoint.url;
  }

  get isDisabled() {
    return this.disabled;
  }

  /**
   * Gửi phiên chưa gửi. Đang gửi dở → chờ lượt đó rồi gửi thêm một lượt (phiên vừa xong không phải chờ nhịp 5 phút).
   * `all` (`usage push`): cả job cũ trước TEST-135 + phiên từng bị từ chối; `sinceIso`: chỉ job xong từ mốc này.
   */
  flush(o: { all?: boolean; sinceIso?: string } = {}): Promise<UsageFlushResult> {
    if (this.sending) {
      this.again = true;
      return this.sending;
    }
    this.sending = (async () => {
      let total: UsageFlushResult = { sent: 0, rejected: 0 };
      do {
        this.again = false;
        const r = await this.flushOnce(o);
        total = { sent: total.sent + r.sent, rejected: total.rejected + r.rejected, stopped: r.stopped };
      } while (this.again && !total.stopped);
      return total;
    })().finally(() => {
      this.sending = undefined;
    });
    return this.sending;
  }

  private async flushOnce(o: { all?: boolean; sinceIso?: string }): Promise<UsageFlushResult> {
    const out: UsageFlushResult = { sent: 0, rejected: 0 };
    let afterId = 0;
    while (!this.disabled) {
      const jobs = this.store.pendingUsage(this.agent, {
        afterId,
        limit: USAGE_MAX_SESSIONS,
        all: o.all,
        sinceIso: o.sinceIso,
      });
      if (!jobs.length) break;
      afterId = jobs.at(-1)!.id;
      const r = await this.send(jobs);
      if (r.status === 'ok') {
        this.store.markUsageSent(jobs.map((j) => j.id));
        out.sent += jobs.length;
        continue;
      }
      if (r.status !== 'invalid') {
        out.stopped = r.detail;
        break;
      }
      // Lô bị từ chối → từng phiên một để chỉ bỏ phiên sai
      for (const j of jobs) {
        const one = jobs.length === 1 ? r : await this.send([j]);
        if (one.status === 'ok') {
          this.store.markUsageSent([j.id]);
          out.sent++;
          continue;
        }
        if (one.status !== 'invalid') {
          out.stopped = one.detail;
          return out;
        }
        this.store.markUsageRejected(j.id, one.detail);
        out.rejected++;
        log('warn', 'OfficeHub từ chối mức dùng AI của phiên — bỏ qua (usage push để thử lại)', {
          agent: this.agent,
          job: j.id,
          error: one.detail,
        });
      }
    }
    if (out.sent) this.failures.recovered('gửi mức dùng AI đã chạy lại');
    return out;
  }

  private async send(jobs: Job[]): Promise<SendResult> {
    const body = {
      sessions: jobs.map((j) => usageSession(j, this.source.host, this.source.dbId, this.source.executor)),
    };
    const outcome = await this.endpoint.post(body, SEND_TIMEOUT_MS);
    if (outcome.status === 'ok') {
      const accepted = (await outcome.response.json().catch(() => undefined)) as
        | { accepted?: number; created?: number; updated?: number }
        | undefined;
      log('info', 'đã gửi mức dùng AI', {
        agent: this.agent,
        sessions: jobs.length,
        created: accepted?.created,
        updated: accepted?.updated,
      });
      return { status: 'ok', detail: '' };
    }
    const codeAndDetail = `${outcome.code ?? ''} ${outcome.detail}`.trim();
    if (outcome.status === 'invalid') return { status: 'invalid', detail: codeAndDetail };
    if (outcome.status === 'denied') {
      this.disabled = true;
      log(
        'warn',
        'OfficeHub không nhận mức dùng AI — ngừng gửi cho agent này (token sai / tài khoản chưa được HR đánh dấu là bot?)',
        { agent: this.agent, status: outcome.code, error: outcome.detail },
      );
      return { status: 'denied', detail: codeAndDetail };
    }
    if (outcome.status === 'missing')
      return this.retryLater(
        failureKey(outcome),
        'OfficeHub chưa có endpoint mức dùng AI — deploy bản mới + nginx `location = /mcp/usage`; runner giữ phiên và thử lại sau',
      );
    const key = outcome.code === undefined ? outcome.detail : `${failureKey(outcome)} ${outcome.detail}`.trim();
    return this.retryLater(key, 'gửi mức dùng AI lỗi — thử lại sau');
  }

  /** Giữ phiên, thử lại ở nhịp sau; lỗi giống lần trước không ghi lại (nhịp 5 phút không làm đầy log). */
  private retryLater(key: string, message: string): SendResult {
    this.failures.warn(key, message);
    return { status: 'retry', detail: key };
  }
}

interface SendResult {
  status: 'ok' | 'invalid' | 'retry' | 'denied';
  detail: string;
}

/** Hạn gửi một lô phiên. */
const SEND_TIMEOUT_MS = 20_000;
