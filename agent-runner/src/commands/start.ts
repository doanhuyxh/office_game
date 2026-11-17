import { log } from '../log';
import type { Command } from './context';

/** Sau SIGTERM / SIGINT: chờ ngần này cho các phiên CLI bị huỷ thoát hẳn (SIGTERM rồi 10 giây sau SIGKILL) trước khi kết thúc tiến trình. */
const SHUTDOWN_GRACE_MS = 12_000;

/** `start [--no-model-check]`: dịch vụ — nghe Telegram, chạy việc được giao cho tới khi nhận SIGTERM / SIGINT. */
export const start: Command = async ({ runner, flags }) => {
  const stop = () => {
    log('info', 'dừng runner');
    runner.stop();
    setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  await runner.start(flags.modelCheck);
  return 0;
};
