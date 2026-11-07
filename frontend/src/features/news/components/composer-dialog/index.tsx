import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Film, Image as ImageIcon, Loader2, Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { Label } from '@/components/common/label';
import { Spinner } from '@/components/feedback/Spinner';
import { cn } from '@/utils/cn';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useCreatePost, useEditPost } from '../../hooks/useNews';
import type { IMedia, IPost } from '../../types/news.types';
import { ACCEPT_MEDIA, MAX_MEDIA, MAX_POST_CHARS, checkFile, formatSize } from '../../utils/labels';
import { uploadFile } from '../../utils/upload';
import { AudiencePicker, type IAudienceValue } from '../audience-picker';

// Tiptap + ProseMirror khá nặng → chỉ tải khi mở hộp soạn bài (giữ ngoài gói chính vì sidebar import barrel của feature)
const PostEditor = lazy(() => import('../post-editor').then((m) => ({ default: m.PostEditor })));

interface IPending { key: string; file: File; progress: number; ticketId?: string; preview?: string }

const initialAudience = (post?: IPost): IAudienceValue => ({
  audience: post?.audience ?? 'Company',
  departmentIds: post?.targets.filter((t) => t.kind === 'Department').map((t) => t.id) ?? [],
  people: post?.targets.filter((t) => t.kind === 'User').map((t) => ({ id: t.id, name: t.name })) ?? [],
});

/** Hộp soạn bài: tạo mới hoặc sửa (truyền `post`). Tệp tải thẳng lên S3 (thư mục feed/) trước khi lưu bài. */
export function ComposerDialog({ open, onOpenChange, post }: { open: boolean; onOpenChange: (o: boolean) => void; post?: IPost }) {
  const editing = !!post;
  const create = useCreatePost();
  const edit = useEditPost();
  const [html, setHtml] = useState(post?.contentHtml ?? '');
  const [plain, setPlain] = useState(post?.plainText ?? '');
  const [aud, setAud] = useState<IAudienceValue>(() => initialAudience(post));
  const [pending, setPending] = useState<IPending[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [sendEmail, setSendEmail] = useState(false);
  const [commentsDisabled, setCommentsDisabled] = useState(post?.commentsDisabled ?? false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const input = useRef<HTMLInputElement>(null);

  // Mở lại hộp (bài khác / bài mới) → đặt lại toàn bộ
  useEffect(() => {
    if (!open) return;
    setHtml(post?.contentHtml ?? ''); setPlain(post?.plainText ?? ''); setAud(initialAudience(post)); setPending([]); setRemoved([]);
    setSendEmail(false); setCommentsDisabled(post?.commentsDisabled ?? false); setErrors({}); setBusy(false);
  }, [open, post]);

  const existing: IMedia[] = useMemo(() => (post?.media ?? []).filter((m) => !removed.includes(m.id)), [post, removed]);
  const mediaCount = existing.length + pending.length;
  const targetCount = aud.audience === 'Departments' ? aud.departmentIds.length : aud.audience === 'Custom' ? aud.people.length : 0;
  const empty = plain.length === 0 && mediaCount === 0;
  const tooLong = plain.length > MAX_POST_CHARS;

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next: IPending[] = [];
    for (const f of Array.from(list)) {
      const problem = checkFile(f);
      if (problem) { toast.error(problem); continue; }
      if (mediaCount + next.length >= MAX_MEDIA) { toast.error(`Mỗi bài đính kèm tối đa ${MAX_MEDIA} tệp`); break; }
      next.push({ key: crypto.randomUUID(), file: f, progress: 0, preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined });
    }
    setPending((p) => [...p, ...next]);
    if (input.current) input.current.value = '';
  }

  const dropPending = (key: string) => setPending((p) => { p.find((x) => x.key === key && x.preview) && URL.revokeObjectURL(p.find((x) => x.key === key)!.preview!); return p.filter((x) => x.key !== key); });

  async function submit() {
    setErrors({}); setBusy(true);
    try {
      // Tải lần lượt; tệp đã có vé (lần thử trước lỗi giữa chừng) thì bỏ qua
      const ids: string[] = [];
      for (const p of pending) {
        let id = p.ticketId;
        if (!id) {
          id = await uploadFile(p.file, (r) => setPending((all) => all.map((x) => (x.key === p.key ? { ...x, progress: r } : x))));
          setPending((all) => all.map((x) => (x.key === p.key ? { ...x, ticketId: id, progress: 1 } : x)));
        }
        ids.push(id);
      }
      const targets = aud.audience === 'Departments' ? aud.departmentIds.map((id) => ({ kind: 'Department' as const, id }))
        : aud.audience === 'Custom' ? aud.people.map((p) => ({ kind: 'User' as const, id: p.id })) : [];
      if (post) await edit.mutateAsync({ id: post.id, req: { contentHtml: html, audience: aud.audience, targets, uploadIds: ids, removeMediaIds: removed, commentsDisabled } });
      else await create.mutateAsync({ contentHtml: html, audience: aud.audience, targets, uploadIds: ids, sendEmail: sendEmail && aud.audience !== 'Private', commentsDisabled });
      toast.success(editing ? 'Đã lưu bài viết' : 'Đã đăng bài');
      pending.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
      onOpenChange(false);
    } catch (e) {
      setErrors(fieldErrors(e));
      toast.error(errorMessage(e));
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto" data-testid="composer-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? 'Sửa bài viết' : 'Tạo bài viết'}</DialogTitle>
          <DialogDescription className="sr-only">Soạn nội dung, chọn người xem và đính kèm tệp</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Suspense fallback={<div className="flex min-h-40 items-center justify-center rounded-md border"><Spinner /></div>}>
              <PostEditor value={html} autoFocus onChange={(h, p) => { setHtml(h); setPlain(p); }} />
            </Suspense>
            {errors.contentHtml && <p className="text-xs text-destructive">{errors.contentHtml}</p>}
          </div>

          {(existing.length > 0 || pending.length > 0) && (
            <ul className="grid gap-1.5" data-testid="attachment-list">
              {existing.map((m) => (
                <Row key={m.id} name={m.fileName} size={m.size} kind={m.kind} url={m.kind === 'Image' ? m.url ?? undefined : undefined} onRemove={() => setRemoved((r) => [...r, m.id])} disabled={busy} />
              ))}
              {pending.map((p) => (
                <Row key={p.key} name={p.file.name} size={p.file.size} kind={p.file.type.startsWith('image/') ? 'Image' : p.file.type.startsWith('video/') ? 'Video' : 'File'}
                  url={p.preview} progress={busy ? p.progress : undefined} onRemove={() => dropPending(p.key)} disabled={busy} />
              ))}
            </ul>
          )}
          {errors.uploadIds && <p className="text-xs text-destructive">{errors.uploadIds}</p>}
          <div>
            <input ref={input} type="file" multiple accept={`${ACCEPT_MEDIA},*/*`} className="hidden" onChange={(e) => addFiles(e.target.files)} data-testid="file-input" />
            <Button type="button" variant="outline" size="sm" disabled={busy || mediaCount >= MAX_MEDIA} onClick={() => input.current?.click()}>
              <Paperclip /> Ảnh / video / tệp <span className="text-muted-foreground">({mediaCount}/{MAX_MEDIA})</span>
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">Ảnh ≤ 10 MB · video ≤ 200 MB · tệp khác ≤ 25 MB</p>
          </div>

          <AudiencePicker value={aud} onChange={setAud} error={errors.targets} />
          {aud.audience !== 'Company' && aud.audience !== 'Private' && targetCount === 0 && <p className="-mt-2 text-xs text-warning">Chọn ít nhất một {aud.audience === 'Departments' ? 'phòng ban' : 'người'} để đăng.</p>}

          <div className="grid gap-2.5 rounded-md border p-3">
            {!editing && (
              <div className="flex items-start gap-2">
                <Checkbox id="news-email" checked={sendEmail && aud.audience !== 'Private'} disabled={busy || aud.audience === 'Private'} onCheckedChange={(c) => setSendEmail(c === true)} data-testid="send-email" />
                <Label htmlFor="news-email" className="grid gap-0.5 font-normal">
                  <span className="font-medium">Gửi email thông báo cho người xem</span>
                  <span className="text-xs text-muted-foreground">Chỉ gửi một lần khi đăng. Mỗi người tối đa 3 bài có email mỗi ngày (HR không giới hạn).</span>
                </Label>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Checkbox id="news-nocomment" checked={commentsDisabled} disabled={busy} onCheckedChange={(c) => setCommentsDisabled(c === true)} />
              <Label htmlFor="news-nocomment" className="font-normal">Tắt bình luận</Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Huỷ</Button>
          <Button type="button" disabled={busy || empty || tooLong || (aud.audience === 'Departments' || aud.audience === 'Custom') && targetCount === 0} onClick={submit} data-testid="submit-post">
            {busy && <Loader2 className="animate-spin" />} {editing ? 'Lưu' : 'Đăng'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ name, size, kind, url, progress, onRemove, disabled }: { name: string; size: number; kind: 'Image' | 'Video' | 'File'; url?: string; progress?: number; onRemove: () => void; disabled: boolean }) {
  const Icon = kind === 'Image' ? ImageIcon : kind === 'Video' ? Film : FileText;
  return (
    <li className="flex items-center gap-2 rounded-md border bg-muted/30 p-1.5">
      {url ? <img src={url} alt="" className="size-10 rounded object-cover" /> : <span className="flex size-10 items-center justify-center rounded bg-muted"><Icon className="size-5 text-muted-foreground" /></span>}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{name}</p>
        <p className="text-xs text-muted-foreground">{formatSize(size)}</p>
        {progress !== undefined && progress < 1 && <div className="mt-1 h-1 overflow-hidden rounded bg-muted"><div className={cn('h-full bg-primary transition-all')} style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
      </div>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Bỏ ${name}`} disabled={disabled} onClick={onRemove}><X /></Button>
    </li>
  );
}
