import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronDown, FileText, Film, Image as ImageIcon, Loader2, Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { Label } from '@/components/common/label';
import { Spinner } from '@/components/feedback/Spinner';
import { cn } from '@/utils/cn';
import { addDays, formatTime, toVnDate, todayVn, vnInstant } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useCreatePost, useEditPost } from '../../hooks/useNews';
import type { IMedia, IPost } from '../../types/news.types';
import { ACCEPT_MEDIA, MAX_MEDIA, MAX_POST_CHARS, checkFile, formatSize } from '../../utils/labels';
import { uploadFile } from '../../utils/upload';
import { AudiencePicker, type IAudienceValue } from '../audience-picker';
import { ScheduleField, type IScheduleValue } from '../schedule-field';
import { SharedPost } from '../shared-post';

// Tiptap + ProseMirror khá nặng → chỉ tải khi mở hộp soạn bài (giữ ngoài gói chính vì sidebar import barrel của feature)
const PostEditor = lazy(() => import('../post-editor').then((m) => ({ default: m.PostEditor })));

interface IPending { key: string; file: File; progress: number; ticketId?: string; preview?: string }

const initialAudience = (post?: IPost): IAudienceValue => ({
  audience: post?.audience ?? 'Company',
  departmentIds: post?.targets.filter((t) => t.kind === 'Department').map((t) => t.id) ?? [],
  people: post?.targets.filter((t) => t.kind === 'User').map((t) => ({ id: t.id, name: t.name })) ?? [],
});

const initialSchedule = (post?: IPost): IScheduleValue => post?.publishAt
  ? { on: true, date: toVnDate(post.publishAt), time: formatTime(post.publishAt) }
  : { on: false, date: addDays(todayVn(), 1), time: '08:00' };

/**
 * Hộp soạn bài: tạo mới, sửa (truyền `post`) hoặc chia sẻ lại (truyền `sharing` = bài gốc). Tệp tải thẳng lên S3 (thư mục feed/) trước khi lưu bài.
 * Hẹn giờ: bài mới, hoặc bài đang hẹn (đổi giờ / bỏ hẹn = đăng ngay).
 */
export function ComposerDialog({ open, onOpenChange, post, sharing }: { open: boolean; onOpenChange: (o: boolean) => void; post?: IPost; sharing?: IPost }) {
  const editing = !!post;
  const shared = sharing ? (sharing.sharedPost ?? sharing) : post?.sharedPostId ? post.sharedPost : undefined;
  const isShare = !!sharing || !!post?.sharedPostId;
  const canSchedule = !editing || !!post?.publishAt;
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
  const [schedule, setSchedule] = useState<IScheduleValue>(() => initialSchedule(post));
  const [optionsOpen, setOptionsOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const phone = usePhone();

  // Mở lại hộp (bài khác / bài mới) → đặt lại toàn bộ
  useEffect(() => {
    if (!open) return;
    setHtml(post?.contentHtml ?? ''); setPlain(post?.plainText ?? ''); setAud(initialAudience(post)); setPending([]); setRemoved([]);
    setSendEmail(false); setCommentsDisabled(post?.commentsDisabled ?? false); setErrors({}); setBusy(false); setSchedule(initialSchedule(post)); setOptionsOpen(false);
  }, [open, post]);

  const existing: IMedia[] = useMemo(() => (post?.media ?? []).filter((m) => !removed.includes(m.id)), [post, removed]);
  const mediaCount = existing.length + pending.length;
  const targetCount = aud.audience === 'Departments' ? aud.departmentIds.length : aud.audience === 'Custom' ? aud.people.length : 0;
  const empty = plain.length === 0 && mediaCount === 0 && !isShare;
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
      const publishAt = canSchedule && schedule.on ? vnInstant(schedule.date, schedule.time) : null;
      if (post) {
        await edit.mutateAsync({ id: post.id, req: {
          contentHtml: html, audience: aud.audience, targets, uploadIds: ids, removeMediaIds: removed, commentsDisabled,
          publishAt, publishNow: !!post.publishAt && !schedule.on,
        } });
      } else {
        await create.mutateAsync({ contentHtml: html, audience: aud.audience, targets, uploadIds: ids, sendEmail: sendEmail && aud.audience !== 'Private', commentsDisabled,
          publishAt, sharedPostId: sharing?.id ?? null });
      }
      toast.success(publishAt ? `Đã hẹn đăng lúc ${schedule.time} ngày ${schedule.date.split('-').reverse().join('/')}` : editing ? 'Đã lưu bài viết' : 'Đã đăng bài');
      pending.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
      onOpenChange(false);
    } catch (e) {
      setErrors(fieldErrors(e));
      toast.error(errorMessage(e));
    } finally { setBusy(false); }
  }

  const submitDisabled = busy || empty || tooLong || (aud.audience === 'Departments' || aud.audience === 'Custom') && targetCount === 0;
  const submitButton = (
    <Button type="button" size={phone ? 'sm' : 'default'} disabled={submitDisabled} onClick={submit} data-testid="submit-post">
      {busy && <Loader2 className="animate-spin" />} {canSchedule && schedule.on ? (editing ? 'Lưu giờ hẹn' : 'Hẹn giờ') : editing ? (post?.publishAt ? 'Đăng ngay' : 'Lưu') : sharing ? 'Chia sẻ' : 'Đăng'}
    </Button>
  );
  const optionCount = (!editing && sendEmail && aud.audience !== 'Private' ? 1 : 0) + (canSchedule && schedule.on ? 1 : 0) + (commentsDisabled ? 1 : 0);
  const showOptions = optionsOpen || !!errors.publishAt;

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      {/* Điện thoại: toàn màn hình, nút Đăng ở header · tablet: hộp một cột 2xl · PC / 2K / 4K: 2 cột, rộng tối đa 64rem (≤ 90vw); chỉ thân hộp cuộn */}
      <DialogContent showCloseButton={false} data-testid="composer-dialog"
        className={cn('flex flex-col gap-0 overflow-hidden p-0',
          'top-0 left-0 h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 rounded-none border-0',
          'sm:top-[50%] sm:left-[50%] sm:h-auto sm:max-h-[92vh] sm:max-w-2xl sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:border',
          'lg:max-w-[min(64rem,90vw)]')}>
        <DialogHeader className="flex shrink-0 flex-row items-center gap-2 border-b px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 sm:px-6 sm:py-4">
          <DialogClose asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Đóng" disabled={busy} className="sm:order-last"><X /></Button>
          </DialogClose>
          <DialogTitle className="min-w-0 flex-1 truncate text-left text-base sm:text-lg">{editing ? 'Sửa bài viết' : sharing ? 'Chia sẻ bài viết' : 'Tạo bài viết'}</DialogTitle>
          <DialogDescription className="sr-only">Soạn nội dung, chọn người xem và đính kèm tệp</DialogDescription>
          {phone && submitButton}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-6">
            {/* Cột trái: nội dung + tệp */}
            <div className="grid min-w-0 grid-cols-1 content-start gap-4">
              <div className="grid grid-cols-1 gap-1.5">
                <Suspense fallback={<div className="flex min-h-40 items-center justify-center rounded-md border"><Spinner /></div>}>
                  <PostEditor value={html} autoFocus onChange={(h, p) => { setHtml(h); setPlain(p); }} />
                </Suspense>
                {errors.contentHtml && <p className="text-xs text-destructive">{errors.contentHtml}</p>}
              </div>
              {isShare && <SharedPost post={shared} />}

              {(existing.length > 0 || pending.length > 0) && (
                <ul className="grid grid-cols-1 gap-1.5 lg:grid-cols-3 lg:gap-2 2xl:grid-cols-4" data-testid="attachment-list">
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
            </div>

            {/* Cột phải (PC) / bên dưới (tablet, điện thoại): người xem, đính kèm, tuỳ chọn */}
            <div className="grid min-w-0 grid-cols-1 content-start gap-4">
              <div>
                <AudiencePicker value={aud} onChange={setAud} error={errors.targets} />
                {aud.audience !== 'Company' && aud.audience !== 'Private' && targetCount === 0 && <p className="mt-2 text-xs text-warning">Chọn ít nhất một {aud.audience === 'Departments' ? 'phòng ban' : 'người'} để đăng.</p>}
              </div>

              <div>
                <input ref={input} type="file" multiple accept={`${ACCEPT_MEDIA},*/*`} className="hidden" onChange={(e) => addFiles(e.target.files)} data-testid="file-input" />
                <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto lg:w-full" disabled={busy || mediaCount >= MAX_MEDIA} onClick={() => input.current?.click()}>
                  <Paperclip /> Ảnh / video / tệp <span className="text-muted-foreground">({mediaCount}/{MAX_MEDIA})</span>
                </Button>
                <p className="mt-1 text-xs text-muted-foreground">Ảnh ≤ 10 MB · video ≤ 200 MB · tệp khác ≤ 25 MB</p>
              </div>

              <div className="rounded-md border">
                {/* Điện thoại: khối tuỳ chọn thu gọn được */}
                <button type="button" className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium sm:hidden" aria-expanded={showOptions}
                  onClick={() => setOptionsOpen((o) => !o)}>
                  <span className="flex-1">Tuỳ chọn{optionCount > 0 && <span className="ms-1 font-normal text-muted-foreground">· đang bật {optionCount}</span>}</span>
                  <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', showOptions && 'rotate-180')} />
                </button>
                <div className={cn('grid gap-2.5 p-3 max-sm:border-t', !showOptions && 'max-sm:hidden')}>
                  {!editing && (
                    <div className="flex items-start gap-2">
                      <Checkbox id="news-email" checked={sendEmail && aud.audience !== 'Private'} disabled={busy || aud.audience === 'Private'} onCheckedChange={(c) => setSendEmail(c === true)} data-testid="send-email" />
                      <Label htmlFor="news-email" className="grid gap-0.5 font-normal">
                        <span className="font-medium">Gửi email thông báo cho người xem</span>
                        <span className="text-xs text-muted-foreground">Chỉ gửi một lần khi đăng. Mỗi người tối đa 3 bài có email mỗi ngày (HR không giới hạn).</span>
                      </Label>
                    </div>
                  )}
                  {canSchedule && <ScheduleField value={schedule} onChange={setSchedule} disabled={busy} error={errors.publishAt} />}
                  {editing && post?.publishAt && !schedule.on && <p className="ps-6 text-xs text-warning">Bỏ hẹn giờ → bài được đăng ngay khi lưu.</p>}
                  <div className="flex items-center gap-2">
                    <Checkbox id="news-nocomment" checked={commentsDisabled} disabled={busy} onCheckedChange={(c) => setCommentsDisabled(c === true)} />
                    <Label htmlFor="news-nocomment" className="font-normal">Tắt bình luận</Label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {!phone && (
          <DialogFooter className="shrink-0 border-t px-6 py-3">
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Huỷ</Button>
            {submitButton}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Màn hình điện thoại (< sm) — nút Đăng chuyển lên header (chỉ render một nút `submit-post`). */
const PHONE_QUERY = '(max-width: 639.98px)';
function subscribePhone(cb: () => void) {
  const mql = window.matchMedia(PHONE_QUERY);
  mql.addEventListener('change', cb);
  return () => mql.removeEventListener('change', cb);
}
const usePhone = () => useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false);

function Row({ name, size, kind, url, progress, onRemove, disabled }: { name: string; size: number; kind: 'Image' | 'Video' | 'File'; url?: string; progress?: number; onRemove: () => void; disabled: boolean }) {
  const Icon = kind === 'Image' ? ImageIcon : kind === 'Video' ? Film : FileText;
  // < lg: một dòng (thumbnail nhỏ + tên) · lg+: ô lưới có thumbnail lớn
  return (
    <li className="relative flex items-center gap-2 rounded-md border bg-muted/30 p-1.5 lg:flex-col lg:items-stretch lg:gap-1.5">
      {url ? <img src={url} alt="" className="size-10 rounded object-cover lg:aspect-[4/3] lg:size-auto lg:w-full" />
        : <span className="flex size-10 items-center justify-center rounded bg-muted lg:aspect-[4/3] lg:size-auto lg:w-full"><Icon className="size-5 text-muted-foreground lg:size-8" /></span>}
      <div className="min-w-0 flex-1 lg:px-0.5">
        <p className="truncate text-sm" title={name}>{name}</p>
        <p className="text-xs text-muted-foreground">{formatSize(size)}</p>
        {progress !== undefined && progress < 1 && <div className="mt-1 h-1 overflow-hidden rounded bg-muted"><div className={cn('h-full bg-primary transition-all')} style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
      </div>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Bỏ ${name}`} disabled={disabled} onClick={onRemove}
        className="lg:absolute lg:top-2.5 lg:right-2.5 lg:bg-background/80 lg:shadow-sm lg:hover:bg-background"><X /></Button>
    </li>
  );
}
