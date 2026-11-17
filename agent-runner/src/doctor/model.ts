import type { ExecutorConfig } from '../config';
import { modelMatches } from '../executor/model';
import { adapters } from '../executor/run';
import { sh } from '../workspace';
import { CheckFailed, type Report } from './finding';

/** Hạn chạy thử model (một lượt không tool, không MCP). */
const PROBE_TIMEOUT_MS = 120_000;

export interface ModelProbe {
  exec: ExecutorConfig;
  env: Record<string, string>;
  /** Thư mục chạy lệnh thử (data_dir — ngoài repo). */
  cwd: string;
  /** false = `--no-model-check`. */
  enabled: boolean;
  /** Model phụ đang kiểm tra, vd "chat / họp" (`executor.light`); không có = model chính. */
  scope?: string;
}

/**
 * Model thật của agent (TEST-64): adapter có `probe` → chạy thử một lượt, đọc model từ output. Model không hợp lệ → {@link CheckFailed} (agent tắt);
 * chạy thử lỗi / lệch cấu hình → cảnh báo, vẫn bật. Trả model thật đọc được (undefined = không chạy thử / không đọc được).
 */
export async function checkModel(p: ModelProbe, report: Report): Promise<string | undefined> {
  const configured = p.exec.model;
  const adapter = adapters[p.exec.kind];
  if (!adapter?.probe || !adapter.parseProbe) {
    const note = `adapter ${p.exec.kind} không chạy thử — đọc model từ output mỗi job nếu có`;
    report.ok(`model ${configured ?? 'mặc định của CLI'} (${note})`, p.scope);
    return undefined;
  }
  if (!p.enabled) {
    report.ok(`model ${configured ?? 'mặc định của CLI'} — chưa kiểm tra (--no-model-check)`, p.scope);
    return undefined;
  }
  const cmd = adapter.probe(p.exec);
  const run = await sh([cmd.bin, ...cmd.args], p.cwd, p.env, PROBE_TIMEOUT_MS);
  const probe = adapter.parseProbe(run.out);
  if (probe.invalidModel)
    throw new CheckFailed(
      `model ${p.scope ? `${p.scope} ` : ''}${configured ?? '(mặc định)'} không hợp lệ: ${probe.error}`,
    );
  if (probe.error || !probe.model) {
    const why = probe.error ?? `không đọc được model, mã thoát ${run.code}`;
    report.warn(`chạy thử model lỗi (${why}) — vẫn bật agent`, p.scope);
    return undefined;
  }
  if (!modelMatches(configured, probe.model)) {
    report.warn(`model thật ${probe.model} KHÁC cấu hình ${configured}`, p.scope);
    return probe.model;
  }
  report.ok(`model thật ${probe.model}${configuredNote(configured, probe.model)}`, p.scope);
  return probe.model;
}

function configuredNote(configured: string | undefined, actual: string): string {
  if (!configured) return ' (mặc định của CLI)';
  return configured === actual ? '' : ` (cấu hình ${configured})`;
}
