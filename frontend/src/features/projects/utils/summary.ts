/**
 * Một dòng tóm tắt từ mô tả Markdown (đầu trang chi tiết dự án, TEST-138): dòng đầu có chữ, bỏ ký hiệu Markdown
 * (tiêu đề, trích dẫn, gạch đầu dòng, đậm / nghiêng, code, link → chữ của link), cắt ≤ `max` ký tự kèm "…". Rỗng → null.
 */
export function markdownSummary(text: string | null | undefined, max = 120): string | null {
  if (!text) return null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw
      .replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)+/, '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__|~~|`)/g, '')
      .replace(/(^|\W)[*_](\S(?:.*?\S)?)[*_](?=\W|$)/g, '$1$2')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line || /^[-*_=|:\s]+$/.test(line)) continue;
    return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
  }
  return null;
}
