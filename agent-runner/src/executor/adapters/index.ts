import type { Adapter } from '../types';
import { claudeAdapter } from './claude';
import { codexAdapter } from './codex';
import { customAdapter } from './custom';

/**
 * Registry loại CLI (`executor.kind`) → adapter. Thêm CLI mới = thư mục `adapters/<tên>/` (index.ts xuất `<tên>Adapter`) + một dòng ở đây.
 * `executor.kind` hợp lệ trong `agents.yaml` lấy từ danh sách này.
 */
export const adapters = { claude: claudeAdapter, codex: codexAdapter, custom: customAdapter } satisfies Record<
  string,
  Adapter
>;
export type ExecutorKind = keyof typeof adapters;
export const isExecutorKind = (v: unknown): v is ExecutorKind => typeof v === 'string' && Object.hasOwn(adapters, v);
