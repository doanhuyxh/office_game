import { useRef, useState } from 'react';
import { MentionList, type IMentionOption } from '@/components/common/mention-list';
import { MessageInput } from '@/components/common/message-input';
import { fold } from '@/components/common/SearchSelectField';
import { useMentionNav } from '@/hooks/useMentionNav';
import { mentionQuery, replaceMentionQuery } from '@/utils/mention';
import type { IMember } from '../../types/project.types';

/**
 * Ô bình luận việc (TEST-62): gõ @ → gợi ý thành viên dự án (lọc họ tên / mã, không dấu; có cả tài khoản bot), ↑↓ Enter / Tab chọn, Esc đóng.
 * Chọn → chèn "@<mã NV>" — đúng cú pháp back-end đọc (`AgentTeamRules.MentionedCodes`) và bot dùng qua MCP comment_task.
 */
export function TaskCommentInput({ members, value, onChange, onSubmit, pending }: {
  members: IMember[]; value: string; onChange: (text: string) => void; onSubmit: () => void; pending: boolean;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const q = query === null ? '' : fold(query);
  const options: IMentionOption[] = query === null ? [] : members
    .filter((m) => m.isActive && m.code && (!q || fold(m.fullName).includes(q) || fold(m.code).includes(q)))
    .slice(0, 6)
    .map((m) => ({ key: m.code!, name: m.fullName, hint: m.code, avatarUrl: m.avatarUrl ?? null, isBot: m.isBot }));
  const nav = useMentionNav(options, pick, () => setQuery(null));

  const queryAtCaret = (text: string) => mentionQuery(text.slice(0, area.current?.selectionStart ?? text.length));

  function change(text: string) {
    onChange(text);
    setQuery(queryAtCaret(text));
    nav.setActive(0);
  }

  function pick(o: IMentionOption) {
    const next = replaceMentionQuery(value, area.current?.selectionStart ?? value.length, `@${o.key}`);
    onChange(next.text);
    setQuery(null);
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(next.caret, next.caret); });
  }

  return (
    <div data-mention-open={options.length > 0 || undefined}>
      <MessageInput ref={area} placeholder="Viết bình luận… (gõ @ để nhắc thành viên)" ariaLabel="Bình luận" sendLabel="Gửi bình luận" value={value} onChange={change}
        onSubmit={() => { setQuery(null); onSubmit(); }} pending={pending} inputTestId="task-comment-input"
        onKeyDown={(e) => { if (nav.handleKey({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing })) e.preventDefault(); }}
        onSelect={() => { if (area.current) setQuery(queryAtCaret(area.current.value)); }}
        overlay={<MentionList options={options} active={nav.active} onPick={pick} onHover={nav.setActive} className="absolute bottom-full left-0 mb-1" />} />
    </div>
  );
}
