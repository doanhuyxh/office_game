#!/usr/bin/env bun
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { CliFlags, Command } from './commands/context';
import { doctor } from './commands/doctor';
import { report } from './commands/report';
import { run } from './commands/run';
import { start } from './commands/start';
import { usagePush } from './commands/usage-push';
import { ConfigError, loadConfig } from './config';
import { errText, log, setLogFormat } from './log';
import { Runner } from './runner';
import { Store } from './store';

const HELP = `officehub-agent-runner — bộ điều phối agent (TEST-44)

  start [--no-model-check] [--no-catchup]
                                      nghe Telegram, chạy việc được giao (dịch vụ systemd); lúc khởi động xếp luôn các việc
                                      đang giao cho agent mà chưa có tin đánh thức
  doctor [--agent NV120] [--no-telegram] [--no-model-check]
                                      kiểm tra cấu hình: CLI, model thật, token, repo, hook, bot Telegram, gh
  run --agent NV120 --task TEST-45 [--no-model-check]
                                      chạy ngay một việc (bỏ qua Telegram, vẫn hỏi lại OfficeHub) rồi thoát
  report [--days 1]                   tổng chi phí theo agent và theo model
  usage push [--since 2026-11-01] [--agent NV120] [--dry-run]
                                      gửi chi phí / token các phiên chưa gửi lên OfficeHub ("Mức dùng AI") — gồm phiên cũ
                                      trước khi có tính năng này và phiên từng bị từ chối; gửi lại không tạo trùng

  --no-model-check  không chạy thử CLI để đọc model thật (mỗi agent tốn vài trăm token)
  --no-catchup      start: không bắt bù việc lúc khởi động (hoặc runner.startup_catchup: false trong agents.yaml)

  --config <file>   mặc định $RUNNER_CONFIG hoặc /etc/officehub-runner/agents.yaml`;

const DEFAULT_CONFIG = '/etc/officehub-runner/agents.yaml';

/** Lệnh theo tên. Thêm lệnh mới = một file trong `commands/` + một dòng ở đây + một dòng trong `HELP`. */
const COMMANDS: Record<string, Command> = { start, doctor, run, report, usage: usagePush };

/** Đọc dòng lệnh. Cờ lạ / thiếu giá trị → ném lỗi (không âm thầm bỏ qua cờ gõ sai). */
function readArgs(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      agent: { type: 'string' },
      task: { type: 'string' },
      days: { type: 'string' },
      since: { type: 'string' },
      'no-telegram': { type: 'boolean' },
      'no-model-check': { type: 'boolean' },
      'no-catchup': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  const flags: CliFlags = {
    agent: values.agent?.toUpperCase(),
    task: values.task,
    days: values.days,
    since: values.since,
    telegram: !values['no-telegram'],
    modelCheck: !values['no-model-check'],
    catchUp: !values['no-catchup'],
    dryRun: !!values['dry-run'],
  };
  return { command: positionals[0], args: positionals.slice(1), flags, config: values.config, help: !!values.help };
}

async function main(): Promise<number> {
  let cli: ReturnType<typeof readArgs>;
  try {
    cli = readArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${errText(e)}\n\n${HELP}`);
    return 2;
  }
  if (!cli.command || cli.help || cli.command === 'help') {
    console.log(HELP);
    return 0;
  }
  const command = COMMANDS[cli.command];
  if (!command) {
    console.error(HELP);
    return 2;
  }

  const { config, warnings } = loadConfig(cli.config ?? process.env.RUNNER_CONFIG ?? DEFAULT_CONFIG);
  setLogFormat(config.logFormat);
  for (const w of warnings) log('warn', w);
  mkdirSync(config.dataDir, { recursive: true });
  const store = new Store(join(config.dataDir, 'runner.db'));
  const runner = new Runner(config, store);

  return command({ config, store, runner, flags: cli.flags, args: cli.args });
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e instanceof ConfigError ? e.message : errText(e));
    process.exit(1);
  });
