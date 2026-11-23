import type { IWikiTreeItem } from '../types/wiki.types';

/** Một trang trong cây đã dựng: `depth` 1 = gốc, `children` theo `position`. */
export interface IWikiNode { page: IWikiTreeItem; depth: number; children: IWikiNode[] }

/** Dựng cây từ danh sách phẳng của API (trang con có cha không còn → coi là gốc, không mất trang). */
export function buildWikiTree(pages: IWikiTreeItem[]): IWikiNode[] {
  const ids = new Set(pages.map((p) => p.id));
  const byParent = new Map<string | null, IWikiTreeItem[]>();
  for (const p of pages) {
    const key = p.parentId && ids.has(p.parentId) ? p.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), p]);
  }
  const build = (parent: string | null, depth: number): IWikiNode[] =>
    (byParent.get(parent) ?? [])
      .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title, 'vi'))
      .map((page) => ({ page, depth, children: build(page.id, depth + 1) }));
  return build(null, 1);
}

/** Duyệt theo chiều sâu (cha trước con) — thứ tự hiển thị / danh sách chọn trang cha. */
export function flattenWikiTree(nodes: IWikiNode[]): IWikiNode[] {
  return nodes.flatMap((n) => [n, ...flattenWikiTree(n.children)]);
}

/** Chiều cao cây con tính cả chính nó (trang lá = 1) — kiểm tra trước giới hạn số cấp khi chuyển trang cha (server vẫn kiểm). */
export function subtreeHeight(node: IWikiNode): number {
  return 1 + Math.max(0, ...node.children.map(subtreeHeight));
}

/** Id của trang và mọi trang con cháu (không được làm trang cha của chính nó). */
export function subtreeIds(node: IWikiNode): Set<string> {
  return new Set(flattenWikiTree([node]).map((n) => n.page.id));
}
