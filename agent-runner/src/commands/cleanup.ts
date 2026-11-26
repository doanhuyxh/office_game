import { formatBytes } from '../core/cleanup';
import type { Command } from './context';

/**
 * `cleanup [--agent NV120] [--dry-run]` (TEST-247): dọn worktree / transcript / thư mục chạy của việc đã xong + log job cũ theo
 * `runner.cleanup` (chạy được cả khi `enabled: false`). `--dry-run` chỉ in những gì sẽ xoá.
 */
export const cleanup: Command = async ({ runner, flags }) => {
  const r = await runner.cleanup({ dryRun: flags.dryRun, agent: flags.agent });
  const verb = flags.dryRun ? 'sẽ xoá' : 'đã xoá';
  for (const i of r.items) {
    const what = [i.cwd, ...i.transcripts].filter(Boolean).join(', ') || 'không còn gì trên máy';
    if (i.kept) console.log(`GIỮ\t${i.agent}\t${i.key}\t${i.reason} — ${i.kept}`);
    else console.log(`${verb}\t${i.agent}\t${i.key}\t${i.reason}\t${formatBytes(i.bytes)}\t${what}`);
  }
  const cleaned = r.items.filter((i) => !i.kept).length;
  console.log(
    `\n${cleaned} phiên ${verb}, ${r.items.length - cleaned} giữ lại; ${r.logDirs} thư mục log job (${formatBytes(r.logBytes)}); ` +
      `tổng ${formatBytes(r.bytes)}`,
  );
  return 0;
};
