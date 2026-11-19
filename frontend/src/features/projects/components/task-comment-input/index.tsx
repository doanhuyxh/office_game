import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { File as FileIcon, Paperclip, Smartphone, X } from 'lucide-react';
import { Button } from '@/components/common/button';
import { MentionList, type IMentionOption } from '@/components/common/mention-list';
import { MessageInput } from '@/components/common/message-input';
import { useMentionNav } from '@/hooks/useMentionNav';
import { mentionHint, nextMentionQuery, rankPeople, replaceMentionQuery } from '@/utils/mention';
import { cn } from '@/utils/cn';
import type { IMember } from '../../types/project.types';
import { MAX_COMMENT_FILES, formatBytes, isImageFile } from '../../utils/attachments';

/**
 * Nút đính kèm / tải từ thiết bị khác (TEST-196): `outline` (viền + nền nhẹ như ô nhập) để nhìn là biết bấm được ngay khi nghỉ —
 * icon màu chữ chính (không `muted-foreground`), rê chuột / nhấn đổi nền + viền đậm, focus bàn phím có vòng `ring` (sẵn trong `Button`).
 * Vô hiệu (đang gửi / đủ số tệp): viền đứt, bỏ nền + bóng, mờ, con trỏ cấm (`pointer-events-auto` để thấy con trỏ + tooltip;
 * trình duyệt vẫn không phát click cho nút `disabled`).
 */
const ATTACH_BUTTON = cn(
  'shrink-0 border-input text-foreground hover:border-ring/70 active:scale-95 active:bg-accent dark:hover:border-ring dark:active:bg-input/60',
  'disabled:pointer-events-auto disabled:cursor-not-allowed disabled:border-dashed disabled:bg-transparent disabled:opacity-45 disabled:shadow-none',
  'disabled:hover:border-input disabled:hover:bg-transparent disabled:active:scale-100 dark:disabled:bg-transparent dark:disabled:hover:bg-transparent',
);

/**
 * Ô bình luận việc (TEST-62): gõ @ → gợi ý thành viên dự án (có cả tài khoản bot), ↑↓ Enter / Tab chọn, Esc đóng.
 * Lọc ở FE (thành viên ít) theo cùng quy tắc tìm người với server (TEST-71): không dấu, gõ họ tên có dấu cách, mọi từ phải khớp, xếp hạng.
 * Chọn → chèn "@<mã NV>" — đúng cú pháp back-end đọc (`AgentTeamRules.MentionedCodes`) và bot dùng qua MCP comment_task.
 * Đính kèm ảnh / tệp: nút kẹp giấy, dán ảnh (Ctrl+V), kéo-thả vào ô; xem trước + bỏ (×) trước khi gửi; tối đa 5 tệp. Tải lên khi bấm gửi
 * (chỗ gọi lo tải + đăng — `pending` bao cả hai). Chỉ có tệp, không chữ vẫn gửi được.
 * Nút điện thoại cạnh kẹp giấy (`onUploadLink`, TEST-175): mở hộp tạo link tải tệp từ thiết bị khác.
 */
export function TaskCommentInput({ members, value, onChange, onSubmit, pending, files, onAddFiles, onRemoveFile, onUploadLink }: {
  members: IMember[]; value: string; onChange: (text: string) => void; onSubmit: () => void; pending: boolean;
  files: File[]; onAddFiles: (list: File[]) => void; onRemoveFile: (index: number) => void; onUploadLink?: () => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const previews = useMemo(() => files.map((f) => (isImageFile(f) ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);
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

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = [...e.clipboardData.files];
    if (pasted.length > 0) {
      e.preventDefault();
      if (!pending) onAddFiles(pasted);
    }
  };
  const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes('Files');
  const onDragEnter = (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); dragDepth.current++; setDragging(true); } };
  const onDragOver = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
  const onDragLeave = () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false); };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (!pending) onAddFiles([...e.dataTransfer.files]);
  };

  return (
    <div data-mention-open={live !== null || undefined} data-testid="task-comment-box"
      className={cn('relative rounded-md', dragging && 'ring-2 ring-primary/60 ring-offset-2 ring-offset-background')}
      onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {dragging && <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-md bg-background/80 text-sm font-medium text-primary">Thả ảnh / tệp để đính kèm</div>}
      {files.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" data-testid="task-comment-files">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="relative flex max-w-56 items-center gap-2 rounded-md border bg-muted/40 py-1.5 ps-2 pe-7">
              {previews[i] ? <img src={previews[i]!} alt="" className="size-8 shrink-0 rounded object-cover" /> : <FileIcon className="size-5 shrink-0 text-muted-foreground" />}
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium">{f.name}</span>
                <span className="block text-[11px] text-muted-foreground">{formatBytes(f.size)}</span>
              </span>
              <button type="button" className="absolute top-1 right-1 rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
                aria-label={`Bỏ ${f.name}`} disabled={pending} onClick={() => onRemoveFile(i)}>
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <MessageInput ref={area} placeholder="Viết bình luận… (gõ @ để nhắc thành viên, dán / kéo ảnh để đính kèm)" ariaLabel="Bình luận" sendLabel="Gửi bình luận" value={value} onChange={change}
        onSubmit={() => { setQuery(null); onSubmit(); }} pending={pending} canSubmit={value.trim().length > 0 || files.length > 0} onPaste={onPaste}
        sendTestId="task-comment-send"
        leading={<>
          <input ref={picker} type="file" multiple className="hidden" data-testid="task-comment-file-input"
            onChange={(e) => { const list = [...(e.target.files ?? [])]; e.target.value = ''; onAddFiles(list); }} />
          <Button type="button" variant="outline" size="icon" className={ATTACH_BUTTON} aria-label="Chọn tệp / ảnh đính kèm"
            title={files.length >= MAX_COMMENT_FILES ? `Đã đủ ${MAX_COMMENT_FILES} tệp — bỏ bớt để chọn thêm` : `Chọn tệp (tối đa ${MAX_COMMENT_FILES} tệp)`}
            data-testid="task-comment-attach" disabled={pending || files.length >= MAX_COMMENT_FILES} onClick={() => picker.current?.click()}>
            <Paperclip />
          </Button>
          {onUploadLink && (
            <Button type="button" variant="outline" size="icon" className={ATTACH_BUTTON} aria-label="Tải từ thiết bị khác" title="Tải từ thiết bị khác (link / mã QR, không cần đăng nhập)"
              data-testid="task-comment-upload-link" onClick={onUploadLink}>
              <Smartphone />
            </Button>
          )}
        </>}
        inputTestId="task-comment-input"
        onKeyDown={(e) => { if (nav.handleKey({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing })) e.preventDefault(); }}
        onSelect={() => { if (area.current) setQuery(queryAtCaret(area.current.value)); }}
        overlay={<MentionList options={options} active={nav.active} onPick={pick} onHover={nav.setActive} query={live ?? ''} open={live !== null}
          className="absolute bottom-full left-0 mb-1" />} />
    </div>
  );
}
