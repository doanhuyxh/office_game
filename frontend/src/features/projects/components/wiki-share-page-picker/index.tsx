import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Checkbox } from '@/components/common/checkbox';
import { Input } from '@/components/common/input';
import { cn } from '@/utils/cn';
import { checkState, filterTree, toggleNode } from '../../utils/wiki-share-selection';
import { flattenWikiTree, type IWikiNode } from '../../utils/wiki-tree';

/**
 * Cây trang có ô tích cho link chia sẻ phạm vi "Chọn trang" (TEST-230): tích trang cha = tích cả cây con (kèm trang con tạo sau);
 * tích một phần hiện gạch ngang. Ô tìm lọc theo tiêu đề (giữ trang cha để thấy vị trí) + đếm "Đã chọn N trang".
 */
export function WikiSharePagePicker({ tree, selected, onChange, invalid }: {
  tree: IWikiNode[]; selected: ReadonlySet<string>; onChange: (next: Set<string>) => void; invalid?: boolean;
}) {
  const [q, setQ] = useState('');
  const byId = useMemo(() => new Map(flattenWikiTree(tree).map((n) => [n.page.id, n])), [tree]);
  const shown = useMemo(() => filterTree(tree, q), [tree, q]);

  const rows = (nodes: IWikiNode[]) => (
    <ul className="grid gap-0.5">
      {nodes.map((n) => {
        const orig = byId.get(n.page.id) ?? n; // trạng thái tích tính trên cây đầy đủ, không theo cây đã lọc
        const st = checkState(orig, selected);
        const id = `wiki-share-pick-${n.page.id}`;
        return (
          <li key={n.page.id}>
            <label htmlFor={id} style={{ paddingLeft: `${0.25 + (n.depth - 1) * 1.1}rem` }}
              className={cn('flex cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2 text-sm hover:bg-muted', st !== false && 'text-foreground')}
              data-testid="wiki-share-pick" data-state={st === 'indeterminate' ? 'indeterminate' : st ? 'checked' : 'unchecked'}>
              <Checkbox id={id} checked={st} onCheckedChange={() => onChange(toggleNode(orig, selected))} />
              <span className="min-w-0 flex-1 truncate">{n.page.title}</span>
              {orig.children.length > 0 && (
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {st === true ? 'kèm trang con' : `${orig.children.length} trang con`}
                </span>
              )}
            </label>
            {n.children.length > 0 && rows(n.children)}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className={cn('grid gap-2 rounded-md border p-2', invalid && 'border-destructive')} data-testid="wiki-share-picker">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm trang…" className="h-8 pr-8 pl-8" maxLength={200}
            aria-label="Tìm trang theo tiêu đề" data-testid="wiki-share-pick-search" />
          {q && <button type="button" className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Xoá ô tìm"
            onClick={() => setQ('')}><X className="size-4" /></button>}
        </div>
        <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums" data-testid="wiki-share-pick-count">Đã chọn {selected.size} trang</span>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {tree.length === 0 ? <p className="px-2 py-1.5 text-xs text-muted-foreground">Sổ tay chưa có trang nào.</p>
          : shown.length === 0 ? <p className="px-2 py-1.5 text-xs text-muted-foreground">Không có trang nào khớp "{q.trim()}".</p>
            : rows(shown)}
      </div>
    </div>
  );
}
