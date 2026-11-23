import { useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Lock } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { IWikiNode } from '../../utils/wiki-tree';

/**
 * Cây trang sổ tay (TEST-217): thu / mở từng nhánh (mặc định mở hết; nhánh chứa trang đang chọn luôn mở được), trang đang chọn tô nền,
 * 🔒 trang đã khoá, số trang con ở nhánh đang thu. Bấm tên → `onSelect`.
 */
export function WikiPageTree({ nodes, selectedId, onSelect }: { nodes: IWikiNode[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setCollapsed((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const render = (list: IWikiNode[]) => list.map(({ page, depth, children }) => {
    const open = !collapsed.has(page.id);
    const active = page.id === selectedId;
    return (
      <li key={page.id} role="treeitem" aria-expanded={children.length > 0 ? open : undefined} aria-selected={active}>
        <div className={cn('group flex min-h-9 items-center gap-0.5 rounded-md pr-1 text-sm', active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground')}
          style={{ paddingLeft: `${(depth - 1) * 0.75}rem` }}>
          {children.length > 0
            ? <button type="button" className="grid size-6 shrink-0 place-items-center rounded hover:bg-background/60" aria-label={open ? 'Thu gọn' : 'Mở rộng'} onClick={() => toggle(page.id)}>
                {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</button>
            : <span className="grid size-6 shrink-0 place-items-center"><FileText className="size-3.5 opacity-60" /></span>}
          <button type="button" className="min-w-0 flex-1 truncate py-1.5 text-left" title={page.title} onClick={() => onSelect(page.id)} data-testid="wiki-tree-item">
            {page.title}</button>
          {page.locked && <Lock className="size-3 shrink-0 opacity-70" aria-label="Đã khoá" />}
          {!open && <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] leading-4 tabular-nums">{children.length}</span>}
        </div>
        {children.length > 0 && open && <ul role="group" className="grid gap-px">{render(children)}</ul>}
      </li>
    );
  });
  return <ul role="tree" aria-label="Các trang sổ tay" className="grid gap-px" data-testid="wiki-tree">{render(nodes)}</ul>;
}
