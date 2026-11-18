import type { RunnerConfig } from '../config';
import type { Runner } from '../runner';
import type { Store } from '../store';

/** Cờ dòng lệnh đã đọc (xem `HELP` ở `cli.ts`). */
export interface CliFlags {
  /** `--agent NV120` (đã viết hoa). */
  agent?: string;
  task?: string;
  days?: string;
  since?: string;
  /** false = `--no-telegram`. */
  telegram: boolean;
  /** false = `--no-model-check`. */
  modelCheck: boolean;
  /** false = `--no-catchup`. */
  catchUp: boolean;
  dryRun: boolean;
}

/** Thứ mỗi lệnh nhận: cấu hình đã đọc, runner.db, runner, cờ và tham số vị trí sau tên lệnh. */
export interface CliContext {
  config: RunnerConfig;
  store: Store;
  runner: Runner;
  flags: CliFlags;
  args: string[];
}

/** Một lệnh của CLI: trả mã thoát (0 = ổn, 1 = lỗi khi chạy, 2 = sai cách dùng). */
export type Command = (ctx: CliContext) => Promise<number>;
