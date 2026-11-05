/**
 * Thêm / cập nhật component shadcn/ui — dùng thay cho `bunx shadcn add`.
 *
 *   bun run ui:add button dialog            # thêm
 *   bun run ui:add card --overwrite         # ghi đè bản đang có
 *
 * Vì sao cần script này: registry `new-york-v4` (Tailwind v4) của shadcn đang viết sẵn
 * `import { cn } from "cn"` trong mã nguồn component, CLI không đổi sang alias của dự án và còn
 * tự cài gói npm rác tên `cn`. Script gọi CLI chính thức rồi:
 *   1. đổi `from "cn"` → `from "@/utils/cn"` trong thư mục ui (components.json → aliases.ui);
 *   2. gỡ gói `cn` nếu CLI vừa cài.
 * Khi shadcn sửa registry, script vẫn chạy đúng (bước 1, 2 không làm gì).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Cách dùng: bun run ui:add <component...> [--overwrite]');
  process.exit(1);
}

const run = (cmd: string[]) => {
  const r = Bun.spawnSync(cmd, { cwd: root, stdout: 'inherit', stderr: 'inherit' });
  if (r.exitCode !== 0) process.exit(r.exitCode ?? 1);
};

run(['bunx', '--bun', 'shadcn@latest', 'add', ...args, '--yes']);

// 1) Sửa import cn trong thư mục ui
const config = JSON.parse(readFileSync(join(root, 'components.json'), 'utf8'));
const uiDir = join(root, 'src', (config.aliases.ui as string).replace(/^@\//, ''));
const utilsAlias: string = config.aliases.utils;
let fixed = 0;
for (const file of readdirSync(uiDir).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))) {
  const path = join(uiDir, file);
  const src = readFileSync(path, 'utf8');
  const out = src.replace(/from (["'])cn\1/g, `from "${utilsAlias}"`);
  if (out !== src) {
    writeFileSync(path, out);
    fixed++;
  }
}
if (fixed) console.log(`✔ Đã sửa import cn → "${utilsAlias}" trong ${fixed} file`);

// 2) Gỡ gói rác `cn` nếu CLI vừa cài
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (pkg.dependencies?.cn) {
  run(['bun', 'remove', 'cn']);
  console.log('✔ Đã gỡ gói npm "cn" (CLI cài nhầm)');
}
