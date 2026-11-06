// Nhập model nhân vật cho văn phòng 3D từ bộ Quaternius "Ultimate Modular Men / Women" (CC0, https://quaternius.com).
//   1) Tải thư mục "Individual Characters/glTF" của 2 bộ (Google Drive trên trang quaternius.com) về máy:
//        <dir>/men/{Suit,Casual_Hoodie,Casual_2,Worker,Beach,Adventurer,Punk,Farmer}.gltf
//        <dir>/women/{Casual,Formal,Suit,Worker,Punk,Adventurer}.gltf
//   2) bun scripts/dev/import-characters.ts <dir>
// → frontend/public/models/characters/{male,female}.glb (mỗi giới 1 file: 1 bộ xương + mọi phần đầu / áo / quần / giày
//   + vài animation) và shared/avatar-catalog.json (danh mục cho editor FE + kiểm tra ở BE — KHÔNG sửa tay, sửa bảng dưới).
// Cùng giới dùng chung bộ xương + bind pose (đã kiểm tra) → ghép chéo được; nam / nữ khác bind pose → không ghép chéo.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const src = process.argv[2];
if (!src || !existsSync(join(src, 'men')) || !existsSync(join(src, 'women'))) throw new Error('Dùng: bun scripts/dev/import-characters.ts <thư-mục có men/ và women/ chứa file .gltf>');
const outModels = new URL('../../frontend/public/models/characters/', import.meta.url).pathname;
const outCatalog = new URL('../../shared/avatar-catalog.json', import.meta.url).pathname;

// ---------- Bảng chọn lọc (id ổn định — đổi id = nhân vật đã lưu của người dùng mất hiệu lực, BE trả 400) ----------
type Slot = 'head' | 'top' | 'bottom' | 'shoes';
/** tint: tên vật liệu được tô màu (tóc / mắt với head; màu trang phục với top / bottom / shoes). */
interface PartDef { id: string; label: string; file: string; node: string; tint?: string[]; eyes?: string[] }
const KEEP_ANIMS = ['Idle', 'Walk', 'Run', 'Wave'];

const BODIES: Record<'male' | 'female', { label: string; base: string; parts: Record<Slot, PartDef[]> }> = {
  male: {
    label: 'Nam', base: 'Suit',
    parts: {
      head: [
        { id: 'slick', label: 'Tóc vuốt', file: 'Suit', node: 'Suit_Head', tint: ['Hair'], eyes: ['Eye'] },
        { id: 'short', label: 'Tóc ngắn', file: 'Casual_Hoodie', node: 'Casual_Head', tint: ['Hair'], eyes: ['Eye'] },
        { id: 'fade', label: 'Tóc undercut', file: 'Casual_2', node: 'Casual2_Head', tint: ['Hair'], eyes: ['Eye'] },
        { id: 'messy', label: 'Tóc bù xù', file: 'Adventurer', node: 'Adventurer_Head', tint: ['Hair'], eyes: ['Eye'] },
        { id: 'long', label: 'Tóc dài', file: 'Beach', node: 'Beach_Head', tint: ['Hair'], eyes: ['Eye'] },
        { id: 'mohawk', label: 'Mohican', file: 'Punk', node: 'Punk_Head', tint: ['Red', 'Red_Dark'], eyes: ['Eye'] },
        { id: 'hat', label: 'Mũ rơm', file: 'Farmer', node: 'Farmer_Head', tint: [], eyes: ['Eye'] },
        { id: 'helmet', label: 'Mũ bảo hộ', file: 'Worker', node: 'Worker_Head', tint: ['Moustache'], eyes: ['Eye'] },
      ],
      top: [
        { id: 'suit', label: 'Vest', file: 'Suit', node: 'Suit_Body', tint: ['Suit'] },
        { id: 'tee', label: 'Áo phông', file: 'Casual_2', node: 'Casual2_Body', tint: ['LightBrown'] },
        { id: 'hoodie', label: 'Hoodie', file: 'Casual_Hoodie', node: 'Casual_Body', tint: ['Purple'] },
        { id: 'jacket', label: 'Áo khoác', file: 'Adventurer', node: 'Adventurer_Body', tint: ['Green'] },
        { id: 'punk', label: 'Áo da', file: 'Punk', node: 'Punk_Body', tint: ['Black'] },
        { id: 'overall', label: 'Áo yếm', file: 'Farmer', node: 'Farmer_Body', tint: ['LightBlue'] },
        { id: 'vest', label: 'Áo gile', file: 'Worker', node: 'Worker_Body', tint: ['Worker_Vest'] },
        { id: 'tank', label: 'Áo ba lỗ', file: 'Beach', node: 'Beach_Body', tint: ['LightBrown'] },
      ],
      bottom: [
        { id: 'suit', label: 'Quần âu', file: 'Suit', node: 'Suit_Legs', tint: ['Suit'] },
        { id: 'jeans', label: 'Quần jean', file: 'Casual_2', node: 'Casual2_Legs', tint: ['LightBlue'] },
        { id: 'jeans2', label: 'Quần jean xắn', file: 'Casual_Hoodie', node: 'Casual_Legs', tint: ['LightBlue'] },
        { id: 'cargo', label: 'Quần túi hộp', file: 'Worker', node: 'Worker_Legs', tint: ['Brown'] },
        { id: 'punk', label: 'Quần rách', file: 'Punk', node: 'Punk_Legs', tint: ['LightBlue'] },
        { id: 'work', label: 'Quần kaki', file: 'Farmer', node: 'Farmer_Pants', tint: ['LightBlue'] },
        { id: 'trek', label: 'Quần dã ngoại', file: 'Adventurer', node: 'Adventurer_Legs', tint: ['Brown'] },
        { id: 'shorts', label: 'Quần short', file: 'Beach', node: 'Beach_Legs', tint: ['Red_Dark'] },
      ],
      shoes: [
        { id: 'oxford', label: 'Giày tây', file: 'Suit', node: 'Suit_Feet', tint: ['Black'] },
        { id: 'sneaker', label: 'Giày thể thao', file: 'Casual_2', node: 'Casual2_Feet', tint: ['Red_Dark'] },
        { id: 'sneaker2', label: 'Giày cổ cao', file: 'Casual_Hoodie', node: 'Casual_Feet', tint: ['Purple'] },
        { id: 'boots', label: 'Giày bảo hộ', file: 'Worker', node: 'Worker_Feet', tint: ['Grey'] },
        { id: 'punk', label: 'Bốt', file: 'Punk', node: 'Punk_Feet', tint: ['Black'] },
        { id: 'farm', label: 'Bốt da', file: 'Farmer', node: 'Farmer_Feet', tint: ['Brown'] },
        { id: 'trek', label: 'Giày leo núi', file: 'Adventurer', node: 'Adventurer_Feet', tint: ['Grey'] },
        { id: 'sandal', label: 'Dép', file: 'Beach', node: 'Beach_Feet', tint: ['Red_Dark'] },
      ],
    },
  },
  female: {
    label: 'Nữ', base: 'Casual',
    parts: {
      head: [
        // Suit_Head giống hệt Casual_Head → bỏ
        { id: 'bob', label: 'Tóc ngang vai', file: 'Casual', node: 'Casual_Head', tint: ['Hair_Blond', 'Hair_Brown'], eyes: ['Brown'] },
        { id: 'side', label: 'Tóc buộc lệch', file: 'Formal', node: 'Formad_Head', tint: ['Red'], eyes: ['Brown'] },
        { id: 'short', label: 'Tóc ngắn', file: 'Adventurer', node: 'Adventurer_Head', tint: ['Hair_Brown'], eyes: ['Brown'] },
        { id: 'punk', label: 'Tóc cá tính', file: 'Punk', node: 'Punk_Head', tint: ['Pink'], eyes: ['Brown'] },
        { id: 'helmet', label: 'Mũ bảo hộ', file: 'Worker', node: 'Worker_Head', tint: ['DarkBrown'], eyes: ['Brown'] },
      ],
      top: [
        { id: 'tee', label: 'Áo phông', file: 'Casual', node: 'Casual_Body', tint: ['White'] },
        { id: 'blazer', label: 'Vest', file: 'Suit', node: 'Suit_Body', tint: ['Black'] },
        { id: 'dress', label: 'Đầm', file: 'Formal', node: 'Formal_Body', tint: ['LimeGreen'] },
        { id: 'vest', label: 'Áo gile', file: 'Worker', node: 'Worker_Body', tint: ['Worker_Vest'] },
        { id: 'punk', label: 'Áo cá tính', file: 'Punk', node: 'Punk_Body', tint: ['Pink'] },
        { id: 'jacket', label: 'Áo khoác', file: 'Adventurer', node: 'Adventurer_Body', tint: ['LightGreen'] },
      ],
      bottom: [
        { id: 'pants', label: 'Quần dài', file: 'Casual', node: 'Casual_Legs', tint: ['Orange'] },
        { id: 'suit', label: 'Quần âu', file: 'Suit', node: 'Suit_Legs', tint: ['Black'] },
        { id: 'skirt', label: 'Váy', file: 'Formal', node: 'Formal_Legs', tint: ['LimeGreen'] },
        { id: 'cargo', label: 'Quần túi hộp', file: 'Worker', node: 'Worker_Legs', tint: ['Brown_02'] },
        { id: 'punk', label: 'Quần bó', file: 'Punk', node: 'Punk_Legs', tint: ['Black'] },
        { id: 'trek', label: 'Quần dã ngoại', file: 'Adventurer', node: 'Adventurer_Legs', tint: ['Brown_02'] },
      ],
      shoes: [
        { id: 'flats', label: 'Giày bệt', file: 'Casual', node: 'Casual_Feet', tint: ['Grey'] },
        { id: 'heels', label: 'Giày cao gót', file: 'Suit', node: 'Suit_Feet', tint: ['Black'] },
        { id: 'sandal', label: 'Sandal', file: 'Formal', node: 'Formal_Feet', tint: ['Red'] },
        { id: 'boots', label: 'Giày bảo hộ', file: 'Worker', node: 'Worker_Feet', tint: ['Black'] },
        { id: 'punk', label: 'Bốt', file: 'Punk', node: 'Punk_Feet', tint: ['Black'] },
        { id: 'trek', label: 'Bốt da', file: 'Adventurer', node: 'Adventurer_Feet', tint: ['Brown_02'] },
      ],
    },
  },
};

/** Bảng màu sRGB. Màu chọn = chỉ số; null = màu gốc của model. */
const PALETTES = {
  skin: ['#f8dcc8', '#f1c7a0', '#e0ac85', '#c68b62', '#9c6644', '#6e4630'],
  hair: ['#151515', '#3b2418', '#6b4226', '#9a6a3a', '#d6b26e', '#c9c9c9', '#a33b2b', '#2f4f9e'],
  eyes: ['#2b1d14', '#5a3a22', '#3a6ea5', '#3f7d4a', '#555555'],
  cloth: ['#f4f4f5', '#a1a1aa', '#27272a', '#1e3a8a', '#2563eb', '#0891b2', '#16a34a', '#65a30d', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#7c3aed', '#7c4a1e', '#d6c4a8'],
};

/** Nhân vật mặc định chung cho người chưa tự chọn (mọi người giống nhau, phân biệt bằng nhãn tên). */
const DEFAULT = { v: 1, body: 'male', head: 'short', top: 'tee', bottom: 'jeans', shoes: 'sneaker', skin: null, hair: null, eyes: null, topColor: 4, bottomColor: null, shoesColor: null };

// ---------- glTF ----------
interface Gltf { [k: string]: any }
const load = (gender: string, file: string) => {
  const p = join(src, gender === 'male' ? 'men' : 'women', `${file}.gltf`);
  if (!existsSync(p)) throw new Error(`Thiếu file ${p}`);
  const g: Gltf = JSON.parse(readFileSync(p, 'utf8'));
  const uri: string = g.buffers[0].uri;
  if (!uri?.startsWith('data:')) throw new Error(`${p}: chỉ hỗ trợ glTF nhúng buffer (data URI)`);
  return { g, bin: Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64') };
};

function build(gender: 'male' | 'female') {
  const def = BODIES[gender];
  const out: Gltf = { asset: { version: '2.0', generator: 'OfficeHub import-characters' },
    extensionsUsed: ['KHR_mesh_quantization'], extensionsRequired: ['KHR_mesh_quantization'], scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], skins: [], animations: [] };
  const chunks: Buffer[] = [];
  let binLen = 0;
  const docs = new Map<string, ReturnType<typeof load>>();
  const doc = (f: string) => docs.get(f) ?? (docs.set(f, load(gender, f)), docs.get(f)!);

  // Sao chép bufferView / accessor / material (cache theo tài liệu nguồn)
  const bvCache = new Map<string, number>();
  const copyView = (f: string, i: number) => {
    const key = `${f}#${i}`;
    if (bvCache.has(key)) return bvCache.get(key)!;
    const { g, bin } = doc(f);
    const v = g.bufferViews[i];
    const data = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
    const pad = (4 - (binLen % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); binLen += pad; }
    const nv: any = { buffer: 0, byteOffset: binLen, byteLength: v.byteLength };
    if (v.byteStride) nv.byteStride = v.byteStride;
    if (v.target) nv.target = v.target;
    chunks.push(Buffer.from(data)); binLen += data.length;
    out.bufferViews.push(nv);
    bvCache.set(key, out.bufferViews.length - 1);
    return out.bufferViews.length - 1;
  };
  const accCache = new Map<string, number>();
  const copyAcc = (f: string, i: number) => {
    const key = `${f}#${i}`;
    if (accCache.has(key)) return accCache.get(key)!;
    const a = { ...doc(f).g.accessors[i] };
    if (a.sparse) throw new Error('Không hỗ trợ sparse accessor');
    a.bufferView = copyView(f, a.bufferView);
    out.accessors.push(a);
    accCache.set(key, out.accessors.length - 1);
    return out.accessors.length - 1;
  };
  /** Thêm accessor mới từ dữ liệu đã chuyển đổi (căn 4 byte). */
  const addAcc = (data: Buffer, a: Record<string, unknown>, byteStride?: number) => {
    const pad = (4 - (binLen % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); binLen += pad; }
    out.bufferViews.push({ buffer: 0, byteOffset: binLen, byteLength: data.length, target: 34962, ...(byteStride ? { byteStride } : {}) });
    chunks.push(data); binLen += data.length;
    out.accessors.push({ ...a, bufferView: out.bufferViews.length - 1 });
    return out.accessors.length - 1;
  };
  const readFloats = (f: string, i: number, comps: number) => {
    const { g, bin } = doc(f);
    const a = g.accessors[i], v = g.bufferViews[a.bufferView];
    if (a.componentType !== 5126 || (v.byteStride && v.byteStride !== comps * 4)) throw new Error(`${f}: accessor ${i} không phải float liền mạch`);
    const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    return { a, data: new Float32Array(bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + a.count * comps * 4)) };
  };
  // Giảm dung lượng (model không có texture): normal → int8 (KHR_mesh_quantization), weights → uint8 chuẩn hoá (tổng = 255)
  const normalCache = new Map<string, number>();
  const copyNormal = (f: string, i: number) => {
    const key = `${f}#${i}`;
    if (normalCache.has(key)) return normalCache.get(key)!;
    const { a, data } = readFloats(f, i, 3);
    const q = Buffer.alloc(a.count * 4);
    for (let k = 0; k < a.count; k++) for (let c = 0; c < 3; c++) q.writeInt8(Math.max(-127, Math.min(127, Math.round(data[k * 3 + c] * 127))), k * 4 + c);
    const idx = addAcc(q, { componentType: 5120, normalized: true, count: a.count, type: 'VEC3' }, 4);
    normalCache.set(key, idx);
    return idx;
  };
  const weightCache = new Map<string, number>();
  const copyWeights = (f: string, i: number) => {
    const key = `${f}#${i}`;
    if (weightCache.has(key)) return weightCache.get(key)!;
    const { a, data } = readFloats(f, i, 4);
    const q = Buffer.alloc(a.count * 4);
    for (let k = 0; k < a.count; k++) {
      const w = [0, 1, 2, 3].map((c) => Math.round(data[k * 4 + c] * 255));
      const max = w.indexOf(Math.max(...w));
      w[max] += 255 - w.reduce((s, x) => s + x, 0);
      w.forEach((x, c) => q.writeUInt8(Math.max(0, x), k * 4 + c));
    }
    const idx = addAcc(q, { componentType: 5121, normalized: true, count: a.count, type: 'VEC4' });
    weightCache.set(key, idx);
    return idx;
  };
  const copyAttr = (f: string, name: string, i: number) =>
    name === 'NORMAL' ? copyNormal(f, i) : name === 'WEIGHTS_0' ? copyWeights(f, i) : copyAcc(f, i);
  const matCache = new Map<string, number>();
  const copyMat = (f: string, i: number) => {
    const m = doc(f).g.materials[i];
    const key = JSON.stringify(m);
    if (!matCache.has(key)) { out.materials.push(m); matCache.set(key, out.materials.length - 1); }
    return matCache.get(key)!;
  };

  // 1) Bộ xương từ file gốc: CharacterArmature + cây xương (bỏ node mesh)
  const base = doc(def.base).g;
  const armIdx = base.scenes[base.scene ?? 0].nodes[0];
  const nodeMap = new Map<number, number>();
  const copyNode = (i: number): number | null => {
    const n = base.nodes[i];
    if (n.mesh !== undefined) return null;
    const nn: any = { name: n.name };
    for (const k of ['translation', 'rotation', 'scale', 'matrix']) if (n[k]) nn[k] = n[k];
    out.nodes.push(nn);
    const idx = out.nodes.length - 1;
    nodeMap.set(i, idx);
    const kids = (n.children ?? []).map(copyNode).filter((c: number | null) => c !== null);
    if (kids.length) nn.children = kids;
    return idx;
  };
  const arm = copyNode(armIdx)!;
  out.scenes[0].nodes = [arm];
  const skin = base.skins[0];
  out.skins.push({ name: 'Skeleton', joints: skin.joints.map((j: number) => nodeMap.get(j)), inverseBindMatrices: copyAcc(def.base, skin.inverseBindMatrices) });
  const jointNames = skin.joints.map((j: number) => base.nodes[j].name).join(',');

  // 2) Các phần (đầu / áo / quần / giày) từ mọi file → node "<slot>.<id>" con của armature, dùng skin 0
  const catParts: Record<string, unknown[]> = {};
  const matNames = (g: Gltf, meshIdx: number) => new Set<string>(g.meshes[meshIdx].primitives.map((p: any) => g.materials[p.material].name));
  for (const [slot, list] of Object.entries(def.parts) as [Slot, PartDef[]][]) {
    catParts[slot] = [];
    for (const p of list) {
      const { g } = doc(p.file);
      const s = g.skins[0];
      if (s.joints.map((j: number) => g.nodes[j].name).join(',') !== jointNames) throw new Error(`${p.file}: bộ xương khác file gốc`);
      const ni = g.nodes.findIndex((n: any) => n.name === p.node && n.mesh !== undefined);
      if (ni < 0) throw new Error(`${p.file}: không thấy node ${p.node}`);
      const n = g.nodes[ni];
      const names = matNames(g, n.mesh);
      for (const t of [...(p.tint ?? []), ...(p.eyes ?? [])]) if (!names.has(t)) throw new Error(`${p.file}/${p.node}: không có vật liệu ${t} (có: ${[...names].join(', ')})`);
      const mesh = g.meshes[n.mesh];
      out.meshes.push({
        name: `part-${slot}-${p.id}`,
        primitives: mesh.primitives.map((pr: any) => ({
          attributes: Object.fromEntries(Object.entries(pr.attributes).filter(([k]) => !k.startsWith('TEXCOORD'))
            .map(([k, v]) => [k, copyAttr(p.file, k, v as number)])),
          indices: copyAcc(p.file, pr.indices), material: copyMat(p.file, pr.material), ...(pr.mode !== undefined ? { mode: pr.mode } : {}),
        })),
      });
      const nn: any = { name: `part-${slot}-${p.id}`, mesh: out.meshes.length - 1, skin: 0 };
      for (const k of ['translation', 'rotation', 'scale']) if (n[k]) nn[k] = n[k];
      out.nodes.push(nn);
      (out.nodes[arm].children ??= []).push(out.nodes.length - 1);
      const entry: Record<string, unknown> = { id: p.id, label: p.label, tint: p.tint ?? [] };
      if (slot === 'head') { entry.hair = p.tint ?? []; entry.eyes = p.eyes ?? []; delete entry.tint; }
      catParts[slot].push(entry);
    }
  }

  // 3) Animation (chỉ vài clip cần dùng; ngồi = tư thế dựng ở FE)
  for (const a of base.animations.filter((x: any) => KEEP_ANIMS.includes(x.name))) {
    out.animations.push({
      name: a.name,
      samplers: a.samplers.map((s: any) => ({ input: copyAcc(def.base, s.input), output: copyAcc(def.base, s.output), interpolation: s.interpolation })),
      channels: a.channels.map((c: any) => ({ sampler: c.sampler, target: { node: nodeMap.get(c.target.node), path: c.target.path } })),
    });
  }
  if (out.animations.length !== KEEP_ANIMS.length) throw new Error(`${def.base}: thiếu animation (cần ${KEEP_ANIMS.join(', ')})`);

  // GLB: header + JSON chunk + BIN chunk
  const bin = Buffer.concat(chunks);
  const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  out.buffers = [{ byteLength: binPadded.length }];
  let json = Buffer.from(JSON.stringify(out));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const glb = Buffer.alloc(12 + 8 + json.length + 8 + binPadded.length);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(json.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); json.copy(glb, 20);
  const o = 20 + json.length;
  glb.writeUInt32LE(binPadded.length, o); glb.writeUInt32LE(0x004e4942, o + 4); binPadded.copy(glb, o + 8);
  const file = `${gender}.glb`;
  writeFileSync(join(outModels, file), glb);
  console.log(`✔ ${file}: ${out.meshes.length} phần, ${out.animations.length} animation, ${(glb.length / 1024).toFixed(0)} KB`);
  return { label: def.label, file, parts: catParts };
}

mkdirSync(outModels, { recursive: true });
const bodies = { male: build('male'), female: build('female') };
const catalog = {
  $comment: 'Sinh bởi scripts/dev/import-characters.ts — KHÔNG sửa tay. FE: features/office/engine/character*.ts; BE: Identity AvatarCatalog.',
  version: 1,
  source: 'Quaternius Ultimate Modular Men / Women — CC0 1.0 (https://quaternius.com)',
  palettes: PALETTES,
  default: DEFAULT,
  bodies,
};
writeFileSync(outCatalog, JSON.stringify(catalog, null, 2) + '\n');
writeFileSync(join(outModels, 'LICENSE.txt'), 'Models: Quaternius "Ultimate Modular Men Pack" + "Ultimate Modular Women Pack" (https://quaternius.com) — Creative Commons Zero (CC0 1.0). Dùng tự do, không bắt buộc ghi nguồn.\n');
console.log(`✔ ${outCatalog}`);
