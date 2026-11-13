import { useRef, useState } from 'react';
import { MentionList, type IMentionOption } from '@/components/common/mention-list';
import { MessageInput } from '@/components/common/message-input';
import { useMentionNav } from '@/hooks/useMentionNav';
import { mentionHint, nextMentionQuery, rankPeople, replaceMentionQuery } from '@/utils/mention';
import type { IMember } from '../../types/project.types';

/**
 * Ô bình luận việc (TEST-62): gõ @ → gợi ý thành viên dự án (có cả tài khoản bot), ↑↓ Enter / Tab chọn, Esc đóng.
 * Lọc ở FE (thành viên ít) theo cùng quy tắc tìm người với server (TEST-71): không dấu, gõ họ tên có dấu cách, mọi từ phải khớp, xếp hạng.
 * Chọn → chèn "@<mã NV>" — đúng cú pháp back-end đọc (`AgentTeamRules.MentionedCodes`) và bot dùng qua MCP comment_task.
 */
export function TaskCommentInput({ members, value, onChange, onSubmit, pending }: {
  members: IMember[]; value: string; onChange: (text: string) => void; onSubmit: () => void; pending: boolean;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const found: IMentionOption[] = query === null ? [] : rankPeople(members.filter((m) => m.isActive && m.code), query,
    (m) => ({ name: m.fullName, code: m.code!, extra: m.jobTitle ?? '' }))
    .map((m) => ({ key: m.code!, name: m.fullName, hint: mentionHint(m.code, m.jobTitle), avatarUrl: m.avatarUrl ?? null, isBot: m.isBot }));
  // Gõ họ tên có dấu cách mà không còn ai khớp → đóng gợi ý
  const live = query !== null && query.includes(' ') && found.length === 0 ? null : query;
  const options = live === null ? [] : found;
  const nav = useMentionNav(options, pick, () => setQuery(null));

  const queryAtCaret = (text: string) => nextMentionQuery(text.slice(0, area.current?.selectionStart ?? text.length), live);

  function change(text: string) {
    onChange(text);
    setQuery(queryAtCaret(text));
    nav.setActive(0);
  }

  function pick(o: IMentionOption) {
    const next = replaceMentionQuery(value, area.current?.selectionStart ?? value.length, live ?? '', `@${o.key}`);
    onChange(next.text);
    setQuery(null);
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(next.caret, next.caret); });
  }

  return (
    <div data-mention-open={live !== null || undefined}>
      <MessageInput ref={area} placeholder="Viết bình luận… (gõ @ để nhắc thành viên)" ariaLabel="Bình luận" sendLabel="Gửi bình luận" value={value} onChange={change}
        onSubmit={() => { setQuery(null); onSubmit(); }} pending={pending} inputTestId="task-comment-input"
        onKeyDown={(e) => { if (nav.handleKey({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing })) e.preventDefault(); }}
        onSelect={() => { if (area.current) setQuery(queryAtCaret(area.current.value)); }}
        overlay={<MentionList options={options} active={nav.active} onPick={pick} onHover={nav.setActive} query={live ?? ''} open={live !== null}
          className="absolute bottom-full left-0 mb-1" />} />
    </div>
  );
}
