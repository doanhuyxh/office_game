import type { ModelUse } from './types';

/**
 * Model agent thực sự dùng (TEST-64). Claude Code: sự kiện `system/init` chỉ lặp lại tên model được yêu cầu (đã đổi alias → tên đầy đủ,
 * kể cả tên sai); model thật nằm trong `modelUsage` của sự kiện `result` (một khoá mỗi model, có thể có model phụ cho tác vụ nhỏ).
 */

/** Đọc `modelUsage` của Claude Code: `{ "<model>": { costUSD, inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, … } }`. */
export function readModelUsage(u: unknown): Record<string, ModelUse> | undefined {
  if (!u || typeof u !== 'object') return undefined;
  const out: Record<string, ModelUse> = {};
  for (const [name, v] of Object.entries(u as Record<string, any>)) {
    if (!v || typeof v !== 'object') continue;
    const num = (x: unknown) => (typeof x === 'number' ? x : 0);
    out[name] = {
      costUsd: typeof v.costUSD === 'number' ? v.costUSD : undefined,
      inputTokens: num(v.inputTokens) + num(v.cacheReadInputTokens) + num(v.cacheCreationInputTokens),
      outputTokens: typeof v.outputTokens === 'number' ? v.outputTokens : undefined,
    };
  }
  return Object.keys(out).length ? out : undefined;
}

/** Model chính: model lúc init nếu có trong usage; không thì model tốn nhiều nhất (rồi nhiều token nhất); usage rỗng → model lúc init. */
export function mainModel(initModel: string | undefined, usage: Record<string, ModelUse> | undefined): string | undefined {
  const names = Object.keys(usage ?? {});
  if (names.length === 0) return initModel;
  if (initModel && names.includes(initModel)) return initModel;
  const score = (n: string) => [usage![n]!.costUsd ?? 0, (usage![n]!.inputTokens ?? 0) + (usage![n]!.outputTokens ?? 0)] as const;
  return names.sort((a, b) => score(b)[0] - score(a)[0] || score(b)[1] - score(a)[1])[0];
}

/** Các model phụ (khác model chính) trong phiên. */
export function sideModels(main: string | undefined, usage: Record<string, ModelUse> | undefined): [string, ModelUse][] {
  return Object.entries(usage ?? {}).filter(([n]) => n !== main);
}

/**
 * Model thật có khớp cấu hình không. Cấu hình có thể là alias (`opus`, `sonnet`) hoặc kèm hậu tố (`claude-opus-5-5[1m]`)
 * → khớp khi tên thật chứa tên cấu hình (bỏ phần `[…]`, không phân biệt hoa thường). Không cấu hình → luôn khớp.
 */
export function modelMatches(configured: string | undefined, actual: string | undefined): boolean {
  if (!configured || !actual) return true;
  const c = configured.replace(/\[.*\]$/, '').trim().toLowerCase();
  const a = actual.replace(/\[.*\]$/, '').trim().toLowerCase();
  return !c || a === c || a.includes(c);
}

/** Một dòng mô tả model cho bình luận / log: `claude-opus-5-5 · phụ: claude-haiku-5-5 ($0.01)`. */
export function modelLine(r: { model?: string; modelFromConfig?: boolean; modelUsage?: Record<string, ModelUse> }, configured?: string): string {
  if (!r.model) return configured ? `${configured} (cấu hình)` : 'không rõ (mặc định của CLI)';
  let s = r.model + (r.modelFromConfig ? ' (cấu hình)' : '');
  const side = sideModels(r.model, r.modelUsage);
  if (side.length) s += ` · phụ: ${side.map(([n, u]) => (u.costUsd !== undefined ? `${n} ($${u.costUsd.toFixed(2)})` : n)).join(', ')}`;
  if (!r.modelFromConfig && !modelMatches(configured, r.model)) s += ` ⚠ khác cấu hình (${configured})`;
  return s;
}
