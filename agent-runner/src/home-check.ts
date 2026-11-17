import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Thứ ở cấp user trong HOME của agent mà Claude Code nạp vào MỌI phiên (runner chạy `--setting-sources user`) — tốn token, và có thể đổi
 * hành vi agent (hook, plugin) (TEST-140). `doctor` / khởi động cảnh báo, không chặn. Trả mô tả ngắn từng thứ tìm thấy.
 */
export function userClaudeExtras(home: string): string[] {
  const dir = join(home, '.claude');
  const found: string[] = [];
  const nonEmpty = (p: string) => { try { return readdirSync(p).filter((f) => !f.startsWith('.')).length > 0; } catch { return false; } };
  if (existsSync(join(dir, 'CLAUDE.md'))) found.push('~/.claude/CLAUDE.md');
  for (const sub of ['skills', 'agents', 'commands', 'output-styles']) if (nonEmpty(join(dir, sub))) found.push(`~/.claude/${sub}/`);
  try {
    const installed = JSON.parse(readFileSync(join(dir, 'plugins', 'installed_plugins.json'), 'utf8'));
    const n = Object.keys(installed?.plugins ?? installed ?? {}).length;
    if (n) found.push(`${n} plugin`);
  } catch { /* không có plugin */ }
  try {
    const settings = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
    if (settings?.hooks && Object.keys(settings.hooks).length) found.push('hook trong ~/.claude/settings.json');
    if (settings?.enabledPlugins && Object.values(settings.enabledPlugins).some(Boolean)) found.push('enabledPlugins trong ~/.claude/settings.json');
  } catch { /* không có settings */ }
  return found;
}
