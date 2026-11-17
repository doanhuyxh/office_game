import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { mask } from '../executor/events';
import { errText, log } from '../log';
import { RESUME_MAX_GAP_MIN } from '../policy';
import type { Store } from '../store';
import { FailureLog, failureKey, HubEndpoint, hubUrl } from './endpoint';

/**
 * Transcript phiên agent lên cloud (TEST-144, chủ dự án chốt 2026-11-17: lưu cả transcript, 90 ngày, máy chủ mã hoá như lương, admin + HR xem).
 * - Gửi: sau mỗi phiên CLI có transcript (adapter `claude`), ở nền, như mức dùng AI — đọc `<HOME>/.claude/projects/<cwd>/<session>.jsonl`, che bí mật
 *   từng chuỗi trong JSON ({@link redactTranscript} — giữ JSON hợp lệ để `--resume` đọc được), gzip, POST `<mcp_url>/transcripts`. Một bản / khoá job
 *   (gửi lại = thay). 401 / 403 → ngừng cho agent; 404 / 405 / lỗi khác → thử lại theo nhịp; 400 / quá lớn → bỏ (ghi lỗi).
 * - Khôi phục LƯỜI theo từng phiên ({@link TranscriptReporter.restore}): chỉ khi runner sắp `--resume` (lần trước ≤ 10 phút) mà transcript không còn ở
 *   máy (máy mới / HOME bị xoá) → GET bản của đúng khoá đó, ghi lại vào thư mục transcript của cwd. Không có lệnh khôi phục toàn bộ.
 */

/** Giới hạn của máy chủ (`AgentTranscriptRoute`). */
export const TRANSCRIPT_MAX_GZIP = 6 * 1024 * 1024;
const MAX_SUMMARY = 4000;

/** Che bí mật trong mọi chuỗi của một giá trị JSON (đệ quy) bằng {@link mask}; số / bool / null giữ nguyên. */
function maskDeep(v: unknown): unknown {
  if (typeof v === 'string') return mask(v);
  if (Array.isArray(v)) return v.map(maskDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskDeep(x)]));
  return v;
}

/**
 * Che bí mật transcript .jsonl: mỗi dòng JSON → che từng chuỗi rồi ghi lại (che thẳng trên dòng sẽ phá cú pháp JSON, vd `"token":"x"` → `"token":***`);
 * dòng không phải JSON → che cả dòng. Thà che nhầm còn hơn lộ.
 */
export function redactTranscript(jsonl: string): string {
  return jsonl
    .split('\n')
    .map((line) => {
      if (!line.trim()) return line;
      try {
        return JSON.stringify(maskDeep(JSON.parse(line)));
      } catch {
        return mask(line);
      }
    })
    .join('\n');
}

/** Đường dẫn file transcript của phiên `sessionId` chạy ở `cwd` — do adapter của CLI quyết định (`Adapter.transcriptFile`). */
export type TranscriptLocator = (cwd: string, sessionId: string) => string;

/** File transcript của phiên ở máy (thử cwd và đường dẫn thật của cwd); không có → undefined. */
export function transcriptFile(locate: TranscriptLocator, cwd: string, sessionId: string): string | undefined {
  const dirs = [cwd];
  try {
    dirs.push(realpathSync(cwd));
  } catch {
    /* cwd đã bị xoá */
  }
  return dirs.map((d) => locate(d, sessionId)).find((f) => existsSync(f));
}

export const sha256Hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** `http://host/mcp` → `http://host/mcp/transcripts`. */
export const transcriptUrl = (mcpUrl: string) => hubUrl(mcpUrl, 'transcripts');

/** Bản đã lưu trên cloud (GET) — khớp `AgentTranscriptDto`. */
export interface CloudTranscript {
  key: string;
  kind: string;
  sessionId: string;
  sha256: string;
  updatedAt: string;
  contentBase64?: string | null;
}

export class TranscriptReporter {
  private disabled = false;
  private sending?: Promise<number>;
  private again = false;
  private readonly endpoint: HubEndpoint;
  private readonly failures: FailureLog;

  /** `locate` = nơi CLI của agent ghi transcript (theo HOME của agent). */
  constructor(
    mcpUrl: string,
    token: string,
    readonly agent: string,
    private readonly store: Store,
    private readonly locate: TranscriptLocator,
  ) {
    this.endpoint = new HubEndpoint(mcpUrl, 'transcripts', token);
    this.failures = new FailureLog(agent);
  }

  get url(): string {
    return this.endpoint.url;
  }

  get isDisabled() {
    return this.disabled;
  }

  /** Gửi các phiên đang chờ. Gọi chồng nhau → chờ lượt đang gửi rồi gửi thêm một lượt. Trả số bản đã gửi. */
  flush(): Promise<number> {
    if (this.sending) {
      this.again = true;
      return this.sending;
    }
    this.sending = (async () => {
      let n = 0;
      do {
        this.again = false;
        n += await this.flushOnce();
      } while (this.again && !this.disabled);
      return n;
    })().finally(() => {
      this.sending = undefined;
    });
    return this.sending;
  }

  private async flushOnce(): Promise<number> {
    let sent = 0;
    for (const row of this.store.pendingTranscripts(this.agent)) {
      if (this.disabled) break;
      const file = transcriptFile(this.locate, row.worktree, row.session_id!);
      if (!file) {
        this.store.doneTranscript(row.key, { error: 'không còn file transcript ở máy' });
        continue;
      }
      let gz: Uint8Array;
      try {
        if (statSync(file).size > 200 * 1024 * 1024) throw new Error('file > 200 MB');
        gz = Bun.gzipSync(Buffer.from(redactTranscript(readFileSync(file, 'utf8'))));
      } catch (e) {
        this.store.doneTranscript(row.key, { error: `không đọc được transcript: ${errText(e)}` });
        continue;
      }
      const sha = sha256Hex(gz);
      if (sha === row.transcript_sha) {
        this.store.doneTranscript(row.key, { sha });
        continue;
      } // không đổi từ lần gửi trước
      if (gz.length > TRANSCRIPT_MAX_GZIP) {
        this.store.doneTranscript(row.key, {
          error: `transcript ${(gz.length / 1048576).toFixed(1)} MB sau nén > 6 MB — không gửi`,
        });
        log('warn', 'transcript quá lớn — không gửi lên cloud', {
          agent: this.agent,
          key: row.key,
          mb: +(gz.length / 1048576).toFixed(1),
        });
        continue;
      }
      const r = await this.post({
        key: row.key,
        kind: row.kind ?? 'task',
        sessionId: row.session_id,
        cwd: row.worktree || null,
        branch: row.branch || null,
        summary: row.summary ? mask(row.summary).slice(0, MAX_SUMMARY) : null,
        contentBase64: Buffer.from(gz).toString('base64'),
      });
      if (r === 'ok') {
        this.store.doneTranscript(row.key, { sha });
        sent++;
        continue;
      }
      if (r === 'invalid') {
        this.store.doneTranscript(row.key, { error: 'OfficeHub từ chối (400)' });
        continue;
      }
      break; // retry / denied: thử lại ở nhịp sau (denied đã tắt bộ gửi)
    }
    if (sent) log('info', 'đã gửi transcript lên cloud', { agent: this.agent, sessions: sent });
    return sent;
  }

  private async post(body: Record<string, unknown>): Promise<'ok' | 'invalid' | 'retry' | 'denied'> {
    const outcome = await this.endpoint.post(body, UPLOAD_TIMEOUT_MS);
    if (outcome.status === 'ok') {
      this.failures.clear();
      return 'ok';
    }
    if (outcome.status === 'invalid') {
      log('warn', 'OfficeHub từ chối transcript — bỏ qua', {
        agent: this.agent,
        key: body.key,
        status: outcome.code,
        error: outcome.detail,
      });
      return 'invalid';
    }
    if (outcome.status === 'denied') {
      this.disabled = true;
      log(
        'warn',
        'OfficeHub không nhận transcript — ngừng gửi cho agent này (token sai / tài khoản chưa được HR đánh dấu là bot?)',
        { agent: this.agent, status: outcome.code },
      );
      return 'denied';
    }
    const hint =
      outcome.status === 'missing'
        ? 'OfficeHub chưa có endpoint transcript — deploy bản mới + nginx `location = /mcp/transcripts`; runner giữ hàng chờ'
        : 'gửi transcript lỗi — thử lại sau';
    this.failures.warn(failureKey(outcome), hint);
    return 'retry';
  }

  /**
   * Khôi phục LƯỜI một phiên (TEST-144): bản trên cloud của `key`, nếu còn trong ngưỡng nối phiên ({@link RESUME_MAX_GAP_MIN} phút từ lần gửi cuối)
   * → ghi vào thư mục transcript của `cwd`, trả id phiên để `--resume`. Không có / quá ngưỡng / lỗi → undefined (runner mở phiên mới).
   */
  async restore(key: string, cwd: string): Promise<string | undefined> {
    if (this.disabled) return undefined;
    const outcome = await this.endpoint.get({ key }, DOWNLOAD_TIMEOUT_MS);
    if (outcome.status !== 'ok') {
      // 404 = chưa có bản; mã lỗi khác → phiên mới (không chặn job). Chỉ lỗi mạng mới đáng ghi log.
      if (outcome.status === 'error' && outcome.code === undefined) this.downloadFailed(key, outcome.detail);
      return undefined;
    }
    let dto: CloudTranscript;
    try {
      dto = (await outcome.response.json()) as CloudTranscript;
    } catch (e) {
      this.downloadFailed(key, errText(e));
      return undefined;
    }
    const gapMin = (Date.now() - Date.parse(dto.updatedAt)) / 60_000;
    if (!dto.contentBase64 || !dto.sessionId || !(gapMin <= RESUME_MAX_GAP_MIN)) return undefined;
    const gz = Buffer.from(dto.contentBase64, 'base64');
    if (sha256Hex(gz) !== dto.sha256) {
      log('warn', 'transcript trên cloud lệch sha256 — bỏ', { agent: this.agent, key });
      return undefined;
    }
    const file = this.locate(cwd, dto.sessionId);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Bun.gunzipSync(gz), { mode: 0o600 });
    log('info', 'đã khôi phục transcript từ cloud để nối phiên', { agent: this.agent, key, session: dto.sessionId });
    return dto.sessionId;
  }

  private downloadFailed(key: string, error: string) {
    log('warn', 'không tải được transcript từ cloud — mở phiên mới', { agent: this.agent, key, error });
  }
}

/** Hạn tải lên / tải về một transcript (tới 6 MB sau nén). */
const UPLOAD_TIMEOUT_MS = 120_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
