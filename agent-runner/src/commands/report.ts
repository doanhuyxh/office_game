import { KIND_LABEL, kindReportLines } from '../report';
import type { Command } from './context';

const DAY_MS = 86_400_000;

const money = (cost: number | null) => `$${(cost ?? 0).toFixed(2)}`;
const tokens = (input: number | null, output: number | null) => `${input ?? 0} vào / ${output ?? 0} ra`;

/** `report [--days 1]`: chi phí các phiên đã xong trong N ngày gần nhất — theo agent, theo loại job, theo model. */
export const report: Command = async ({ store, flags }) => {
  const days = Number(flags.days ?? 1);
  if (!Number.isFinite(days) || days <= 0) {
    console.error(`--days phải là số > 0: ${flags.days}`);
    return 2;
  }
  const since = new Date(Date.now() - days * DAY_MS).toISOString();

  for (const r of store.costs(since))
    console.log(`${r.agent}\t${r.jobs} phiên\t${money(r.cost)}\t${tokens(r.input, r.output)}`);

  const kinds = store.costsByKind(since);
  if (kinds.length) {
    console.log('\nTheo loại (token vào không cache · ghi cache · đọc cache · ra; tỉ lệ đọc cache):');
    console.log(kindReportLines(kinds).join('\n'));
  }

  const byModel = store.costsByModel(since);
  if (byModel.length) {
    console.log('\nTheo model (model chính của phiên, theo loại job — chat / họp dùng executor.light nếu có):');
    for (const r of byModel) {
      const kind = KIND_LABEL[r.kind] ?? r.kind;
      const model = r.model ?? 'không rõ';
      console.log(`${r.agent}\t${kind}\t${model}\t${r.jobs} phiên\t${money(r.cost)}\t${tokens(r.input, r.output)}`);
    }
  }
  return 0;
};
