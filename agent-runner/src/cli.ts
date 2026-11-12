#!/usr/bin/env bun
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigError, loadConfig } from './config';
import { errText, log } from './log';
import { Runner } from './runner';
import { Store } from './store';

const HELP = `officehub-agent-runner — bộ điều phối agent (TEST-44)

  start                               nghe Telegram, chạy việc được giao (dịch vụ systemd)
  doctor [--agent NV120] [--no-telegram]   kiểm tra cấu hình: CLI, token, repo, hook, bot Telegram, gh
  run --agent NV120 --task TEST-45    chạy ngay một việc (bỏ qua Telegram, vẫn hỏi lại OfficeHub) rồi thoát
  report [--days 1]                   tổng chi phí theo agent

  --config <file>   mặc định $RUNNER_CONFIG hoặc /etc/officehub-runner/agents.yaml`;

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd || cmd === '--help' || cmd === 'help') { console.log(HELP); return 0; }
  const path = arg('--config') ?? process.env.RUNNER_CONFIG ?? '/etc/officehub-runner/agents.yaml';
  const { config, warnings } = loadConfig(path);
  for (const w of warnings) log('warn', w);
  mkdirSync(config.dataDir, { recursive: true });
  const store = new Store(join(config.dataDir, 'runner.db'));
  const runner = new Runner(config, store);

  switch (cmd) {
    case 'doctor': {
      const lines = await runner.checkAgents(arg('--agent')?.toUpperCase(), !process.argv.includes('--no-telegram'));
      console.log(lines.join('\n'));
      return lines.some((l) => l.startsWith('✘')) ? 1 : 0;
    }
    case 'run': {
      const code = arg('--agent')?.toUpperCase(), task = arg('--task');
      if (!code || !task) { console.error('Cần --agent và --task'); return 2; }
      const lines = await runner.checkAgents(code, false);
      console.log(lines.join('\n'));
      const s = runner.agents.get(code);
      if (!s?.enabled) return 1;
      const t = (await s.hub.getTask(task))?.task;
      if (!t?.id) { console.error(`Không đọc được việc ${task}`); return 1; }
      const id = await runner.accept(s, { employee_code: code, project_id: t.projectId, task_id: t.id, task_code: t.code });
      if (!id) { console.error('Việc không chạy được (xem log ở trên)'); return 1; }
      const job = store.claimNext(1, [code]);
      if (!job) { console.error('Agent đang có job khác chạy'); return 1; }
      await runner.process(job);
      const done = store.getJob(job.id)!;
      console.log(JSON.stringify({ status: done.status, reason: done.reason, pr: done.pr_url, cost: done.cost_usd }, null, 2));
      return done.status === 'done' ? 0 : 1;
    }
    case 'report': {
      const days = Number(arg('--days') ?? 1);
      const rows = store.costs(new Date(Date.now() - days * 86_400_000).toISOString());
      for (const r of rows) console.log(`${r.agent}\t${r.jobs} việc\t$${(r.cost ?? 0).toFixed(2)}\t${r.input ?? 0} vào / ${r.output ?? 0} ra`);
      return 0;
    }
    case 'start': {
      const stop = () => { log('info', 'dừng runner'); runner.stop(); setTimeout(() => process.exit(0), 12_000); };
      process.on('SIGTERM', stop);
      process.on('SIGINT', stop);
      await runner.start();
      return 0;
    }
    default:
      console.error(HELP);
      return 2;
  }
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error(e instanceof ConfigError ? e.message : errText(e));
  process.exit(1);
});
