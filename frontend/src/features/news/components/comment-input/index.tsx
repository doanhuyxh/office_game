import { useRef, useState } from 'react';
import { ImagePlus, Loader2, SendHorizontal, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Textarea } from '@/components/common/textarea';
import { useDebounce } from '@/hooks/useDebounce';
import { errorMessage } from '@/utils/errors';
import { usePeople } from '../../hooks/useNews';
import { checkFile, mentionToken } from '../../utils/labels';
import { uploadFile } from '../../utils/upload';

interface IMention { id: string; name: string }

/** Ô viết bình luận: chữ thường + 1 ảnh tuỳ chọn + @nhắc (gõ @ rồi chọn). Trong ô hiện "@Tên", khi gửi đổi sang `@[Tên](id)`. */
export function CommentInput({ placeholder = 'Viết bình luận…', initial = '', autoFocus, submitLabel = 'Gửi', allowImage = true, onSubmit, onCancel }: {
  placeholder?: string; initial?: string; autoFocus?: boolean; submitLabel?: string; allowImage?: boolean;
  onSubmit: (text: string | null, uploadId: string | null) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(initial);
  const [mentions, setMentions] = useState<IMention[]>([]);
  const [image, setImage] = useState<{ file: File; preview: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const term = useDebounce(query ?? '', 200);
  const people = usePeople(term, query !== null);
  const list = query !== null ? (people.data ?? []).slice(0, 5) : [];

  function onChange(v: string, caret: number) {
    setText(v);
    const m = /(?:^|\s)@([^\s@]{0,20})$/.exec(v.slice(0, caret));
    setQuery(m ? m[1] : null);
  }

  function pick(p: { userId: string; fullName: string }) {
    const caret = area.current?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@[^\s@]{0,20}$/, `@${p.fullName} `);
    setText(before + text.slice(caret));
    setMentions((m) => (m.some((x) => x.id === p.userId) ? m : [...m, { id: p.userId, name: p.fullName }]));
    setQuery(null);
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(before.length, before.length); });
  }

  function pickImage(f: File | undefined) {
    if (!f) return;
    const problem = checkFile(f, true);
    if (problem) { toast.error(problem); return; }
    if (image) URL.revokeObjectURL(image.preview);
    setImage({ file: f, preview: URL.createObjectURL(f) });
    if (file.current) file.current.value = '';
  }

  async function submit() {
    let out = text.trim();
    for (const m of [...mentions].sort((a, b) => b.name.length - a.name.length)) out = out.split(`@${m.name}`).join(mentionToken(m.name, m.id));
    if (!out && !image) return;
    setBusy(true);
    try {
      const uploadId = image ? await uploadFile(image.file, () => undefined, true) : null;
      await onSubmit(out || null, uploadId);
      setText(''); setMentions([]); setQuery(null);
      if (image) URL.revokeObjectURL(image.preview);
      setImage(null);
    } catch (e) { toast.error(errorMessage(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="relative grid gap-1.5">
      <div className="flex items-end gap-1.5 rounded-2xl border bg-muted/40 px-3 py-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
        <Textarea ref={area} rows={1} value={text} autoFocus={autoFocus} placeholder={placeholder} maxLength={2000} disabled={busy} data-testid="comment-input"
          className="min-h-8 resize-none border-0 bg-transparent px-0 py-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
          onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (query !== null && list.length > 0) pick(list[0]); else void submit();
            } else if (e.key === 'Escape') { if (query !== null) setQuery(null); else onCancel?.(); }
          }} />
        {allowImage && (
          <>
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => pickImage(e.target.files?.[0])} />
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Đính kèm ảnh" disabled={busy} onClick={() => file.current?.click()}><ImagePlus /></Button>
          </>
        )}
        <Button type="button" size="icon-sm" variant="ghost" aria-label={submitLabel} title={submitLabel} disabled={busy || (!text.trim() && !image)} onClick={() => void submit()} data-testid="comment-send">
          {busy ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
        </Button>
      </div>
      {image && (
        <div className="relative w-fit">
          <img src={image.preview} alt="" className="max-h-32 rounded-lg" />
          <Button type="button" variant="secondary" size="icon-xs" className="absolute top-1 right-1 rounded-full" aria-label="Bỏ ảnh" onClick={() => { URL.revokeObjectURL(image.preview); setImage(null); }}><X /></Button>
        </div>
      )}
      {onCancel && <button type="button" className="w-fit text-xs text-muted-foreground hover:underline" onClick={onCancel}>Huỷ</button>}
      {query !== null && list.length > 0 && (
        <ul className="absolute bottom-full left-0 z-20 mb-1 w-72 overflow-hidden rounded-md border bg-popover shadow-md">
          {list.map((p) => (
            <li key={p.userId}>
              <button type="button" className="flex w-full flex-col px-3 py-1.5 text-left text-sm hover:bg-accent" onMouseDown={(e) => { e.preventDefault(); pick(p); }}>
                <span className="font-medium">{p.fullName}</span>
                <span className="text-xs text-muted-foreground">{p.code}{p.departmentName ? ` · ${p.departmentName}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
