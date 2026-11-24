import { useEffect, useState, type KeyboardEvent } from 'react';
import { ArrowLeftToLine, ArrowRightToLine, ChevronDown, GripVertical, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/common/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/common/dropdown-menu';
import { markdownHeadingId } from '@/components/common/markdown';
import { cn } from '@/utils/cn';
import type { WikiTocSide } from '../../types/wiki.types';
import type { IMarkdownHeading } from '../../utils/headings';
import { WorkGuideToc } from '../work-guide-toc';

/** Kiểu dữ liệu `dataTransfer` khi kéo bảng mục lục (vùng thả ở khung sổ tay chỉ nhận loại này). */
export const WIKI_TOC_DRAG_TYPE = 'application/x-officehub-wiki-toc';

/** Tiêu đề đang đọc: tiêu đề cuối cùng đã cuộn qua mép trên (scroll-spy bằng IntersectionObserver, không gắn listener cuộn). */
function useActiveHeading(ids: string[]) {
  const [active, setActive] = useState<string | undefined>(ids[0]);
  const key = ids.join('|');
  useEffect(() => {
    const list = key ? key.split('|') : [];
    setActive(list[0]);
    const els = list.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    if (els.length === 0) return;
    const inBand = new Set<string>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) (e.isIntersecting ? inBand.add(e.target.id) : inBand.delete(e.target.id));
      const first = list.find((id) => inBand.has(id));
      if (first) setActive(first);
    }, { rootMargin: '-80px 0px -65% 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [key]);
  return active;
}

/**
 * Bảng mục lục của trang sổ tay: tay nắm ⠿ kéo thả sang cột trái / phải (HTML5 DnD — vùng thả ở `ProjectWiki`), menu ⋯ "Chuyển sang trái / phải"
 * và phím ← / → trên tay nắm (thay cho kéo thả bằng bàn phím / màn cảm ứng), nút thu gọn, tô sáng mục đang đọc. Vị trí + thu gọn lưu ở server
 * theo tài khoản + dự án (`useWikiPrefs`).
 */
export function WikiTocPanel({ headings, prefix, side, collapsed, onSide, onCollapsed, onDragChange, className, testId = 'wiki-toc' }: {
  headings: IMarkdownHeading[]; prefix: string; side: WikiTocSide; collapsed: boolean;
  onSide: (s: WikiTocSide) => void; onCollapsed: (c: boolean) => void; onDragChange: (dragging: boolean) => void; className?: string; testId?: string;
}) {
  const active = useActiveHeading(collapsed ? [] : headings.map((h) => markdownHeadingId(prefix, h.line)));
  const other: WikiTocSide = side === 'right' ? 'left' : 'right';
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' && side !== 'left') { e.preventDefault(); onSide('left'); }
    if (e.key === 'ArrowRight' && side !== 'right') { e.preventDefault(); onSide('right'); }
  };
  return (
    <section className={cn('grid content-start gap-1 rounded-lg border p-2', className)} aria-label="Mục lục trang" data-testid={testId} data-side={side}>
      <div className="flex items-center gap-1">
        <div role="button" tabIndex={0} draggable aria-label={`Kéo để chuyển mục lục sang ${other === 'left' ? 'trái' : 'phải'} (hoặc phím mũi tên trái / phải)`}
          title="Kéo sang trái / phải" data-testid={`${testId}-handle`}
          className="cursor-grab rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
          onKeyDown={onKey}
          onDragStart={(e) => { e.dataTransfer.setData(WIKI_TOC_DRAG_TYPE, side); e.dataTransfer.effectAllowed = 'move'; onDragChange(true); }}
          onDragEnd={() => onDragChange(false)}>
          <GripVertical className="size-4" />
        </div>
        <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
          aria-expanded={!collapsed} onClick={() => onCollapsed(!collapsed)} data-testid={`${testId}-toggle`}>
          <span className="truncate">Mục lục ({headings.length})</span>
          <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', collapsed && '-rotate-90')} />
        </button>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="Tuỳ chọn mục lục" data-testid={`${testId}-menu`}><MoreHorizontal /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onSide(other)} data-testid={`${testId}-move`}>
              {other === 'left' ? <ArrowLeftToLine /> : <ArrowRightToLine />} Chuyển sang {other === 'left' ? 'trái' : 'phải'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {!collapsed && <WorkGuideToc headings={headings} prefix={prefix} activeId={active} className="-mx-0.5" />}
    </section>
  );
}
