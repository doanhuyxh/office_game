import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Mã build của bản web (TEST-227): mỗi lần `bun run build` một mã mới = commit (VITE_APP_COMMIT, deploy.sh truyền vào) + giờ build.
 * - Nhúng vào bundle: `import.meta.env.VITE_APP_BUILD_ID` (src/pwa.ts so với /version.json để nhắc tải lại).
 * - Ghi `dist/version.json` = `{ "build": "<mã>" }` (nginx trả no-store, service worker không cache).
 * - Thay `const VERSION = '…'` trong `dist/sw.js` thành `'…-<mã>'` → mỗi deploy sw.js đổi nội dung → trình duyệt thấy
 *   `updatefound` (toast "Có phiên bản mới") và bước activate dọn cache `/assets` cũ.
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
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: buildId }) });
    },
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
