import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Film, ImagePlus, Loader2, Save, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import { FormField } from '@/components/common/FormField';
import { Label } from '@/components/common/label';
import { Textarea } from '@/components/common/textarea';
import { ApiError } from '@/services/api-client';
import { addDays, toVnDate, toVnTime, todayVn, vnInstant } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { facebookApi, facebookKeys } from '../../api/facebook.api';
import { useFacebookMutation } from '../../hooks/useFacebook';
import type { IFacebookMedia, IFacebookPage, IFacebookPost, IFacebookPostRequest } from '../../types/facebook.types';
import { FacebookMediaThumb } from '../facebook-media-thumb';

/** Tệp trong khung soạn: tệp mới chọn (`file`) hoặc tệp đã gắn bài khi sửa (`file` null, `media` có sẵn). */
interface Upload { key: string; file: File | null; preview: string | null; media: IFacebookMedia | null; error: string | null }

const MAX_IMAGES = 10;

/**
 * Soạn bài: chọn Fanpage Facebook (nhóm theo BM, ghi chú các nền tảng chưa hỗ trợ), nội dung, link hoặc ảnh / video (tải thẳng lên S3), đăng ngay hoặc hẹn giờ.
 * Có `post` → chế độ sửa bài đã hẹn (TEST-208): điền sẵn trang đang chờ, nội dung, link, ảnh / video (đổi thứ tự được), giờ hẹn; lưu bằng PUT.
 * 409 (bài vừa được gửi đi) → báo lý do, làm mới danh sách và gọi `onDone`.
 */
export function FacebookPostComposer({ pages, post, onDone }: { pages: IFacebookPage[]; post?: IFacebookPost; onDone?: () => void }) {
  const editing = !!post;
  const ids = post ? `sp-edit-${post.id.slice(0, 8)}` : 'sp'; // khung sửa mở cùng trang với khung soạn → id riêng cho nhãn
  const [selected, setSelected] = useState<string[]>(() => post
    ? [...new Set(post.targets.filter((t) => t.status === 'Pending').map((t) => t.pageId))]
    : (pages.length === 1 && pages[0].canPost ? [pages[0].id] : []));
  const [message, setMessage] = useState(post?.message ?? '');
  const [link, setLink] = useState(post?.link ?? '');
  const [uploads, setUploads] = useState<Upload[]>(() => (post?.media ?? []).map((m) => ({ key: m.id, file: null, preview: null, media: m, error: null })));
  const [schedule, setSchedule] = useState(!!post?.scheduledAt);
  const [date, setDate] = useState(post?.scheduledAt ? toVnDate(post.scheduledAt) : todayVn());
  const [time, setTime] = useState(post?.scheduledAt ? toVnTime(post.scheduledAt) : '09:00');
  const fileInput = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const create = useFacebookMutation((b: IFacebookPostRequest) => (post ? facebookApi.update(post.id, b) : facebookApi.create(b)));
  const errors = fieldErrors(create.error);

  // Sửa bài: trang đang chờ mà người sửa không còn thấy (mất quyền) vẫn hiện để bỏ chọn
  const missing: IFacebookPage[] = (post?.targets ?? [])
    .filter((t) => t.status === 'Pending' && !pages.some((p) => p.id === t.pageId))
    .map((t) => ({ id: t.pageId, accountId: '', accountName: 'Không còn quyền đăng', externalId: '', name: t.pageName, category: null, link: null,
      pictureUrl: t.pagePictureUrl, isActive: false, canPost: false, syncedAt: '' }));
  const allPages = [...pages, ...missing];
  const groups = [...new Set(allPages.map((p) => p.accountName))].map((name) => ({ name, pages: allPages.filter((p) => p.accountName === name) }));
  const postable = pages.filter((p) => p.canPost).map((p) => p.id);
  const toggle = (id: string, on: boolean) => setSelected((s) => (on ? [...s, id] : s.filter((x) => x !== id)));
  const uploading = uploads.some((u) => !u.media && !u.error);
  const hasVideo = uploads.some((u) => u.media?.kind === 'Video' || (!!u.file && (u.file.type.startsWith('video/') || /\.(mp4|mov)$/i.test(u.file.name))));

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files];
    const videos = list.filter((f) => f.type.startsWith('video/'));
    if (videos.length > 0 && (list.length > 1 || uploads.length > 0)) { toast.error('Mỗi bài chỉ một video và không kèm ảnh'); return; }
    if (hasVideo) { toast.error('Bài đã có video — bỏ video trước khi thêm ảnh'); return; }
    if (uploads.length + list.length > MAX_IMAGES) { toast.error(`Tối đa ${MAX_IMAGES} ảnh mỗi bài`); return; }
    const added: Upload[] = list.map((file) => ({
      key: `${file.name}-${file.size}-${Math.random()}`, file, media: null, error: null,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    }));
    setUploads((u) => [...u, ...added]);
    await Promise.all(added.map(async (u, i) => {
      try {
        const media = await facebookApi.upload(list[i]);
        setUploads((all) => all.map((x) => (x.key === u.key ? { ...x, media } : x)));
      } catch (e) {
        setUploads((all) => all.map((x) => (x.key === u.key ? { ...x, error: errorMessage(e) } : x)));
      }
    }));
  };
  const move = (key: string, by: -1 | 1) => setUploads((all) => {
    const i = all.findIndex((x) => x.key === key);
    const j = i + by;
    if (i < 0 || j < 0 || j >= all.length) return all;
    const next = [...all];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const remove = (key: string) => setUploads((all) => {
    const u = all.find((x) => x.key === key);
    if (u?.preview) URL.revokeObjectURL(u.preview);
    return all.filter((x) => x.key !== key);
  });
  const reset = () => {
    uploads.forEach((u) => u.preview && URL.revokeObjectURL(u.preview));
    setUploads([]); setMessage(''); setLink(''); setSchedule(false);
  };

  return (
    <form className={editing ? 'grid gap-4' : 'grid gap-4 rounded-xl border bg-card p-4'} data-testid={editing ? 'post-editor' : 'post-composer'} onSubmit={(e) => {
      e.preventDefault();
      if (uploading) { toast.error('Đợi tải ảnh / video xong'); return; }
      const ready = uploads.filter((u) => u.media).map((u) => u.media!.id);
      create.mutate({
        message: message.trim(), link: ready.length ? null : link.trim() || null, pageIds: selected, mediaIds: ready,
        scheduledAt: schedule ? vnInstant(date, time) : null,
      }, {
        onSuccess: (p) => {
          if (editing) {
            const n = p.targets.filter((t) => t.status === 'Pending').length;
            toast.success(p.scheduledAt ? 'Đã lưu thay đổi' : `Đã lưu — đang đăng lên ${n} trang`);
            onDone?.();
            return;
          }
          toast.success(p.scheduledAt ? 'Đã hẹn giờ đăng' : `Đang đăng lên ${p.targets.length} trang`); reset();
        },
        onError: (x) => {
          toast.error(errorMessage(x));
          // Bài vừa được gửi đi / mất quyền → không sửa được nữa: làm mới danh sách và đóng khung sửa
          if (editing && x instanceof ApiError && [403, 404, 409].includes(x.status)) {
            void qc.invalidateQueries({ queryKey: facebookKeys.all });
            onDone?.();
          }
        },
      });
    }}>
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label>Đăng lên Fanpage Facebook *</Label>
          {postable.length > 1 && (
            <button type="button" className="text-xs text-primary hover:underline"
              onClick={() => setSelected(selected.length === postable.length ? [] : postable)}>
              {selected.length === postable.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
            </button>
          )}
        </div>
        <div className="grid max-h-60 gap-3 overflow-y-auto rounded-md border p-2">
          {groups.map((g) => (
            <div key={g.name} className="grid gap-1">
              {groups.length > 1 && <div className="px-1 text-xs font-medium text-muted-foreground">{g.name}</div>}
              {g.pages.map((p) => (
                <label key={p.id} className={`flex items-center gap-2 rounded-md px-1 py-1 text-sm ${p.canPost ? 'cursor-pointer hover:bg-muted/60' : 'opacity-50'}`}>
                  <Checkbox checked={selected.includes(p.id)} disabled={!p.canPost && !selected.includes(p.id)} onCheckedChange={(v) => toggle(p.id, v === true)} />
                  {p.pictureUrl ? <img src={p.pictureUrl} alt="" className="size-6 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />
                    : <div className="size-6 shrink-0 rounded-full bg-muted" />}
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {!p.canPost && <span className="text-xs text-warning">thiếu quyền</span>}
                </label>
              ))}
            </div>
          ))}
        </div>
        {errors.pageIds && <p className="text-xs text-destructive">{errors.pageIds}</p>}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${ids}-message`}>Nội dung</Label>
        <Textarea id={`${ids}-message`} rows={6} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Bạn muốn đăng gì?" aria-invalid={!!errors.message} />
        <div className="flex justify-between text-xs text-muted-foreground">
          {errors.message ? <span className="text-destructive">{errors.message}</span> : <span />}
          <span className="tabular-nums">{message.length.toLocaleString('vi-VN')}</span>
        </div>
      </div>

      <div className="grid gap-2">
        {uploads.length > 0 && (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
            {uploads.map((u, i) => (
              <div key={u.key} className="relative aspect-square overflow-hidden rounded-md border bg-muted" title={u.error ?? fileName(u)} data-testid="composer-media">
                {u.preview ? <img src={u.preview} alt="" className="size-full object-cover" />
                  : !u.file && u.media?.kind === 'Image' ? <FacebookMediaThumb media={u.media} />
                  : <div className="flex size-full flex-col items-center justify-center gap-1 p-1 text-center text-[10px] text-muted-foreground"><Film className="size-5" /><span className="line-clamp-2 break-all">{fileName(u)}</span></div>}
                {!u.media && !u.error && <div className="absolute inset-0 flex items-center justify-center bg-background/60"><Loader2 className="size-5 animate-spin" /></div>}
                {u.error && <div className="absolute inset-0 flex items-center justify-center bg-destructive/70 p-1 text-center text-[10px] text-white">{u.error}</div>}
                <button type="button" onClick={() => remove(u.key)} aria-label="Bỏ tệp"
                  className="absolute top-1 right-1 rounded-full bg-background/80 p-0.5 hover:bg-background"><X className="size-3.5" /></button>
                {uploads.length > 1 && (
                  <div className="absolute bottom-1 left-1 flex gap-0.5">
                    <button type="button" onClick={() => move(u.key, -1)} aria-label="Lên trước" disabled={i === 0}
                      className="rounded-full bg-background/80 p-0.5 hover:bg-background disabled:opacity-40"><ChevronLeft className="size-3.5" /></button>
                    <button type="button" onClick={() => move(u.key, 1)} aria-label="Ra sau" disabled={i === uploads.length - 1}
                      className="rounded-full bg-background/80 p-0.5 hover:bg-background disabled:opacity-40"><ChevronRight className="size-3.5" /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {errors.mediaIds && <p className="text-xs text-destructive">{errors.mediaIds}</p>}
        <input ref={fileInput} type="file" multiple hidden accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime"
          onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
        <div>
          <Button type="button" size="sm" variant="outline" disabled={hasVideo || uploads.length >= MAX_IMAGES} onClick={() => fileInput.current?.click()}>
            <ImagePlus /> Ảnh / video
          </Button>
          <span className="ml-2 text-xs text-muted-foreground">Tối đa {MAX_IMAGES} ảnh (≤ 10 MB) hoặc 1 video MP4 / MOV (≤ 1 GB)</span>
        </div>
      </div>

      {uploads.length === 0 && (
        <FormField id={`${ids}-link`} label="Link (xem trước trên Facebook)" value={link} error={errors.link} placeholder="https://…" onChange={(e) => setLink(e.target.value)} />
      )}

      <div className="grid gap-2">
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={schedule} onCheckedChange={(v) => setSchedule(v === true)} /> Hẹn giờ đăng
        </label>
        {schedule && (
          <div className="grid grid-cols-2 gap-2">
            <FormField id={`${ids}-date`} label="Ngày" type="date" value={date} min={todayVn()} max={addDays(todayVn(), 180)} onChange={(e) => setDate(e.target.value)} />
            <FormField id={`${ids}-time`} label="Giờ" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        )}
        {errors.scheduledAt && <p className="text-xs text-destructive">{errors.scheduledAt}</p>}
      </div>

      <div className="flex justify-end gap-2">
        {editing && <Button type="button" variant="outline" onClick={onDone}>Đóng</Button>}
        <Button type="submit" loading={create.isPending} disabled={uploading || selected.length === 0}>
          {editing ? <><Save /> {schedule ? 'Lưu thay đổi' : 'Lưu và đăng ngay'}</>
            : <><Send /> {schedule ? 'Hẹn giờ đăng' : `Đăng${selected.length > 1 ? ` lên ${selected.length} trang` : ''}`}</>}
        </Button>
      </div>
    </form>
  );
}

const fileName = (u: Upload) => u.file?.name ?? u.media?.fileName ?? '';
