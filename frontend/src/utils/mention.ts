/** @nhắc dùng chung: Bảng tin (bình luận, soạn bài) + bình luận việc trong dự án. */

/** Từ khoá sau dấu @ ngay trước con trỏ (≤ 20 ký tự, không khoảng trắng; "@" đứng đầu hoặc sau khoảng trắng) hoặc null. */
export function mentionQuery(before: string): string | null {
  const m = /(?:^|\s)@([^\s@]{0,20})$/.exec(before);
  return m ? m[1] : null;
}

/** Thay "@từ-khoá" ngay trước con trỏ bằng `insert` (đã gồm "@"), thêm một khoảng trắng; trả chữ mới + vị trí con trỏ mới. */
export function replaceMentionQuery(text: string, caret: number, insert: string): { text: string; caret: number } {
  const before = text.slice(0, caret).replace(/@[^\s@]{0,20}$/, `${insert} `);
  return { text: before + text.slice(caret), caret: before.length };
}

/**
 * "@mã-nhân-viên" trong văn bản — khớp `AgentTeamRules.MentionedCodes` ở back-end: trước @ không phải chữ / số / _ . @
 * (email a@b.c không tính), mã 2–40 ký tự chữ / số / _ . -, bỏ dấu chấm / gạch cuối.
 */
const MENTION_CODE = /(?<![\p{L}\p{N}_.@])@([\p{L}\p{N}_.-]{2,40})/gu;

export type MentionPart = string | { code: string; name: string };

/** Tách văn bản thành chữ thường + @mã có trong `names` (khoá = mã viết HOA → họ tên). Mã không có trong danh sách giữ nguyên chữ. */
export function splitMentions(text: string, names: ReadonlyMap<string, string>): MentionPart[] {
  const parts: MentionPart[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_CODE)) {
    const code = m[1].replace(/[.-]+$/, '');
    const name = code.length >= 2 ? names.get(code.toUpperCase()) : undefined;
    if (!name) continue;
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push({ code, name });
    last = m.index + 1 + code.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
