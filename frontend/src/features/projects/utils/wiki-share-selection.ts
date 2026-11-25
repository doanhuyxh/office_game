import { flattenWikiTree, type IWikiNode } from './wiki-tree';

/**
 * Chọn trang cho link chia sẻ sổ tay phạm vi "Chọn trang" (TEST-230). Trạng thái UI = tập id trang đang tích.
 * - Tích trang cha → tích cả cây con; bỏ tích một trang con → trang cha vẫn tích nhưng không còn "kèm con" (hiện gạch ngang).
 * - Gửi server: trang tích mà cả cây con cũng tích (và có con) → một dòng `includeChildren = true` (gồm cả trang con tạo sau), con cháu không gửi lại;
 *   còn lại gửi từng trang đang tích với `includeChildren = false`.
 */
export type ShareCheck = boolean | 'indeterminate';

/** Id của trang + mọi con cháu (theo cây hiện có). */
export const subtreeOf = (node: IWikiNode): string[] => flattenWikiTree([node]).map((n) => n.page.id);

/** Ô tích của một trang: true = trang + cả cây con đều tích; 'indeterminate' = tích một phần; false = không tích gì. */
export function checkState(node: IWikiNode, selected: ReadonlySet<string>): ShareCheck {
  const ids = subtreeOf(node);
  const n = ids.filter((id) => selected.has(id)).length;
  return n === 0 ? false : n === ids.length ? true : 'indeterminate';
}

/** Bấm ô tích: đang tích đủ → bỏ cả cây con; còn lại → tích cả cây con. */
export function toggleNode(node: IWikiNode, selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  const ids = subtreeOf(node);
  if (checkState(node, selected) === true) ids.forEach((id) => next.delete(id));
  else ids.forEach((id) => next.add(id));
  return next;
}

/** Danh sách gửi API (thứ tự sổ tay). */
export function selectionPayload(tree: IWikiNode[], selected: ReadonlySet<string>): { pageId: string; includeChildren: boolean }[] {
  const out: { pageId: string; includeChildren: boolean }[] = [];
  const walk = (nodes: IWikiNode[]) => {
    for (const n of nodes) {
      if (!selected.has(n.page.id)) { walk(n.children); continue; }
      const full = n.children.length > 0 && checkState(n, selected) === true;
      out.push({ pageId: n.page.id, includeChildren: full });
      if (!full) walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/** Lọc cây theo tiêu đề (không phân biệt hoa thường / dấu): giữ trang khớp + các trang cha của nó. Ô trống → cả cây. */
export function filterTree(tree: IWikiNode[], term: string): IWikiNode[] {
  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  const q = norm(term.trim());
  if (!q) return tree;
  const walk = (nodes: IWikiNode[]): IWikiNode[] =>
    nodes.flatMap((n) => {
      const kids = walk(n.children);
      return norm(n.page.title).includes(q) || kids.length ? [{ ...n, children: kids }] : [];
    });
  return walk(tree);
}
