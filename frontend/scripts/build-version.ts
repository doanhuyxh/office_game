import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Mã build của bản web (TEST-227): mỗi lần `bun run build` một mã mới = commit (VITE_APP_COMMIT, deploy.sh truyền vào) + giờ build.
 * Thay `const VERSION = '…'` trong `dist/sw.js` thành `'…-<mã>'` → mỗi deploy sw.js đổi nội dung → trình duyệt cài SW mới,
 * bước activate (khi đóng hết tab) dọn cache `/assets` cũ. Toast "Có phiên bản mới" + `/version.json` đã bỏ (TEST-263).
 */
export function makeBuildId(commit = process.env.VITE_APP_COMMIT): string {
  const sha = commit && commit !== 'unknown' ? commit.slice(0, 12) : 'local';
  return `${sha}-${Date.now().toString(36)}`;
}

export function buildVersion(buildId: string): Plugin {
  let outDir = 'dist';
  return {
    name: 'officehub-build-version',
    apply: 'build',
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
    // Thư mục public/ được chép vào dist trước khi ghi bundle → sửa sw.js ở closeBundle (sau cùng)
    async closeBundle() {
      const file = join(outDir, 'sw.js');
      const src = await readFile(file, 'utf8');
      const out = src.replace(/const VERSION = '([^']*)';/, (_, v: string) => `const VERSION = '${v}-${buildId}';`);
      if (out === src) throw new Error('build-version: không tìm thấy `const VERSION = \'…\';` trong sw.js');
      await writeFile(file, out);
    },
  };
}
