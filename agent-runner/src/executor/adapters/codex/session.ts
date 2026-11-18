import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** File `rollout-…-<id>.jsonl` của phiên trong `<HOME>/.codex/sessions/<năm>/<tháng>/<ngày>/` (tên có ngày giờ nên phải dò). */
export function codexSessionFile(home: string, sessionId: string): string | undefined {
  const walk = (dir: string, depth: number): string | undefined => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const e of entries) {
      const path = join(dir, e.name);
      if (!e.isDirectory()) {
        if (e.name.endsWith(`-${sessionId}.jsonl`)) return path;
      } else if (depth < 3) {
        const found = walk(path, depth + 1);
        if (found) return found;
      }
    }
    return undefined;
  };
  return walk(join(home, '.codex', 'sessions'), 0);
}

export const codexHasSession = (home: string, _cwd: string, sessionId: string) => !!codexSessionFile(home, sessionId);

/** Model thật của lượt cuối: dòng `turn_context` cuối cùng trong file phiên (`--json` không báo model). Không đọc được → undefined. */
export function codexSessionModel(home: string, sessionId: string): string | undefined {
  const file = codexSessionFile(home, sessionId);
  if (!file) return undefined;
  let model: string | undefined;
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes('"type":"turn_context"')) continue;
      const m = /"model":"([^"\\]+)"/.exec(line);
      if (m) model = m[1];
    }
  } catch {
    /* file bị xoá giữa chừng */
  }
  return model;
}
