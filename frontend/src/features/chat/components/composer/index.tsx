import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react';
import { File as FileIcon, Paperclip, X } from 'lucide-react';
import { Button } from '@/components/common/button';
import { MessageInput } from '@/components/common/message-input';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/utils/cn';
import { MAX_FILES, MAX_TEXT, formatBytes, isImageFile } from '../../utils/labels';

/** Ô soạn tin: Enter gửi, Shift+Enter xuống dòng, đính kèm bằng nút / dán ảnh (kéo-thả xử lý ở khung chat). */
/** Bản nháp chưa gửi theo hội thoại, giữ qua reload trong tab (sessionStorage; bị chặn thì bỏ qua). */
const readDraft = (key?: string) => { try { return (key && sessionStorage.getItem(key)) || ''; } catch { return ''; } };
const writeDraft = (key: string | undefined, text: string) => {
  if (!key) return;
  try { if (text) sessionStorage.setItem(key, text); else sessionStorage.removeItem(key); } catch { /* bộ nhớ trình duyệt bị chặn */ }
};

export function Composer({ draftKey, files, onAddFiles, onRemoveFile, onSubmit }: {
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
  const canSend = text.trim().length > 0 || files.length > 0;
  const submit = () => {
    if (!canSend) return;
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
        onChange={setText}
        onSubmit={submit}
        canSubmit={canSend}
        maxLength={MAX_TEXT}
        placeholder={isMobile ? 'Nhập tin nhắn…' : 'Nhập tin nhắn… (Enter để gửi, Shift+Enter xuống dòng)'}
        onPaste={onPaste}
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
        overlay={text.length > MAX_TEXT * 0.8 && (
          <span className={cn('pointer-events-none absolute right-2 bottom-1 text-[10px]', text.length >= MAX_TEXT ? 'text-destructive' : 'text-muted-foreground')}>
            {text.length}/{MAX_TEXT}
          </span>
        )}
      />
    </div>
  );
}
