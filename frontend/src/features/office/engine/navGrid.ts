import type { Door, MapObject, OfficeMapV2, Rect, Side } from './mapTypes';

/**
 * Lưới va chạm + tìm đường của văn phòng. Thuần TS, không phụ thuộc Three.js.
 *
 * ⚠ PHẢI GIỐNG HỆT backend/src/OfficeHub.Realtime/Simulation/NavGrid.cs (server dùng để chặn đi xuyên tường).
 * `design/tools/render-plan.ts` ghi `shared/office-map.grid.txt` từ file này; test C# so sánh lưới của server với file đó.
 *
 * Quy tắc ô bị chặn (ô vuông cạnh `grid`, gốc tại floor.x0/z0):
 *  - Tường = dải dày 2·WALL_HALF dọc theo cạnh phòng có `walls` và cạnh sàn, trừ khoảng cửa.
 *  - Đồ vật `solid` = hình chữ nhật w×d (xoay 90° thì đổi w/d).
 *  - Ô bị chặn nếu giao với một trong các hình trên với diện tích dương (so sánh chặt, sai số EPS).
 */
export const WALL_HALF = 0.05;
const EPS = 1e-6;

export function footprint(o: Pick<MapObject, 'x' | 'z' | 'w' | 'd' | 'rot'>): Rect {
  const [w, d] = Math.round(o.rot) % 180 === 0 ? [o.w, o.d] : [o.d, o.w];
  return { x0: o.x - w / 2, x1: o.x + w / 2, z0: o.z - d / 2, z1: o.z + d / 2 };
}

export const sideLength = (r: Rect, side: Side) => (side === 'n' || side === 's' ? r.x1 - r.x0 : r.z1 - r.z0);

/** Các đoạn tường [a, b] (tính từ góc tây / bắc của cạnh) sau khi trừ cửa. */
export function wallSegments(r: Rect, doors: Door[] = []): { side: Side; a: number; b: number }[] {
  const out: { side: Side; a: number; b: number }[] = [];
  for (const side of ['n', 's', 'w', 'e'] as const) {
    const len = sideLength(r, side);
    let t = 0;
    for (const [a, b] of [...doors.filter((d) => d.side === side).map((d) => [d.at, d.at + d.w]).sort((p, q) => p[0] - q[0]), [len, len]]) {
      if (a > t + EPS) out.push({ side, a: t, b: a });
      t = Math.max(t, b);
    }
  }
  return out;
}

/** Đoạn tường → hình chữ nhật mỏng (toạ độ thật). */
export function wallRect(r: Rect, s: { side: Side; a: number; b: number }): Rect {
  switch (s.side) {
    case 'n': return { x0: r.x0 + s.a, x1: r.x0 + s.b, z0: r.z0 - WALL_HALF, z1: r.z0 + WALL_HALF };
    case 's': return { x0: r.x0 + s.a, x1: r.x0 + s.b, z0: r.z1 - WALL_HALF, z1: r.z1 + WALL_HALF };
    case 'w': return { x0: r.x0 - WALL_HALF, x1: r.x0 + WALL_HALF, z0: r.z0 + s.a, z1: r.z0 + s.b };
    case 'e': return { x0: r.x1 - WALL_HALF, x1: r.x1 + WALL_HALF, z0: r.z0 + s.a, z1: r.z0 + s.b };
  }
}

export interface Zone { id: string; name: string }

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly g: number;
  private readonly blocked: Uint8Array;

  constructor(readonly map: OfficeMapV2) {
    this.g = map.grid;
    this.cols = Math.round((map.floor.x1 - map.floor.x0) / this.g);
    this.rows = Math.round((map.floor.z1 - map.floor.z0) / this.g);
    this.blocked = new Uint8Array(this.cols * this.rows);
    for (const room of map.rooms) if (room.walls) for (const s of wallSegments(room, room.doors)) this.mark(wallRect(room, s));
    for (const s of wallSegments(map.floor, map.outerDoors)) this.mark(wallRect(map.floor, s));
    for (const o of map.objects) if (o.solid) this.mark(footprint(o));
  }

  private mark(r: Rect) {
    const { x0: fx, z0: fz } = this.map.floor;
    const i0 = Math.max(0, Math.floor((r.x0 - fx) / this.g)), i1 = Math.min(this.cols - 1, Math.ceil((r.x1 - fx) / this.g) - 1);
    const j0 = Math.max(0, Math.floor((r.z0 - fz) / this.g)), j1 = Math.min(this.rows - 1, Math.ceil((r.z1 - fz) / this.g) - 1);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const cx0 = fx + i * this.g, cz0 = fz + j * this.g;
        if (r.x0 < cx0 + this.g - EPS && r.x1 > cx0 + EPS && r.z0 < cz0 + this.g - EPS && r.z1 > cz0 + EPS) this.blocked[j * this.cols + i] = 1;
      }
  }

  cellOf(x: number, z: number): [number, number] {
    return [Math.floor((x - this.map.floor.x0) / this.g), Math.floor((z - this.map.floor.z0) / this.g)];
  }
  center(i: number, j: number): [number, number] {
    return [this.map.floor.x0 + (i + 0.5) * this.g, this.map.floor.z0 + (j + 0.5) * this.g];
  }
  freeCell(i: number, j: number) {
    return i >= 0 && j >= 0 && i < this.cols && j < this.rows && this.blocked[j * this.cols + i] === 0;
  }
  walkable(x: number, z: number) {
    const [i, j] = this.cellOf(x, z);
    return this.freeCell(i, j);
  }
  /** Hình tròn bán kính r đứng được không (kiểm tra 4 điểm biên + tâm). */
  fits(x: number, z: number, r: number) {
    return this.walkable(x, z) && this.walkable(x - r, z - r) && this.walkable(x + r, z - r) && this.walkable(x - r, z + r) && this.walkable(x + r, z + r);
  }

  /** Ô trống gần (x, z) nhất (tìm loang). */
  nearestFree(x: number, z: number): [number, number] | null {
    const [si, sj] = this.cellOf(x, z);
    for (let rad = 0; rad < Math.max(this.cols, this.rows); rad++)
      for (let j = sj - rad; j <= sj + rad; j++)
        for (let i = si - rad; i <= si + rad; i++)
          if ((Math.abs(i - si) === rad || Math.abs(j - sj) === rad) && this.freeCell(i, j)) return [i, j];
    return null;
  }

  /** A* 8 hướng (không cắt góc tường), trả về các điểm đi qua đã làm mượt; [] nếu không tới được. */
  findPath(fromX: number, fromZ: number, toX: number, toZ: number, radius = 0.22): [number, number][] {
    const start = this.walkable(fromX, fromZ) ? this.cellOf(fromX, fromZ) : this.nearestFree(fromX, fromZ);
    const goal = this.walkable(toX, toZ) ? this.cellOf(toX, toZ) : this.nearestFree(toX, toZ);
    if (!start || !goal) return [];
    const N = this.cols * this.rows, idx = (i: number, j: number) => j * this.cols + i;
    const gScore = new Float64Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const h = (i: number, j: number) => { const dx = Math.abs(i - goal[0]), dy = Math.abs(j - goal[1]); return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy); };
    const open: [number, number][] = []; // [f, index] — heap nhỏ
    const push = (f: number, n: number) => { open.push([f, n]); let k = open.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (open[p][0] <= open[k][0]) break; [open[p], open[k]] = [open[k], open[p]]; k = p; } };
    const pop = () => { const top = open[0], last = open.pop()!; if (open.length) { open[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < open.length && open[l][0] < open[m][0]) m = l; if (r < open.length && open[r][0] < open[m][0]) m = r; if (m === k) break; [open[m], open[k]] = [open[k], open[m]]; k = m; } } return top; };
    const s = idx(start[0], start[1]), gl = idx(goal[0], goal[1]);
    gScore[s] = 0; push(h(start[0], start[1]), s);
    while (open.length) {
      const [, cur] = pop();
      if (cur === gl) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const ci = cur % this.cols, cj = (cur / this.cols) | 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di, nj = cj + dj;
          if (!this.freeCell(ni, nj)) continue;
          if (di && dj && (!this.freeCell(ci + di, cj) || !this.freeCell(ci, cj + dj))) continue; // không cắt góc
          const n = idx(ni, nj), tentative = gScore[cur] + (di && dj ? Math.SQRT2 : 1);
          if (tentative < gScore[n]) { gScore[n] = tentative; came[n] = cur; push(tentative + h(ni, nj), n); }
        }
    }
    if (s !== gl && came[gl] < 0) return [];
    const cells: [number, number][] = [];
    for (let c = gl; c !== -1; c = c === s ? -1 : came[c]) cells.push(this.center(c % this.cols, (c / this.cols) | 0));
    cells.reverse();
    // Đích đi được thì đi tới đúng điểm bấm; bỏ ô xuất phát
    if (this.walkable(toX, toZ) && this.fits(toX, toZ, radius)) cells[cells.length - 1] = [toX, toZ];
    // Làm mượt: nhảy tới điểm xa nhất còn nhìn thấy
    const path: [number, number][] = [];
    let from: [number, number] = [fromX, fromZ], k = 1;
    while (k < cells.length) {
      let far = k;
      while (far + 1 < cells.length && this.clearLine(from, cells[far + 1], radius)) far++;
      path.push(cells[far]);
      from = cells[far];
      k = far + 1;
    }
    if (!path.length && cells.length) path.push(cells[cells.length - 1]);
    return path;
  }

  /** Đi thẳng từ a tới b (hình tròn bán kính r) có vướng gì không. */
  clearLine(a: [number, number], b: [number, number], r: number) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.max(1, Math.ceil(len / 0.1));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      if (!this.fits(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, r)) return false;
    }
    return true;
  }

  /** Các ô tới được từ (x, z) (loang 4 hướng) — để kiểm tra bản đồ. */
  reachableFrom(x: number, z: number): Uint8Array {
    const seen = new Uint8Array(this.cols * this.rows);
    const [si, sj] = this.cellOf(x, z);
    if (!this.freeCell(si, sj)) return seen;
    const q = [sj * this.cols + si];
    seen[q[0]] = 1;
    while (q.length) {
      const c = q.pop()!, i = c % this.cols, j = (c / this.cols) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (this.freeCell(ni, nj) && !seen[nj * this.cols + ni]) { seen[nj * this.cols + ni] = 1; q.push(nj * this.cols + ni); }
      }
    }
    return seen;
  }

  /** Lưới dạng chữ: '#' = chặn, '.' = trống (mỗi dòng một hàng z). Dùng làm fixture so sánh với server. */
  toText() {
    const lines: string[] = [];
    for (let j = 0; j < this.rows; j++) {
      let s = '';
      for (let i = 0; i < this.cols; i++) s += this.blocked[j * this.cols + i] ? '#' : '.';
      lines.push(s);
    }
    return lines.join('\n') + '\n';
  }

  /** Khu đang đứng: khu phòng ban trong khu mở trước, rồi tới phòng. */
  zoneAt(x: number, z: number): Zone | null {
    const inR = (r: Rect) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
    const a = this.map.areas.find(inR);
    if (a) return { id: a.id, name: a.name };
    const r = this.map.rooms.find((room) => room.walls && inR(room)) ?? this.map.rooms.find(inR);
    return r ? { id: r.zone, name: r.name } : null;
  }
}
