import type { IDepartment, IPosition } from '../types/employee.types';

/** Phòng ban theo thứ tự cây (cha trước, con sau, cùng cấp theo sortOrder rồi tên) kèm độ sâu. */
export function departmentTree(departments: IDepartment[]): { dept: IDepartment; depth: number }[] {
  const ids = new Set(departments.map((d) => d.id));
  const children = new Map<string | null, IDepartment[]>();
  for (const d of departments) {
    const key = d.parentId && ids.has(d.parentId) ? d.parentId : null;
    children.set(key, [...(children.get(key) ?? []), d]);
  }
  const out: { dept: IDepartment; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const d of (children.get(parent) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi'))) {
      if (seen.has(d.id)) continue; // phòng dữ liệu vòng lặp
      seen.add(d.id);
      out.push({ dept: d, depth });
      walk(d.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Lựa chọn phòng ban cho Select: thụt lề theo cấp. */
export const departmentOptions = (departments: IDepartment[], exclude?: (d: IDepartment) => boolean) =>
  departmentTree(departments).filter(({ dept }) => !exclude?.(dept))
    .map(({ dept, depth }) => ({ value: dept.id, label: `${'   '.repeat(depth)}${depth ? '└ ' : ''}${dept.name}` }));

/** Tên các phòng cấp trên của một phòng, từ gốc xuống cha trực tiếp (vd ["Khối Kỹ thuật", "Công nghệ"]); phòng gốc → []. */
export function departmentAncestors(departments: Pick<IDepartment, 'id' | 'name' | 'parentId'>[], id: string): string[] {
  const byId = new Map(departments.map((d) => [d.id, d]));
  const parentOf = (d?: { parentId?: string | null }) => (d?.parentId ? byId.get(d.parentId) : undefined);
  const out: string[] = [];
  const seen = new Set<string>([id]); // phòng dữ liệu vòng lặp
  for (let p = parentOf(byId.get(id)); p && !seen.has(p.id); p = parentOf(p)) {
    seen.add(p.id);
    out.unshift(p.name);
  }
  return out;
}

/** Id phòng ban con cháu (để không chọn làm phòng ban cha). */
export function descendantIds(departments: IDepartment[], id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const d of departments) if (d.parentId === cur && !out.has(d.id)) { out.add(d.id); stack.push(d.id); }
  }
  return out;
}

/**
 * Quản lý trực tiếp gợi ý = trưởng phòng ban của nhân viên; nếu chính họ là trưởng phòng (hoặc phòng chưa có trưởng)
 * thì lấy trưởng phòng ban cấp cha gần nhất.
 */
export function suggestedManager(departments: IDepartment[], departmentId: string | null | undefined, selfId?: string): string | null {
  const byId = new Map(departments.map((d) => [d.id, d]));
  const seen = new Set<string>();
  let d = departmentId ? byId.get(departmentId) : undefined;
  while (d && !seen.has(d.id)) {
    seen.add(d.id);
    if (d.headEmployeeId && d.headEmployeeId !== selfId) return d.headEmployeeId;
    d = d.parentId ? byId.get(d.parentId) : undefined;
  }
  return null;
}

/** "Cấp 3 · Trưởng phòng"; thiếu cấp (dữ liệu cũ / Api chưa cập nhật) → chỉ tên. */
export const positionLabel = (p: IPosition) => (Number.isFinite(p.level) && p.level > 0 ? `Cấp ${p.level} · ${p.name}` : p.name);

/**
 * Cây phòng ban cho bảng thu gọn: con trực tiếp (cùng quy tắc với `departmentTree` — cha không tồn tại = gốc),
 * tổng nhân viên cả khối (phòng + mọi phòng con cháu) và danh sách cấp trên của mỗi phòng.
 */
export function departmentRollup(departments: IDepartment[]) {
  const ids = new Set(departments.map((d) => d.id));
  const byId = new Map(departments.map((d) => [d.id, d]));
  const children = new Map<string, string[]>();
  for (const d of departments) {
    if (d.parentId && ids.has(d.parentId) && d.parentId !== d.id) children.set(d.parentId, [...(children.get(d.parentId) ?? []), d.id]);
  }
  const total = new Map<string, number>();
  const sum = (id: string, path: Set<string>): number => {
    const cached = total.get(id);
    if (cached !== undefined) return cached;
    path.add(id);
    let n = byId.get(id)?.employeeCount ?? 0;
    for (const c of children.get(id) ?? []) if (!path.has(c)) n += sum(c, path); // phòng dữ liệu vòng lặp
    path.delete(id);
    total.set(id, n);
    return n;
  };
  for (const d of departments) sum(d.id, new Set());
  const ancestors = (id: string): string[] => {
    const out: string[] = [];
    const seen = new Set([id]);
    for (let p = byId.get(id)?.parentId; p && ids.has(p) && !seen.has(p); p = byId.get(p)?.parentId) { seen.add(p); out.push(p); }
    return out;
  };
  return { children, total, ancestors };
}
