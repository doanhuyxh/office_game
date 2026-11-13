import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react';
import { File as FileIcon, Paperclip, X } from 'lucide-react';
import { Button } from '@/components/common/button';
import { MentionList, type IMentionOption } from '@/components/common/mention-list';
import { MessageInput } from '@/components/common/message-input';
import { useIsMobile } from '@/hooks/use-mobile';
import { useDebounce } from '@/hooks/useDebounce';
import { useMentionNav } from '@/hooks/useMentionNav';
import { cn } from '@/utils/cn';
import { mentionHint, nextMentionQuery, replaceMentionQuery } from '@/utils/mention';
import { useMentionCandidates } from '../../hooks/useChatData';
import { MAX_FILES, MAX_TEXT, formatBytes, isImageFile } from '../../utils/labels';

/**
 * Ô soạn tin: Enter gửi, Shift+Enter xuống dòng, đính kèm bằng nút / dán ảnh (kéo-thả xử lý ở khung chat).
 * Gõ @ (trừ 1-1) → gợi ý thành viên hội thoại (server tìm + xếp hạng như Bảng tin — TEST-71: không dấu, gõ họ tên có dấu cách, mã / phòng ban;
 * bot có chip BOT; chờ 200 ms sau khi ngừng gõ), ↑↓ Enter / Tab chọn, Esc đóng.
 * Chọn → chèn "@<mã NV>" — cùng cú pháp bình luận việc; server tách người được nhắc khi lưu tin.
 */
/** Bản nháp chưa gửi theo hội thoại, giữ qua reload trong tab (sessionStorage; bị chặn thì bỏ qua). */
const readDraft = (key?: string) => { try { return (key && sessionStorage.getItem(key)) || ''; } catch { return ''; } };
const writeDraft = (key: string | undefined, text: string) => {
  if (!key) return;
  try { if (text) sessionStorage.setItem(key, text); else sessionStorage.removeItem(key); } catch { /* bộ nhớ trình duyệt bị chặn */ }
};

export function Composer({ conversationId, canMention, draftKey, files, onAddFiles, onRemoveFile, onSubmit }: {
  conversationId: string;
  /** false với 1-1 (không cần nhắc). */
  canMention: boolean;
  draftKey?: string;
  files: File[];
  onAddFiles: (list: File[]) => void;
  onRemoveFile: (index: number) => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState(() => readDraft(draftKey));
  useEffect(() => writeDraft(draftKey, text), [draftKey, text]);
  const input = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const previews = useMemo(() => files.map((f) => (isImageFile(f) ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);
  useEffect(() => area.current?.focus(), []);
  const isMobile = useIsMobile();
  const [query, setQuery] = useState<string | null>(null);
  const term = useDebounce(query ?? '', 200);
  const candidates = useMentionCandidates(conversationId, canMention && query !== null ? term : null);
  const loading = query !== null && (term !== query || candidates.isFetching);
  const found: IMentionOption[] = query === null || !canMention ? [] : (candidates.data ?? [])
    .map((c) => ({ key: c.code, name: c.fullName, hint: mentionHint(c.code, c.departmentName, c.title), avatarUrl: c.avatarUrl, isBot: c.isBot }));
  // Gõ họ tên có dấu cách mà không còn ai khớp → đóng gợi ý
  const live = !canMention || (query !== null && query.includes(' ') && !loading && found.length === 0) ? null : query;
  const options = live === null ? [] : found;
  const nav = useMentionNav(options, pick, () => setQuery(null));
  const queryAtCaret = (value: string) => nextMentionQuery(value.slice(0, area.current?.selectionStart ?? value.length), live);
  function change(value: string) {
    setText(value);
    setQuery(queryAtCaret(value));
    nav.setActive(0);
  }
  function pick(o: IMentionOption) {
    const next = replaceMentionQuery(text, area.current?.selectionStart ?? text.length, live ?? '', `@${o.key}`);
    setText(next.text);
    setQuery(null);
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(next.caret, next.caret); });
  }
  const canSend = text.trim().length > 0 || files.length > 0;
  const submit = () => {
    if (!canSend) return;
    setQuery(null);
    onSubmit(text.trim());
    setText('');
    area.current?.focus();
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = [...e.clipboardData.files];
    if (pasted.length > 0) {
      e.preventDefault();
      onAddFiles(pasted);
    }
  };

  return (
    <div className="border-t p-3">
      {files.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" data-testid="chat-files">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="relative flex max-w-56 items-center gap-2 rounded-md border bg-muted/40 py-1.5 ps-2 pe-7">
              {previews[i] ? <img src={previews[i]!} alt="" className="size-8 shrink-0 rounded object-cover" /> : <FileIcon className="size-5 shrink-0 text-muted-foreground" />}
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium">{f.name}</span>
                <span className="block text-[11px] text-muted-foreground">{formatBytes(f.size)}</span>
              </span>
              <button type="button" className="absolute top-1 right-1 rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground" aria-label={`Bỏ ${f.name}`} onClick={() => onRemoveFile(i)}>
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <MessageInput
        ref={area}
        value={text}
        onChange={change}
        onSubmit={submit}
        canSubmit={canSend}
        maxLength={MAX_TEXT}
        placeholder={isMobile ? 'Nhập tin nhắn…' : `Nhập tin nhắn… (Enter để gửi, Shift+Enter xuống dòng${canMention ? ', @ để nhắc' : ''})`}
        onPaste={onPaste}
        onKeyDown={(e) => { if (nav.handleKey({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing })) e.preventDefault(); }}
        onSelect={() => { if (area.current) setQuery(queryAtCaret(area.current.value)); }}
        inputTestId="chat-input"
        sendTestId="chat-send"
        leading={<>
          <input ref={input} type="file" multiple className="hidden" data-testid="chat-file-input"
            onChange={(e) => { const list = [...(e.target.files ?? [])]; e.target.value = ''; onAddFiles(list); }} />
          <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label="Đính kèm tệp / ảnh" title={`Đính kèm (tối đa ${MAX_FILES} tệp)`}
            disabled={files.length >= MAX_FILES} onClick={() => input.current?.click()}>
            <Paperclip />
          </Button>
        </>}
        overlay={<>
          <MentionList options={options} active={nav.active} onPick={pick} onHover={nav.setActive} query={live ?? ''} loading={loading} open={live !== null}
            className="absolute bottom-full left-0 mb-1" />
          {text.length > MAX_TEXT * 0.8 && (
            <span className={cn('pointer-events-none absolute right-2 bottom-1 text-[10px]', text.length >= MAX_TEXT ? 'text-destructive' : 'text-muted-foreground')}>
              {text.length}/{MAX_TEXT}
            </span>
          )}
        </>}
      />
    </div>
  );
}
