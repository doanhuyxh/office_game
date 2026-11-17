import type { AgentState } from '../core/agent';
import { USAGE_MAX_SESSIONS, usageSession } from '../hub/usage';
import type { Store } from '../store';
import type { Command } from './context';

/** Số phiên đọc mỗi lượt khi chỉ xem trước. */
const PREVIEW_PAGE = 500;

/**
 * `usage push [--since yyyy-MM-dd] [--agent NV120] [--dry-run]`: gửi bù mức dùng AI các phiên chưa gửi lên OfficeHub — gồm phiên cũ trước khi
 * có tính năng và phiên từng bị từ chối; gửi lại không tạo trùng (máy chủ upsert theo `sourceId`). Có phiên bị từ chối / dừng giữa chừng → mã thoát 1.
 */
export const usagePush: Command = async ({ store, runner, flags, args }) => {
  if (args[0] !== 'push') {
    console.error('Dùng: usage push [--since yyyy-MM-dd] [--agent NV120] [--dry-run]');
    return 2;
  }
  const since = parseSince(flags.since);
  if (since === undefined) {
    console.error(`--since phải là ngày yyyy-MM-dd: ${flags.since}`);
    return 2;
  }
  let failed = false;
  for (const { agent, n } of store.pendingUsageAgents(since)) {
    if (flags.agent && agent !== flags.agent) continue;
    const state = runner.agents.get(agent);
    if (!state) {
      console.log(`${agent}\t${n} phiên chưa gửi — bỏ qua (agent không còn trong cấu hình, không có token)`);
      continue;
    }
    if (flags.dryRun) {
      console.log(preview(store, state, n, since));
      continue;
    }
    const r = await state.usage.flush({ all: true, sinceIso: since });
    const rejected = r.rejected ? ` · ${r.rejected} phiên bị từ chối (xem log)` : '';
    const stopped = r.stopped ? ` · DỪNG: ${r.stopped}` : '';
    console.log(`${agent}\tđã gửi ${r.sent}/${n} phiên (lô ≤ ${USAGE_MAX_SESSIONS})${rejected}${stopped}`);
    if (r.stopped || r.rejected) failed = true;
  }
  return failed ? 1 : 0;
};

/** `--since` → mốc ISO (ngày theo giờ Việt Nam — OfficeHub gộp theo giờ văn phòng); không đặt → '' (mọi phiên); sai dạng → undefined. */
function parseSince(since: string | undefined): string | undefined {
  if (since === undefined) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) return undefined;
  const ms = Date.parse(`${since}T00:00:00+07:00`);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/** `--dry-run`: một dòng tóm tắt phần sẽ gửi của một agent (khoảng ngày, tổng chi phí), không gọi mạng. */
function preview(store: Store, state: AgentState, count: number, sinceIso: string): string {
  const agent = state.cfg.employeeCode;
  let cost = 0;
  let withoutCost = 0;
  let first = '';
  let last = '';
  for (let afterId = 0; ; ) {
    const jobs = store.pendingUsage(agent, { all: true, sinceIso, afterId, limit: PREVIEW_PAGE });
    if (!jobs.length) break;
    afterId = jobs.at(-1)!.id;
    for (const job of jobs) {
      const session = usageSession(job, 'x', 'x', state.cfg.executor.kind);
      if (session.costUsd === null) withoutCost++;
      else cost += session.costUsd;
      first ||= session.finishedAt;
      last = session.finishedAt;
    }
  }
  const range = `${first.slice(0, 10)} → ${last.slice(0, 10)}`;
  const missing = withoutCost ? ` · ${withoutCost} phiên không có chi phí` : '';
  return `${agent}\t${count} phiên chưa gửi (${range})\t$${cost.toFixed(2)}${missing}\t→ ${state.usage.url}`;
}
