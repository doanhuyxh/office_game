import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { redact } from '../log';
import { claudeAdapter } from './adapters/claude';
import { customAdapter } from './adapters/custom';
import type { Adapter, ExecContext, ExecResult } from './types';

export const adapters: Record<string, Adapter> = { claude: claudeAdapter, custom: customAdapter };

export interface RunOutcome extends ExecResult { exitCode: number | null; timedOut: boolean; durationSec: number }

/**
 * Chạy CLI của agent trong worktree. Tiến trình tách nhóm (detached) → hết giờ / huỷ thì SIGTERM cả process group, 10 giây sau SIGKILL
 * (CLI agent hay sinh tiến trình con: dotnet, bun, git…). stdout / stderr ghi ra {jobDir}/output.log (đã che bí mật).
 */
export function runExecutor(ctx: ExecContext, env: Record<string, string>, signal?: AbortSignal): Promise<RunOutcome> {
  const adapter = adapters[ctx.exec.kind];
  if (!adapter) throw new Error(`Không có adapter ${ctx.exec.kind}`);
  const cmd = adapter.command(ctx);
  const started = Date.now();
  const r: ExecResult = {};
  const logFile = createWriteStream(join(ctx.jobDir, 'output.log'));
  let tail = '';
  const extract = ctx.onEvent ? adapter.events?.(ctx.cwd) : undefined;
  return new Promise((resolveRun, reject) => {
    const child = spawn(cmd.bin, cmd.args, { cwd: ctx.cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const killGroup = () => {
      if (!child.pid) return;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* đã thoát */ }
      killTimer = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* đã thoát */ } }, 10_000);
    };
    const timer = setTimeout(() => { timedOut = true; killGroup(); }, ctx.exec.timeoutMin * 60_000);
    signal?.addEventListener('abort', killGroup, { once: true });
    createInterface({ input: child.stdout! }).on('line', (line) => {
      logFile.write(redact(line) + '\n');
      tail = (tail + line + '\n').slice(-4000);
      adapter.parseLine(line, r);
      if (ctx.onActivity && adapter.activity) for (const a of adapter.activity(line, ctx.cwd)) ctx.onActivity(a);
      if (extract) {
        // Lỗi khi tách / gửi sự kiện xem trực tiếp không được làm hỏng job
        try { for (const e of extract(line)) ctx.onEvent!(e); } catch { /* bỏ qua */ }
      }
    });
    child.stderr!.on('data', (d: Buffer) => logFile.write('[stderr] ' + redact(d.toString())));
    child.on('error', (e) => { clearTimeout(timer); logFile.end(); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      adapter.finish?.(tail, r);
      // CLI không báo model → ghi model cấu hình, đánh dấu để bình luận / report ghi "(cấu hình)".
      if (!r.model && ctx.exec.model) { r.model = ctx.exec.model; r.modelFromConfig = true; }
      logFile.end();
      resolveRun({ ...r, exitCode: code, timedOut, durationSec: Math.round((Date.now() - started) / 1000) });
    });
  });
}
