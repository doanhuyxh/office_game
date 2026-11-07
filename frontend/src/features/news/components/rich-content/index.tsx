import { cn } from '@/utils/cn';
import './rich-content.css';

/** Hiển thị HTML bài viết. HTML đã được BE lọc (HtmlSanitizer: chỉ thẻ định dạng, link http(s)/mailto/tel) trước khi lưu — FE không tự sinh HTML từ nguồn khác. */
export function RichContent({ html, className }: { html: string; className?: string }) {
  return <div className={cn('news-rich', className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
