/** Thời gian còn lại dễ đọc: "12 ngày 3 giờ" / "5 giờ 12 phút" / "14:05" (dưới 1 giờ, đếm giây) / "0:00". */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return h > 0 ? `${d} ngày ${h} giờ` : `${d} ngày`;
  if (h > 0) return m > 0 ? `${h} giờ ${m} phút` : `${h} giờ`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Nút cây trang chia sẻ: `depth` 0 = trang gốc. Giữ thứ tự API (server đã sắp theo vị trí). */
export interface IShareNode { id: string; title: string; depth: number; children: IShareNode[] }

export function buildShareTree(pages: { id: string; parentId: string | null; title: string }[], rootId: string | null): IShareNode[] {
  const byParent = new Map<string | null, typeof pages>();
  for (const p of pages) byParent.set(p.parentId, [...(byParent.get(p.parentId) ?? []), p]);
  const build = (parent: string | null, depth: number): IShareNode[] =>
    (byParent.get(parent) ?? []).map((p) => ({ id: p.id, title: p.title, depth, children: depth > 20 ? [] : build(p.id, depth + 1) }));
  const roots = build(null, 0);
  return roots.length ? roots : pages.filter((p) => p.id === rootId).map((p) => ({ id: p.id, title: p.title, depth: 0, children: [] }));
}
