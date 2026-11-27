import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { BrandLogo, BrandName } from '@/features/branding';
import { CheckCircle2, Clock, File as FileIcon, Link2Off, Moon, QrCode, Send, Sun, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Card, CardContent } from '@/components/common/card';
import { Textarea } from '@/components/common/textarea';
import { useTheme } from '@/context/theme-provider';
import { fileProblem, formatBytes, isImageFile, putToS3 } from '@/features/projects';
import { ApiError } from '@/services/api-client';
import { cn } from '@/utils/cn';
import { errorMessage } from '@/utils/errors';
import { uploadLinkApi, uploadLinkKeys } from '../../api/upload-link.api';
import { formatRemaining } from '../../utils/countdown';

const route = getRouteApi('/u/$token');
const MAX_NOTE = 3000;

interface ISent { name: string; size: number; at: string }

/** Khung trang công khai: logo + nút sáng / tối, ngoài layout đăng nhập, mobile-first. */
function Shell({ children }: { children: ReactNode }) {
  const { theme, setTheme } = useTheme();
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return (
    <div className="min-h-svh bg-background">
      <div className="mx-auto grid w-full max-w-lg gap-4 px-4 py-5 sm:py-10">
        <div className="flex items-center gap-2">
          <BrandLogo />
          <BrandName className="flex-1 text-lg font-medium" />
          <Button type="button" variant="ghost" size="icon" aria-label={dark ? 'Giao diện sáng' : 'Giao diện tối'} onClick={() => setTheme(dark ? 'light' : 'dark')}>
            {dark ? <Sun /> : <Moon />}
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Trang công khai `/u/$token` (TEST-175): gửi tệp vào bình luận việc từ thiết bị khác, KHÔNG cần đăng nhập.
 * Chỉ hiện mã việc + hạn còn lại (đếm ngược). Chọn / kéo-thả tệp (kiểm sớm như ô bình luận — `fileProblem`, ≤ 5 tệp / lần) + ghi chú → Gửi:
 * xin vé bằng token → PUT thẳng S3 → đăng một bình luận (đứng tên người tạo link, nhãn "Qua link tải lên"). Gửi nhiều đợt = nhiều bình luận.
 * Hết hạn / thu hồi (API 410) hoặc đếm ngược về 0 → báo "Link đã hết hạn hoặc bị thu hồi". Có QR của chính link để mở tiếp trên máy khác.
 */
export function UploadLinkPage() {
  const { token } = route.useParams();
  const info = useQuery({ queryKey: uploadLinkKeys.info(token), queryFn: () => uploadLinkApi.info(token), retry: false });
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState<ISent[]>([]);
  const [fileCount, setFileCount] = useState<number | null>(null);
  const [gone, setGone] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [showQr, setShowQr] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const previews = useMemo(() => files.map((f) => (isImageFile(f) ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);

  const send = useMutation({
    mutationFn: async ({ list, content }: { list: File[]; content: string }) => {
      const ids: string[] = [];
      for (const file of list) {
        const ticket = await uploadLinkApi.createUpload(token, file);
        await putToS3(ticket, file);
        ids.push(ticket.id);
      }
      return uploadLinkApi.post(token, content, ids);
    },
  });

  const data = info.data;
  const remaining = data ? new Date(data.expiresAt).getTime() - now : 0;
  const expired = gone || (info.error instanceof ApiError && info.error.status === 410) || (!!data && remaining <= 0);
  const used = fileCount ?? data?.fileCount ?? 0;
  const perSend = data?.maxFilesPerComment ?? 5;
  const left = data ? Math.max(0, data.maxFiles - used) : 0;
  const room = Math.min(perSend, left) - files.length;

  const addFiles = (list: File[]) => {
    if (send.isPending || expired) return;
    const ok = list.filter((f) => { const p = fileProblem(f); if (p) toast.error(p); return !p; });
    if (ok.length > room) toast.error(left < perSend ? `Link chỉ còn nhận ${left} tệp` : `Mỗi lần gửi tối đa ${perSend} tệp`);
    if (room > 0 && ok.length) setFiles((x) => [...x, ...ok.slice(0, room)]);
  };
  const submit = () => {
    if (!files.length || send.isPending) return;
    const list = files;
    send.mutate({ list, content: note.trim() }, {
      onSuccess: (r) => {
        const at = new Date().toISOString();
        setSent((x) => [...list.map((f) => ({ name: f.name, size: f.size, at })), ...x]);
        setFileCount(r.fileCount); setFiles([]); setNote('');
        toast.success(`Đã gửi ${list.length} tệp vào ${data?.taskCode}`);
      },
      onError: (err) => {
        if (err instanceof ApiError && (err.status === 410 || err.status === 404)) setGone(true);
        else toast.error(errorMessage(err, 'Không gửi được tệp — thử lại'));
      },
    });
  };

  const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes('Files');
  const dropProps = {
    onDragEnter: (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); dragDepth.current++; setDragging(true); } },
    onDragOver: (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); },
    onDragLeave: () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false); },
    onDrop: (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current = 0; setDragging(false); addFiles([...e.dataTransfer.files]); },
  };

  if (info.isPending) return <Shell><p className="py-10 text-center text-sm text-muted-foreground">Đang mở link…</p></Shell>;
  if (expired || info.isError) {
    const notFound = !expired && info.error instanceof ApiError && info.error.status === 404;
    return (
      <Shell>
        <Card data-testid="upload-link-gone">
          <CardContent className="grid justify-items-center gap-3 py-8 text-center">
            <Link2Off className="size-10 text-muted-foreground" />
            <p className="text-base font-medium">{notFound ? 'Link không tồn tại' : expired ? 'Link đã hết hạn hoặc bị thu hồi' : 'Không mở được link'}</p>
            <p className="text-sm text-muted-foreground">
              {notFound || expired ? 'Nhờ người gửi link tạo link mới trong việc trên OfficeHub.' : errorMessage(info.error, 'Kiểm tra mạng rồi tải lại trang.')}
            </p>
            {sent.length > 0 && <p className="text-sm">Đã gửi {sent.length} tệp trước khi link hết hạn.</p>}
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (!data) return null;
  return (
    <Shell>
      <div {...dropProps} className={cn('relative grid gap-4 rounded-xl', dragging && 'ring-2 ring-primary/60 ring-offset-4 ring-offset-background')} data-testid="upload-link-page">
        {dragging && <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl bg-background/85 text-base font-medium text-primary">Thả tệp để thêm</div>}
        <Card>
          <CardContent className="grid gap-1">
            <p className="text-sm text-muted-foreground">Gửi ảnh / tệp vào bình luận việc</p>
            <p className="text-2xl font-semibold tracking-tight" data-testid="upload-link-task">{data.taskCode}</p>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="upload-link-countdown">
              <Clock className="size-4" /> Link còn <span className="font-mono font-medium text-foreground tabular-nums">{formatRemaining(remaining)}</span>
              <span className="ml-auto">{used}/{data.maxFiles} tệp</span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-3">
            <input ref={picker} type="file" multiple className="hidden" data-testid="upload-link-file-input"
              onChange={(e) => { const list = [...(e.target.files ?? [])]; e.target.value = ''; addFiles(list); }} />
            <button type="button" disabled={send.isPending || room <= 0} onClick={() => picker.current?.click()}
              className="grid justify-items-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50">
              <Upload className="size-7 text-primary" />
              <span className="text-sm font-medium">Chọn ảnh / tệp</span>
              <span className="text-xs text-muted-foreground">hoặc kéo-thả vào trang · tối đa {perSend} tệp mỗi lần · ảnh ≤ 10 MB, tệp ≤ 25 MB</span>
            </button>
            {files.length > 0 && (
              <ul className="flex flex-wrap gap-2" data-testid="upload-link-files">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="relative flex max-w-full items-center gap-2 rounded-md border bg-muted/40 py-1.5 ps-2 pe-7 sm:max-w-56">
                    {previews[i] ? <img src={previews[i]!} alt="" className="size-10 shrink-0 rounded object-cover" /> : <FileIcon className="size-6 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{f.name}</span>
                      <span className="block text-[11px] text-muted-foreground">{formatBytes(f.size)}</span>
                    </span>
                    <button type="button" className="absolute top-1 right-1 rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
                      aria-label={`Bỏ ${f.name}`} disabled={send.isPending} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Textarea aria-label="Ghi chú" placeholder="Ghi chú (tuỳ chọn)" rows={3} maxLength={MAX_NOTE} value={note} onChange={(e) => setNote(e.target.value)}
              disabled={send.isPending} data-testid="upload-link-note" />
            <Button type="button" size="lg" className="w-full" disabled={!files.length} loading={send.isPending} loadingText="Đang gửi…" onClick={submit}
              data-testid="upload-link-send"><Send /> Gửi{files.length ? ` ${files.length} tệp` : ''}</Button>
          </CardContent>
        </Card>

        {sent.length > 0 && (
          <Card>
            <CardContent className="grid gap-2">
              <p className="text-sm font-medium">Đã gửi ({sent.length})</p>
              <ul className="grid gap-1" data-testid="upload-link-sent">
                {sent.map((s, i) => (
                  <li key={`${s.name}-${s.at}-${i}`} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="size-4 shrink-0 text-success" />
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(s.size)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="grid justify-items-center gap-3">
            <Button type="button" variant="ghost" className="w-full" onClick={() => setShowQr((x) => !x)} aria-expanded={showQr}>
              <QrCode /> {showQr ? 'Ẩn mã QR' : 'Mở link này trên thiết bị khác (mã QR)'}
            </Button>
            {showQr && (
              <div className="rounded-lg bg-white p-3" data-testid="upload-link-self-qr">
                <QRCodeSVG value={window.location.href} size={176} marginSize={0} title="Mã QR của link này" />
              </div>
            )}
          </CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground">Tệp gửi lên thành bình luận trong việc, đứng tên người đã tạo link.</p>
      </div>
    </Shell>
  );
}
