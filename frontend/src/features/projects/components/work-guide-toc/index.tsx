import { markdownHeadingId } from '@/components/common/markdown';
import { cn } from '@/utils/cn';
import type { IMarkdownHeading } from '../../utils/headings';

/**
 * Mục lục hướng dẫn làm việc (TEST-183): mỗi tiêu đề `##` một dòng, bấm → cuộn mượt tới tiêu đề có id `markdownHeadingId(prefix, line)`
 * (component `Markdown` với `headingIds={prefix}`). Không có tiêu đề → không hiện gì.
 */
export function WorkGuideToc({ headings, prefix, className }: { headings: IMarkdownHeading[]; prefix: string; className?: string }) {
  if (headings.length === 0) return null;
  const go = (line: number) => {
    const el = document.getElementById(markdownHeadingId(prefix, line));
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(history.state, '', `#${el.id}`);
  };
  return (
    <nav aria-label="Mục lục" className={cn('grid gap-0.5', className)} data-testid="work-guide-toc">
      {headings.map((h) => (
        <a key={h.line} href={`#${markdownHeadingId(prefix, h.line)}`} title={h.text}
          className="truncate rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={(e) => { e.preventDefault(); go(h.line); }}>{h.text}</a>
      ))}
    </nav>
  );
}
