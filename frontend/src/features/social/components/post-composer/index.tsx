import { useRef, useState } from 'react';
import { Film, ImagePlus, Loader2, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import { FormField } from '@/components/common/FormField';
import { Label } from '@/components/common/label';
import { Textarea } from '@/components/common/textarea';
import { addDays, todayVn, vnInstant } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { socialApi } from '../../api/social.api';
import { useSocialMutation } from '../../hooks/useSocial';
import type { ISocialMedia, ISocialPage, ISocialPostRequest } from '../../types/social.types';

interface Upload { key: string; file: File; preview: string | null; media: ISocialMedia | null; error: string | null }

const MAX_IMAGES = 10;

/** Soạn bài: chọn trang (nhóm theo BM), nội dung, link hoặc ảnh / video (tải thẳng lên S3), đăng ngay hoặc hẹn giờ. */
export function PostComposer({ pages }: { pages: ISocialPage[] }) {
  const [selected, setSelected] = useState<string[]>(() => (pages.length === 1 && pages[0].canPost ? [pages[0].id] : []));
  const [message, setMessage] = useState('');
  const [link, setLink] = useState('');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [schedule, setSchedule] = useState(false);
  const [date, setDate] = useState(todayVn());
  const [time, setTime] = useState('09:00');
  const fileInput = useRef<HTMLInputElement>(null);
  const create = useSocialMutation((b: ISocialPostRequest) => socialApi.create(b));
  const errors = fieldErrors(create.error);

  const groups = [...new Set(pages.map((p) => p.accountName))].map((name) => ({ name, pages: pages.filter((p) => p.accountName === name) }));
  const postable = pages.filter((p) => p.canPost).map((p) => p.id);
  const toggle = (id: string, on: boolean) => setSelected((s) => (on ? [...s, id] : s.filter((x) => x !== id)));
  const uploading = uploads.some((u) => !u.media && !u.error);
  const hasVideo = uploads.some((u) => u.file.type.startsWith('video/') || /\.(mp4|mov)$/i.test(u.file.name));

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
    await Promise.all(added.map(async (u) => {
      try {
        const media = await socialApi.upload(u.file);
        setUploads((all) => all.map((x) => (x.key === u.key ? { ...x, media } : x)));
      } catch (e) {
        setUploads((all) => all.map((x) => (x.key === u.key ? { ...x, error: errorMessage(e) } : x)));
      }
    }));
  };
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
    <form className="grid gap-4 rounded-xl border bg-card p-4" data-testid="post-composer" onSubmit={(e) => {
      e.preventDefault();
      if (uploading) { toast.error('Đợi tải ảnh / video xong'); return; }
      const ready = uploads.filter((u) => u.media).map((u) => u.media!.id);
      create.mutate({
        message: message.trim(), link: ready.length ? null : link.trim() || null, pageIds: selected, mediaIds: ready,
        scheduledAt: schedule ? vnInstant(date, time) : null,
      }, {
        onSuccess: (p) => { toast.success(p.scheduledAt ? 'Đã hẹn giờ đăng' : `Đang đăng lên ${p.targets.length} trang`); reset(); },
        onError: (x) => toast.error(errorMessage(x)),
      });
    }}>
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label>Đăng lên trang *</Label>
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
                  <Checkbox checked={selected.includes(p.id)} disabled={!p.canPost} onCheckedChange={(v) => toggle(p.id, v === true)} />
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
        <Label htmlFor="sp-message">Nội dung</Label>
        <Textarea id="sp-message" rows={6} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Bạn muốn đăng gì?" aria-invalid={!!errors.message} />
        <div className="flex justify-between text-xs text-muted-foreground">
          {errors.message ? <span className="text-destructive">{errors.message}</span> : <span />}
          <span className="tabular-nums">{message.length.toLocaleString('vi-VN')}</span>
        </div>
      </div>

      <div className="grid gap-2">
        {uploads.length > 0 && (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
            {uploads.map((u) => (
              <div key={u.key} className="relative aspect-square overflow-hidden rounded-md border bg-muted" title={u.error ?? u.file.name}>
                {u.preview ? <img src={u.preview} alt="" className="size-full object-cover" />
                  : <div className="flex size-full flex-col items-center justify-center gap-1 p-1 text-center text-[10px] text-muted-foreground"><Film className="size-5" /><span className="line-clamp-2 break-all">{u.file.name}</span></div>}
                {!u.media && !u.error && <div className="absolute inset-0 flex items-center justify-center bg-background/60"><Loader2 className="size-5 animate-spin" /></div>}
                {u.error && <div className="absolute inset-0 flex items-center justify-center bg-destructive/70 p-1 text-center text-[10px] text-white">{u.error}</div>}
                <button type="button" onClick={() => remove(u.key)} aria-label="Bỏ tệp"
                  className="absolute top-1 right-1 rounded-full bg-background/80 p-0.5 hover:bg-background"><X className="size-3.5" /></button>
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
        <FormField id="sp-link" label="Link (xem trước trên Facebook)" value={link} error={errors.link} placeholder="https://…" onChange={(e) => setLink(e.target.value)} />
      )}

      <div className="grid gap-2">
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={schedule} onCheckedChange={(v) => setSchedule(v === true)} /> Hẹn giờ đăng
        </label>
        {schedule && (
          <div className="grid grid-cols-2 gap-2">
            <FormField id="sp-date" label="Ngày" type="date" value={date} min={todayVn()} max={addDays(todayVn(), 180)} onChange={(e) => setDate(e.target.value)} />
            <FormField id="sp-time" label="Giờ" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        )}
        {errors.scheduledAt && <p className="text-xs text-destructive">{errors.scheduledAt}</p>}
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={create.isPending || uploading || selected.length === 0}>
          <Send /> {schedule ? 'Hẹn giờ đăng' : `Đăng${selected.length > 1 ? ` lên ${selected.length} trang` : ''}`}
        </Button>
      </div>
    </form>
  );
}
