import { Fragment, type ReactNode } from 'react';
import { cn } from '@/utils/cn';

/** **đậm** trong một dòng → <strong>. Không dùng innerHTML: nội dung do người dùng nhập, chỉ dựng phần tử React. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>);
}

/**
 * Hiển thị Markdown tối giản cho hướng dẫn phòng ban / chức vụ: tiêu đề `#`/`##`/`###`, gạch đầu dòng `-`/`*`/`1.`, **đậm**, đoạn văn.
 * Cố ý không hỗ trợ link / ảnh / HTML (an toàn, đủ cho tài liệu nội bộ).
 */
export function GuideText({ text, className }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(<Tag key={blocks.length} className={cn('ml-5 space-y-0.5', list.ordered ? 'list-decimal' : 'list-disc')}>
      {list.items.map((it, i) => <li key={i}>{inline(it)}</li>)}</Tag>);
    list = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push(<div key={blocks.length} className={cn('font-semibold', h[1].length === 1 ? 'text-base' : 'text-sm', blocks.length > 0 && 'pt-2')}>{inline(h[2])}</div>);
    } else if (ul || ol) {
      const ordered = !!ol && !ul;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((ul ?? ol)![1]);
    } else if (line.trim() === '') {
      flush();
    } else {
      flush();
      blocks.push(<p key={blocks.length}>{inline(line)}</p>);
    }
  }
  flush();
  return <div className={cn('space-y-1.5 text-sm leading-relaxed', className)}>{blocks}</div>;
}
