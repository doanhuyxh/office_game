#!/usr/bin/env bun
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigError, loadConfig } from './config';
import { formatFinding, hasFailure } from './doctor/finding';
import { errText, log, setLogFormat } from './log';
import { KIND_LABEL, kindReportLines } from './report';
import { Runner } from './runner';
import { Store } from './store';
import { USAGE_MAX_SESSIONS, usageSession } from './hub/usage';

const HELP = `officehub-agent-runner — bộ điều phối agent (TEST-44)

  start [--no-model-check]            nghe Telegram, chạy việc được giao (dịch vụ systemd)
  doctor [--agent NV120] [--no-telegram] [--no-model-check]
                                      kiểm tra cấu hình: CLI, model thật, token, repo, hook, bot Telegram, gh
  run --agent NV120 --task TEST-45 [--no-model-check]
                                      chạy ngay một việc (bỏ qua Telegram, vẫn hỏi lại OfficeHub) rồi thoát
  report [--days 1]                   tổng chi phí theo agent và theo model
  usage push [--since 2026-11-01] [--agent NV120] [--dry-run]
                                      gửi chi phí / token các phiên chưa gửi lên OfficeHub ("Mức dùng AI") — gồm phiên cũ
                                      trước khi có tính năng này và phiên từng bị từ chối; gửi lại không tạo trùng

  --no-model-check  không chạy thử CLI để đọc model thật (mỗi agent tốn vài trăm token)

  --config <file>   mặc định $RUNNER_CONFIG hoặc /etc/officehub-runner/agents.yaml`;

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd || cmd === '--help' || cmd === 'help') {
    console.log(HELP);
    return 0;
  }
  const path = arg('--config') ?? process.env.RUNNER_CONFIG ?? '/etc/officehub-runner/agents.yaml';
  const { config, warnings } = loadConfig(path);
  setLogFormat(config.logFormat);
  for (const w of warnings) log('warn', w);
  mkdirSync(config.dataDir, { recursive: true });
  const store = new Store(join(config.dataDir, 'runner.db'));
  const runner = new Runner(config, store);
  const modelCheck = !process.argv.includes('--no-model-check');

  switch (cmd) {
    case 'doctor': {
      const findings = await runner.checkAgents({
        only: arg('--agent')?.toUpperCase(),
        telegram: !process.argv.includes('--no-telegram'),
        modelCheck,
      });
      console.log(findings.map(formatFinding).join('\n'));
      return hasFailure(findings) ? 1 : 0;
    }
    case 'run': {
      const code = arg('--agent')?.toUpperCase(),
        task = arg('--task');
      if (!code || !task) {
        console.error('Cần --agent và --task');
        return 2;
      }
      const findings = await runner.checkAgents({ only: code, telegram: false, modelCheck });
      console.log(findings.map(formatFinding).join('\n'));
      const s = runner.agents.get(code);
      if (!s?.enabled) return 1;
      const t = (await s.hub.getTask(task))?.task;
      if (!t?.id) {
        console.error(`Không đọc được việc ${task}`);
        return 1;
      }
      const id = await runner.accept(s, {
        employee_code: code,
        project_id: t.projectId,
        task_id: t.id,
        task_code: t.code,
      });
      if (!id) {
        console.error('Việc không chạy được (xem log ở trên)');
        return 1;
      }
      const job = store.claimNext(1, [code]);
      if (!job) {
        console.error('Agent đang có job khác chạy');
        return 1;
      }
      await runner.process(job);
      await s.activity.drain(); // chạy một lần rồi thoát: job đã ghi xong, chờ tối đa 3 giây để người xem nhận nốt "kết thúc phiên"
      await s.usage.flush(); // gửi mức dùng AI trước khi thoát (lỗi → phiên còn chờ, `start` / `usage push` gửi sau)
      await s.transcripts?.flush(); // TEST-144: transcript lên cloud (lỗi → còn trong hàng chờ, `start` gửi sau)
      const done = store.getJob(job.id)!;
      console.log(
        JSON.stringify(
          { status: done.status, reason: done.reason, pr: done.pr_url, model: done.model, cost: done.cost_usd },
          null,
          2,
        ),
      );
      return done.status === 'done' ? 0 : 1;
    }
    case 'report': {
      const days = Number(arg('--days') ?? 1);
      const rows = store.costs(new Date(Date.now() - days * 86_400_000).toISOString());
      for (const r of rows)
        console.log(
          `${r.agent}\t${r.jobs} phiên\t$${(r.cost ?? 0).toFixed(2)}\t${r.input ?? 0} vào / ${r.output ?? 0} ra`,
        );
      const kinds = store.costsByKind(new Date(Date.now() - days * 86_400_000).toISOString());
      if (kinds.length)
        console.log(
          '\nTheo loại (token vào không cache · ghi cache · đọc cache · ra; tỉ lệ đọc cache):\n' +
            kindReportLines(kinds).join('\n'),
        );
      const byModel = store.costsByModel(new Date(Date.now() - days * 86_400_000).toISOString());
      if (byModel.length) {
        console.log('\nTheo model (model chính của phiên, theo loại job — chat / họp dùng executor.light nếu có):');
        for (const r of byModel)
          console.log(
            `${r.agent}\t${KIND_LABEL[r.kind] ?? r.kind}\t${r.model ?? 'không rõ'}\t${r.jobs} phiên\t$${(r.cost ?? 0).toFixed(2)}\t${r.input ?? 0} vào / ${r.output ?? 0} ra`,
          );
      }
      return 0;
    }
    case 'usage': {
      if (process.argv[3] !== 'push') {
        console.error(HELP);
        return 2;
      }
      const since = arg('--since'),
        only = arg('--agent')?.toUpperCase(),
        dry = process.argv.includes('--dry-run');
      // Ngày theo giờ Việt Nam (OfficeHub gộp theo giờ văn phòng)
      const sinceMs = since && /^\d{4}-\d{2}-\d{2}$/.test(since) ? Date.parse(`${since}T00:00:00+07:00`) : NaN;
      if (since !== undefined && Number.isNaN(sinceMs)) {
        console.error(`--since phải là ngày yyyy-MM-dd: ${since}`);
        return 2;
      }
      const sinceIso = since ? new Date(sinceMs).toISOString() : '';
      let failed = false;
      for (const { agent, n } of store.pendingUsageAgents(sinceIso)) {
        if (only && agent !== only) continue;
        const s = runner.agents.get(agent);
        if (!s) {
          console.log(`${agent}\t${n} phiên chưa gửi — bỏ qua (agent không còn trong cấu hình, không có token)`);
          continue;
        }
        if (dry) {
          let cost = 0,
            noCost = 0,
            first = '',
            last = '';
          for (let after = 0; ; ) {
            const jobs = store.pendingUsage(agent, { all: true, sinceIso, afterId: after, limit: 500 });
            if (!jobs.length) break;
            after = jobs.at(-1)!.id;
            for (const j of jobs) {
              const u = usageSession(j, 'x', 'x', s.cfg.executor.kind);
              if (u.costUsd === null) noCost++;
              else cost += u.costUsd;
              first ||= u.finishedAt;
              last = u.finishedAt;
            }
          }
          console.log(
            `${agent}\t${n} phiên chưa gửi (${first.slice(0, 10)} → ${last.slice(0, 10)})\t$${cost.toFixed(2)}` +
              `${noCost ? ` · ${noCost} phiên không có chi phí` : ''}\t→ ${s.usage.url}`,
          );
          continue;
        }
        const r = await s.usage.flush({ all: true, sinceIso });
        console.log(
          `${agent}\tđã gửi ${r.sent}/${n} phiên (lô ≤ ${USAGE_MAX_SESSIONS})` +
            `${r.rejected ? ` · ${r.rejected} phiên bị từ chối (xem log)` : ''}${r.stopped ? ` · DỪNG: ${r.stopped}` : ''}`,
        );
        if (r.stopped || r.rejected) failed = true;
      }
      return failed ? 1 : 0;
    }
    case 'start': {
      const stop = () => {
        log('info', 'dừng runner');
        runner.stop();
        setTimeout(() => process.exit(0), 12_000);
      };
      process.on('SIGTERM', stop);
      process.on('SIGINT', stop);
      await runner.start(modelCheck);
      return 0;
    }
    default:
      console.error(HELP);
      return 2;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e instanceof ConfigError ? e.message : errText(e));
    process.exit(1);
  });
