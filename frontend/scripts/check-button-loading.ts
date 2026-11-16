/**
 * Chặn tái phạm (TEST-132): nút `<Button>` gửi dữ liệu phải dùng `loading={m.isPending}` (vòng xoay + chữ), không chỉ
 * `disabled={m.isPending}` (nút chỉ mờ đi, người dùng tưởng hỏng). Báo lỗi khi gặp thẻ `<Button …>` có `disabled={…isPending…}`
 * mà không có prop `loading`. Chạy trong `bun run build` (CI + Dockerfile) — sửa: chuyển `x.isPending` sang `loading`,
 * điều kiện khác giữ ở `disabled` (xem .agent/frontend-ui.md).
 *   bun scripts/check-button-loading.ts            # quét src/
 *   bun scripts/check-button-loading.ts <file…>    # quét file chỉ định
 * Nhiều nút dùng chung một mutation (dòng trong bảng): `loading={m.isPending && m.variables === id} disabled={m.isPending}`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dir, '..');

/** Vị trí `>` đóng thẻ mở bắt đầu tại `start` (bỏ qua `>` trong `{…}` và chuỗi). */
function tagEnd(s: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + 1; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || (depth > 0 && (c === "'" || c === '`'))) quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return i;
  }
  return -1;
}

/** Nội dung `{…}` của prop `name` trong thẻ, hoặc null. */
function propExpr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}=\\{`).exec(tag);
  if (!m) return null;
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < tag.length; i++) {
    if (tag[i] === '{') depth++;
    else if (tag[i] === '}' && --depth === 0) return tag.slice(m.index + m[0].length, i);
  }
  return null;
}

export function findViolations(source: string): { line: number; tag: string }[] {
  const out: { line: number; tag: string }[] = [];
  const re = /<Button\s/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    const end = tagEnd(source, m.index);
    if (end < 0) break;
    const tag = source.slice(m.index, end + 1);
    re.lastIndex = end;
    if (/\sloading=/.test(tag)) continue;
    if (propExpr(tag, 'disabled')?.includes('isPending')) {
      out.push({ line: source.slice(0, m.index).split('\n').length, tag: tag.replace(/\s+/g, ' ').slice(0, 140) });
    }
  }
  return out;
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.tsx'))
    .map((e) => join(e.parentPath, e.name));
}

if (import.meta.main) {
  const files = process.argv.length > 2 ? process.argv.slice(2) : tsxFiles(join(root, 'src'));
  let count = 0;
  for (const file of files) {
    for (const v of findViolations(readFileSync(file, 'utf8'))) {
      count++;
      console.error(`${relative(root, file)}:${v.line}  ${v.tag}`);
    }
  }
  if (count > 0) {
    console.error(`\n✗ ${count} nút <Button> có disabled={…isPending…} nhưng thiếu loading — dùng loading={x.isPending} (TEST-132, .agent/frontend-ui.md).`);
    process.exit(1);
  }
  console.log(`✓ check-button-loading: ${files.length} file, không có nút thiếu loading.`);
}
