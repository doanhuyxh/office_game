import { useRef, useState } from 'react';
import { ImagePlus, Loader2, SendHorizontal, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { MentionList, type IMentionOption } from '@/components/common/mention-list';
import { Textarea } from '@/components/common/textarea';
import { useDebounce } from '@/hooks/useDebounce';
import { useMentionNav } from '@/hooks/useMentionNav';
import { errorMessage } from '@/utils/errors';
import { mentionHint, nextMentionQuery, replaceMentionQuery } from '@/utils/mention';
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
  const loading = query !== null && (term !== query || people.isFetching);
  const found: IMentionOption[] = query !== null
    ? (people.data ?? []).map((p) => ({ key: p.userId, name: p.fullName, hint: mentionHint(p.code, p.departmentName, p.title), avatarUrl: p.avatarUrl, isBot: p.isBot }))
    : [];
  // Đã gõ họ tên có dấu cách mà không còn ai khớp → coi như đóng gợi ý (gõ câu bình thường tiếp)
  const live = query !== null && query.includes(' ') && !loading && found.length === 0 ? null : query;
  const list = live === null ? [] : found;
  const nav = useMentionNav(list, pick, () => setQuery(null));

  function onChange(v: string, caret: number) {
    setText(v);
    setQuery(nextMentionQuery(v.slice(0, caret), live));
    nav.setActive(0);
  }

  function pick(p: IMentionOption) {
    const next = replaceMentionQuery(text, area.current?.selectionStart ?? text.length, live ?? '', `@${p.name}`);
    setText(next.text);
    setMentions((m) => (m.some((x) => x.id === p.key) ? m : [...m, { id: p.key, name: p.name }]));
    setQuery(null);
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(next.caret, next.caret); });
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
    <div className="relative grid gap-1.5" data-mention-open={live !== null || undefined}>
      <div className="flex items-end gap-1.5 rounded-2xl border bg-muted/40 px-3 py-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
        <Textarea ref={area} rows={1} value={text} autoFocus={autoFocus} placeholder={placeholder} maxLength={2000} disabled={busy} data-testid="comment-input"
          className="min-h-8 resize-none border-0 bg-transparent px-0 py-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
          onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
          onKeyDown={(e) => {
            if (nav.handleKey({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing })) { e.preventDefault(); return; }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); }
            else if (e.key === 'Escape') { if (live !== null) setQuery(null); else onCancel?.(); }
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
      <MentionList options={list} active={nav.active} onPick={pick} onHover={nav.setActive} query={live ?? ''} loading={loading} open={live !== null}
        className="absolute bottom-full left-0 mb-1" />
    </div>
  );
}
