import { markdownHeadingId } from '@/components/common/markdown';
import { cn } from '@/utils/cn';
import type { IMarkdownHeading } from '../../utils/headings';

/**
 * Mục lục hướng dẫn làm việc (TEST-183): mỗi tiêu đề `##` một dòng, bấm → cuộn mượt tới tiêu đề có id `markdownHeadingId(prefix, line)`
 * (component `Markdown` với `headingIds={prefix}`). `extra` (TEST-186): mục thêm sau tiêu đề (hướng dẫn từng cột) — id phần tử + chữ, nhãn màu tuỳ chọn.
 * Không có mục nào → không hiện gì.
 */
export function WorkGuideToc({ headings, prefix, extra = [], className }: {
  headings: IMarkdownHeading[]; prefix: string; extra?: { id: string; text: string; color?: string }[]; className?: string;
}) {
  if (headings.length === 0 && extra.length === 0) return null;
  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(history.state, '', `#${el.id}`);
  };
  return (
    <nav aria-label="Mục lục" className={cn('grid gap-0.5', className)} data-testid="work-guide-toc">
      {headings.map((h) => (
        <a key={h.line} href={`#${markdownHeadingId(prefix, h.line)}`} title={h.text}
          className="truncate rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={(e) => { e.preventDefault(); go(markdownHeadingId(prefix, h.line)); }}>{h.text}</a>
      ))}
      {extra.map((x) => (
        <a key={x.id} href={`#${x.id}`} title={x.text}
          className="flex items-center gap-1.5 truncate rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={(e) => { e.preventDefault(); go(x.id); }}>
          {x.color && <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: x.color }} />}<span className="truncate">{x.text}</span></a>
      ))}
    </nav>
  );
}
