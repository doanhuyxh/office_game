import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen, HardDrive } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { IFolder } from '../../types/document.types';

/** Cây thư mục của một kho; null = gốc kho. Mở sẵn nhánh chứa thư mục đang chọn. */
export function FolderTree({ folders, selected, onSelect, rootLabel }: {
  folders: IFolder[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  rootLabel: string;
}) {
  const children = useMemo(() => {
    const m = new Map<string | null, IFolder[]>();
    folders.forEach((f) => m.set(f.parentId, [...(m.get(f.parentId) ?? []), f]));
    m.forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name, 'vi')));
    return m;
  }, [folders]);
  const ancestors = useMemo(() => {
    const byId = new Map(folders.map((f) => [f.id, f]));
    const s = new Set<string>();
    for (let cur = selected ? byId.get(selected) : undefined; cur && !s.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) s.add(cur.id);
    return s;
  }, [folders, selected]);

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5 text-sm" role="tree">
      <button type="button" onClick={() => onSelect(null)}
        className={cn('flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted', selected === null && 'bg-muted font-medium')}>
        <HardDrive className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{rootLabel}</span>
      </button>
      {(children.get(null) ?? []).map((f) => (
        <Node key={f.id} f={f} depth={1} children={children} selected={selected} ancestors={ancestors} onSelect={onSelect} />
      ))}
    </div>
  );
}

function Node({ f, depth, children, selected, ancestors, onSelect }: {
  f: IFolder; depth: number; children: Map<string | null, IFolder[]>; selected: string | null; ancestors: Set<string>; onSelect: (id: string) => void;
}) {
  const kids = children.get(f.id) ?? [];
  const [open, setOpen] = useState(false);
  const expanded = open || (ancestors.has(f.id) && f.id !== selected);
  const active = selected === f.id;
  return (
    <>
      <div className={cn('flex min-w-0 items-center rounded-md hover:bg-muted', active && 'bg-muted font-medium')} style={{ paddingLeft: depth * 12 }}>
        <button type="button" className="flex size-6 shrink-0 items-center justify-center text-muted-foreground" aria-label={expanded ? 'Thu gọn' : 'Mở rộng'}
          onClick={() => setOpen(!expanded)} disabled={!kids.length}>
          {kids.length ? (expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />) : null}
        </button>
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left" onClick={() => onSelect(f.id)}>
          {active || expanded ? <FolderOpen className="size-4 shrink-0 text-warning" /> : <Folder className="size-4 shrink-0 text-warning" />}
          <span className="truncate">{f.name}</span>
          {f.assetCount > 0 && <span className="ms-auto text-xs text-muted-foreground tabular-nums">{f.assetCount}</span>}
        </button>
      </div>
      {expanded && kids.map((k) => <Node key={k.id} f={k} depth={depth + 1} children={children} selected={selected} ancestors={ancestors} onSelect={onSelect} />)}
    </>
  );
}
