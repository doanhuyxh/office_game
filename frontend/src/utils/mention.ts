/** @nhắc dùng chung: Bảng tin (bình luận, soạn bài), bình luận việc trong dự án, chat. */

/** Độ dài tối đa từ khoá @ (khớp `PersonSearch.MaxTermLength` ở back-end) và số từ tối đa khi gõ họ tên có dấu cách. */
export const MENTION_MAX_CHARS = 40;
export const MENTION_MAX_WORDS = 3;

/**
 * Từ khoá sau dấu @ ngay trước con trỏ ("@" đứng đầu hoặc sau khoảng trắng) hoặc null.
 * `multiWord` = false: một từ ≤ 20 ký tự. true (danh sách gợi ý đang mở): tối đa 3 từ / 40 ký tự cách nhau MỘT dấu cách —
 * hai dấu cách liền hoặc xuống dòng là đóng.
 */
export function mentionQuery(before: string, multiWord = false): string | null {
  const m = multiWord
    ? /(?:^|\s)@((?:[^\s@]+ ){0,2}[^\s@]*)$/.exec(before)
    : /(?:^|\s)@([^\s@]{0,20})$/.exec(before);
  return m && m[1].length <= MENTION_MAX_CHARS ? m[1] : null;
}

/** Từ khoá mới sau khi gõ / di con trỏ: chỉ cho thêm dấu cách khi gợi ý đang mở (`prev` khác null) — gõ câu bình thường sau "@mã " không mở lại. */
export function nextMentionQuery(before: string, prev: string | null): string | null {
  const q = mentionQuery(before, prev !== null);
  return q !== null && q.includes(' ') && prev === null ? null : q;
}

/** Thay "@`query`" ngay trước con trỏ bằng `insert` (đã gồm "@"), thêm một khoảng trắng; trả chữ mới + vị trí con trỏ mới. */
export function replaceMentionQuery(text: string, caret: number, query: string, insert: string): { text: string; caret: number } {
  const before = `${text.slice(0, Math.max(0, caret - query.length - 1))}${insert} `;
  return { text: before + text.slice(caret), caret: before.length };
}

/** Chữ thường, bỏ dấu tiếng Việt (đ → d) — mỗi code point ra đúng một ký tự (để tô phần khớp theo chỉ số). */
export const foldText = (s: string) => [...s].map((c) => c.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase().slice(0, 1) || c).join('');

/** Từ khoá đã bỏ dấu, tách theo khoảng trắng, bỏ trùng, tối đa 3 từ — như `PersonSearch.Tokens` ở back-end. */
export function mentionTokens(query: string): string[] {
  return [...new Set(foldText(query.trim().slice(0, MENTION_MAX_CHARS)).split(/\s+/).filter(Boolean))].slice(0, MENTION_MAX_WORDS);
}

/**
 * Hạng một người (null = không khớp; nhỏ = tốt) — cùng quy tắc `PersonSearch.Rank` ở back-end: mọi từ phải khớp;
 * mã chính xác → đầu tên gọi (từ cuối) → đầu một từ trong họ tên → đầu mã / từ phòng ban / chức vụ → giữa chuỗi.
 */
export function rankPerson(tokens: string[], fullName: string, code: string, extra = ''): number | null {
  if (tokens.length === 0) return 0;
  const name = foldText(fullName).split(/\s+/).filter(Boolean);
  const fCode = foldText(code);
  const other = foldText(extra).split(/\s+/).filter(Boolean);
  let worst = 0;
  let sum = 0;
  for (const t of tokens) {
    let tier: number;
    if (fCode === t) tier = 0;
    else if (name.length > 0 && name[name.length - 1].startsWith(t)) tier = 1;
    else if (name.some((w) => w.startsWith(t))) tier = 2;
    else if (fCode.startsWith(t) || other.some((w) => w.startsWith(t))) tier = 3;
    else if (name.some((w) => w.includes(t)) || fCode.includes(t) || other.some((w) => w.includes(t))) tier = 4;
    else return null;
    worst = Math.max(worst, tier);
    sum += tier;
  }
  return worst * 16 + sum;
}

/** Lọc + xếp hạng trong bộ nhớ (cùng hạng → theo tên), dùng cho danh sách nhỏ có sẵn ở FE (thành viên dự án). */
export function rankPeople<T>(items: T[], query: string, pick: (x: T) => { name: string; code: string; extra?: string }): T[] {
  const tokens = mentionTokens(query);
  return items
    .map((x) => { const p = pick(x); return { x, name: p.name, rank: rankPerson(tokens, p.name, p.code, p.extra) }; })
    .filter((r) => r.rank !== null)
    .sort((a, b) => a.rank! - b.rank! || a.name.localeCompare(b.name, 'vi'))
    .map((r) => r.x);
}

/** Dòng phụ gợi ý: "mã · phòng ban · chức danh" (bỏ phần trống). */
export const mentionHint = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ');

/** Tách `text` thành các đoạn [chữ, có khớp từ khoá không] để tô phần khớp trong danh sách gợi ý (không dấu, không phân biệt hoa thường). */
export function highlightMatches(text: string, query: string): [string, boolean][] {
  const tokens = mentionTokens(query);
  const chars = [...text];
  const folded = foldText(text); // một ký tự / code point → cùng chỉ số với `chars`
  const hit = new Array<boolean>(chars.length).fill(false);
  for (const t of tokens) {
    for (let i = folded.indexOf(t); i >= 0; i = folded.indexOf(t, i + 1)) hit.fill(true, i, i + t.length);
  }
  const parts: [string, boolean][] = [];
  for (let i = 0; i < chars.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last[1] === hit[i]) last[0] += chars[i];
    else parts.push([chars[i], hit[i]]);
  }
  return parts;
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
