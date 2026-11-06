// Nhập model đồ đạc GLB cho văn phòng 3D từ bộ Kenney Furniture Kit (CC0, https://kenney.nl/assets/furniture-kit).
//   1) Tải zip "Furniture Kit" trên kenney.nl (miễn phí) về máy.
//   2) bun scripts/dev/import-furniture.ts ~/Downloads/kenney_furniture-kit.zip      (hoặc thư mục đã giải nén)
// → chép các file .glb cần dùng vào frontend/public/models/furniture/ và ghi manifest.json. Prefab không tìm thấy model
//   vẫn dùng khối dựng tay. Model quay sai hướng: sửa "rotY" (độ) trong manifest.json rồi tải lại trang.
import { mkdtempSync, readdirSync, statSync, mkdirSync, copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

const src = process.argv[2];
if (!src || !existsSync(src)) throw new Error('Dùng: bun scripts/dev/import-furniture.ts <file-zip-hoặc-thư-mục-Kenney>');
const out = new URL('../../frontend/public/models/furniture/', import.meta.url).pathname;

let root = src;
if (src.toLowerCase().endsWith('.zip')) {
  root = mkdtempSync(join(tmpdir(), 'kenney-'));
  const r = Bun.spawnSync(['unzip', '-q', '-o', src, '-d', root]);
  if (r.exitCode !== 0) throw new Error('Không giải nén được: ' + r.stderr.toString());
}
const glbs = new Map<string, string>(); // tên (chữ thường, không đuôi) → đường dẫn
const walk = (dir: string) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.toLowerCase().endsWith('.glb')) glbs.set(basename(f, '.glb').toLowerCase(), p);
  }
};
walk(root);
if (glbs.size === 0) throw new Error('Không thấy file .glb nào (bộ Kenney có thư mục "Models/GLB format")');

// prefab trên bản đồ (shared/office-map.json) → tên model Kenney thử lần lượt
const MAP: Record<string, string[]> = {
  desk: ['desk'], deskLarge: ['deskCorner', 'desk'], computerScreen: ['computerScreen'], chair: ['chairDesk', 'chair'],
  tableMeeting: ['tableCross', 'table'], tableSmall: ['table'], tableDining: ['tableRound', 'table'], tableCoffee: ['tableCoffee'],
  loungeSofa: ['loungeSofa'], loungeSofaCorner: ['loungeSofaCorner'], bookcaseOpen: ['bookcaseOpen'], cabinetFiles: ['bookcaseClosedDoors', 'bookcaseClosed'],
  pottedPlant: ['pottedPlant', 'plantSmall1'], pottedPlantLarge: ['pottedPlant'], televisionWall: ['televisionModern'],
  kitchenCounter: ['kitchenCabinet', 'kitchenBar'], kitchenFridge: ['kitchenFridgeLarge', 'kitchenFridge'], coffeeMachine: ['kitchenCoffeeMachine'],
  printer: ['printer'], lockers: ['bookcaseClosedWide'], beanbag: ['loungeChair'],
};

mkdirSync(out, { recursive: true });
const models: Record<string, { file: string; rotY: number }> = {};
const missing: string[] = [];
for (const [prefab, names] of Object.entries(MAP)) {
  const hit = names.find((n) => glbs.has(n.toLowerCase()));
  if (!hit) { missing.push(prefab); continue; }
  const file = `${hit}.glb`;
  copyFileSync(glbs.get(hit.toLowerCase())!, join(out, file));
  models[prefab] = { file, rotY: 0 };
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ source: 'Kenney Furniture Kit — CC0 1.0 (https://kenney.nl)', models }, null, 2) + '\n');
writeFileSync(join(out, 'LICENSE.txt'), 'Models: Kenney Furniture Kit (www.kenney.nl) — Creative Commons Zero (CC0 1.0). Dùng tự do, không bắt buộc ghi nguồn.\n');
console.log(`✔ ${Object.keys(models).length} prefab dùng model GLB → ${out}`);
if (missing.length) console.log(`  Giữ khối dựng tay: ${missing.join(', ')}`);
