/** Một tiêu đề Markdown cho mục lục: dòng nguồn (1-based, khớp `node.position` của react-markdown) + chữ đã bỏ ký hiệu. */
export interface IMarkdownHeading { line: number; text: string }

/**
 * Tiêu đề `##` (ATX) của văn bản Markdown, theo thứ tự — dựng mục lục tab Hướng dẫn (TEST-183). Chỉ đọc chữ ở FE, bỏ qua dòng
 * trong khối code ``` / ~~~. Chữ tiêu đề bỏ đậm / nghiêng / code, link → chữ của link.
 */
export function markdownHeadings(text: string | null | undefined, depth = 2): IMarkdownHeading[] {
  if (!text) return [];
  const out: IMarkdownHeading[] = [];
  const head = new RegExp(`^ {0,3}#{${depth}}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$`);
  let fence: string | null = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(raw);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return;
    }
    if (fence) return;
    const m = head.exec(raw);
    if (!m) return;
    const t = m[1]
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__|~~|`)/g, '')
      .replace(/(^|\W)[*_](\S(?:.*?\S)?)[*_](?=\W|$)/g, '$1$2')
      .trim();
    if (t) out.push({ line: i + 1, text: t });
  });
  return out;
}
