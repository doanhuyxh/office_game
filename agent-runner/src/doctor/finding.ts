/** Một dòng kết quả kiểm tra (`doctor` / khởi động): dữ liệu có cấu trúc, chỉ dựng chuỗi ở nơi in. */
export type FindingLevel = 'ok' | 'warn' | 'fail';

export interface Finding {
  level: FindingLevel;
  /** Mã NV của agent; không có = kiểm tra chung của runner (git). */
  agent?: string;
  /** Phạm vi phụ trong agent, vd "chat / họp" (model của `executor.light`). */
  scope?: string;
  text: string;
}

const MARK: Record<FindingLevel, string> = { ok: '✔', warn: '⚠', fail: '✘' };

/** `✔ NV120: token AI đúng nhân viên` · `⚠ NV120 (chat / họp): …` · `✔ git: …`. */
export function formatFinding(f: Finding): string {
  const who = f.agent ? `${f.agent}${f.scope ? ` (${f.scope})` : ''}: ` : '';
  return `${MARK[f.level]} ${who}${f.text}`;
}

export const hasFailure = (findings: Finding[]) => findings.some((f) => f.level === 'fail');

/** Mức log tương ứng khi in kết quả kiểm tra lúc khởi động. */
export const findingLogLevel = (f: Finding) => (f.level === 'fail' ? 'error' : f.level === 'warn' ? 'warn' : 'info');

/** Gom kết quả kiểm tra của một agent. Lỗi làm agent tắt thì ném {@link CheckFailed} (dừng các kiểm tra sau). */
export class Report {
  readonly findings: Finding[] = [];

  constructor(private readonly agent: string) {}

  ok(text: string, scope?: string) {
    this.findings.push({ level: 'ok', agent: this.agent, scope, text });
  }

  warn(text: string, scope?: string) {
    this.findings.push({ level: 'warn', agent: this.agent, scope, text });
  }

  fail(text: string) {
    this.findings.push({ level: 'fail', agent: this.agent, text });
  }
}

/** Kiểm tra không đạt → agent tắt; thông điệp là dòng ✘. */
export class CheckFailed extends Error {}
