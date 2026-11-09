import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/utils/cn';

/** Map thẻ Markdown → class Tailwind (không có plugin typography). */
const COMPONENTS: Components = {
  h1: ({ node: _n, ...p }) => <h1 className="mt-3 mb-1 text-lg font-semibold first:mt-0" {...p} />,
  h2: ({ node: _n, ...p }) => <h2 className="mt-3 mb-1 text-base font-semibold first:mt-0" {...p} />,
  h3: ({ node: _n, ...p }) => <h3 className="mt-2 mb-1 text-sm font-semibold first:mt-0" {...p} />,
  h4: ({ node: _n, ...p }) => <h4 className="mt-2 mb-1 text-sm font-medium first:mt-0" {...p} />,
  p: ({ node: _n, ...p }) => <p className="my-1.5 first:mt-0 last:mb-0" {...p} />,
  ul: ({ node: _n, ...p }) => <ul className="my-1.5 ml-5 list-disc space-y-0.5 [&_ul]:my-0.5" {...p} />,
  ol: ({ node: _n, ...p }) => <ol className="my-1.5 ml-5 list-decimal space-y-0.5 [&_ol]:my-0.5" {...p} />,
  li: ({ node: _n, className, ...p }) => <li className={cn(className?.includes('task-list-item') && '-ml-5 list-none', className)} {...p} />,
  a: ({ node: _n, ...p }) => <a className="break-words text-primary underline underline-offset-2" target="_blank" rel="noopener noreferrer" {...p} />,
  blockquote: ({ node: _n, ...p }) => <blockquote className="my-2 border-l-2 pl-3 text-muted-foreground" {...p} />,
  hr: () => <hr className="my-3" />,
  img: ({ node: _n, alt, ...p }) => <img alt={alt ?? ''} loading="lazy" className="my-2 max-h-96 max-w-full rounded-md border" {...p} />,
  pre: ({ node: _n, ...p }) => <pre className="my-2 overflow-x-auto rounded-md bg-muted p-3 text-xs [&_code]:bg-transparent [&_code]:p-0" {...p} />,
  code: ({ node: _n, ...p }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...p} />,
  table: ({ node: _n, ...p }) => <div className="my-2 overflow-x-auto"><table className="w-full border-collapse text-xs" {...p} /></div>,
  th: ({ node: _n, ...p }) => <th className="border bg-muted px-2 py-1 text-left font-medium" {...p} />,
  td: ({ node: _n, ...p }) => <td className="border px-2 py-1 align-top" {...p} />,
  input: ({ node: _n, ...p }) => <input {...p} disabled className="mr-1.5 align-middle" />,
};

/**
 * Hiển thị Markdown (GFM: bảng, checklist, ~~gạch~~, link tự động) do người dùng nhập.
 * An toàn: react-markdown không render HTML thô và lọc URL `javascript:` — không dùng rehype-raw.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('text-sm leading-relaxed break-words', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>{text}</ReactMarkdown>
    </div>
  );
}
