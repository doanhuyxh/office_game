import { Archive, Cog, GitCommit, Mail, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/common/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { confirmDialog } from '@/components/common/confirm-dialog';
import { StatusBadge, type StatusTone } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Spinner } from '@/components/feedback/Spinner';
import { formatDateTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { systemApi, systemKeys } from '../../api/system.api';
import { useOpsReport } from '../../hooks/useSystem';
import type { IBackupStatus, IBuildInfo, IEmailQueue, IJobStatus } from '../../types/system.types';
import { formatBytes } from '../storage-card';

const BACKUP: Record<string, { tone: StatusTone; label: string }> = {
  ok: { tone: 'success', label: 'Bình thường' },
  stale: { tone: 'danger', label: 'Quá hạn' },
  missing: { tone: 'danger', label: 'Chưa có bản nào' },
  unconfigured: { tone: 'warning', label: 'Chưa cấu hình' },
  error: { tone: 'danger', label: 'Lỗi đọc S3' },
};
const JOB: Record<string, { tone: StatusTone; label: string }> = {
  ok: { tone: 'success', label: 'Bình thường' },
  waiting: { tone: 'muted', label: 'Chờ lần chạy đầu' },
  late: { tone: 'warning', label: 'Trễ' },
  failing: { tone: 'danger', label: 'Lỗi' },
};

/** "3 giờ trước" — thời gian tương đối (tiếng Việt) để nhìn nhanh độ "tươi". */
function ago(iso: string | null, now = Date.now()) {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} giây trước`;
  if (s < 3600) return `${Math.round(s / 60)} phút trước`;
  if (s < 86400) return `${Math.round(s / 3600)} giờ trước`;
  return `${Math.round(s / 86400)} ngày trước`;
}

const every = (min: number) => (min < 1 ? `${Math.round(min * 60)} giây` : min < 60 ? `${min} phút` : `${min / 60} giờ`);

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_1fr] gap-2 border-b py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all">{children}</span>
    </div>
  );
}

function Title({ icon: Icon, children, badge }: { icon: typeof Cog; children: ReactNode; badge?: ReactNode }) {
  return <CardTitle className="flex flex-wrap items-center gap-2 text-base"><Icon className="size-4 text-muted-foreground" />{children}{badge}</CardTitle>;
}

/** Phiên bản back-end (image Api / Realtime / MCP dùng chung) + bản web đang mở trong trình duyệt. */
function VersionCard({ b }: { b: IBuildInfo }) {
  const web = import.meta.env.VITE_APP_COMMIT;
  const webCommit = web && web !== 'unknown' ? web : null;
  const mismatch = !!b.commit && !!webCommit && b.commit !== webCommit;
  return (
    <Card data-testid="ops-version">
      <CardHeader>
        <Title icon={GitCommit} badge={mismatch ? <StatusBadge tone="warning">Web và back-end khác bản</StatusBadge> : null}>Phiên bản đang chạy</Title>
        {mismatch && <CardDescription>Trang web đang mở là bản cũ hơn / mới hơn back-end — tải lại trang (Ctrl/⌘ + Shift + R).</CardDescription>}
      </CardHeader>
      <CardContent>
        <Row label="Back-end (commit)">{b.commit ? <code className="rounded bg-muted px-1 text-xs">{b.commit}</code> : <span className="text-muted-foreground">Không rõ (dev / build tay)</span>}</Row>
        <Row label="Build lúc">{b.builtAt ? formatDateTime(b.builtAt) : '—'}</Row>
        <Row label="Api khởi động">{formatDateTime(b.startedAt)} · {ago(b.startedAt)}</Row>
        <Row label="Giao diện web">{webCommit ? <code className="rounded bg-muted px-1 text-xs">{webCommit}</code> : <span className="text-muted-foreground">Không rõ (dev)</span>}
          {import.meta.env.VITE_APP_BUILD_TIME ? ` · build ${formatDateTime(import.meta.env.VITE_APP_BUILD_TIME)}` : ''}</Row>
        <Row label="Môi trường">{b.environment}</Row>
      </CardContent>
    </Card>
  );
}

function BackupCard({ b }: { b: IBackupStatus }) {
  const st = BACKUP[b.status] ?? { tone: 'muted' as const, label: b.status };
  const label = (k: string) => (k === 'db' ? 'Cơ sở dữ liệu (.dump)' : k === 'keys' ? 'Khoá DataProtection' : k);
  return (
    <Card data-testid="ops-backup">
      <CardHeader>
        <Title icon={Archive} badge={<StatusBadge tone={st.tone}>{st.label}</StatusBadge>}>Sao lưu</Title>
        <CardDescription>
          Container <code className="rounded bg-muted px-1 text-xs">backup</code> chạy mỗi 24 giờ → {b.bucket ? <code className="rounded bg-muted px-1 text-xs">s3://{b.bucket}/{b.prefix}</code> : 'S3'}.
          Thời gian giữ bản cũ theo Lifecycle Rule của bucket.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {b.message && <p className="text-sm text-destructive">{b.message}</p>}
        {b.items.map((i) => (
          <Row key={i.kind} label={label(i.kind)}>
            {i.latestAt ? <>Mới nhất {formatDateTime(i.latestAt)} ({ago(i.latestAt)}){i.latestBytes != null ? ` · ${formatBytes(i.latestBytes)}` : ''}</> : 'Chưa có'}
            <span className="text-muted-foreground"> · {i.count} bản, tổng {formatBytes(i.totalBytes)}</span>
          </Row>
        ))}
        <p className="text-xs text-muted-foreground">
          Khôi phục: tải file <code className="rounded bg-muted px-1">.dump</code> về rồi chạy <code className="rounded bg-muted px-1">pg_restore -d &lt;db&gt; --clean file.dump</code> (xem infra/backup/backup.sh).
        </p>
      </CardContent>
    </Card>
  );
}

function EmailCard({ e }: { e: IEmailQueue }) {
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: systemApi.retryEmails,
    onSuccess: (r) => { toast.success(r.count ? `Đã đưa ${r.count} email vào hàng đợi lại` : 'Không có email nào cần gửi lại'); void qc.invalidateQueries({ queryKey: systemKeys.ops }); },
    onError: (x) => toast.error(errorMessage(x)),
  });
  const stuck = e.oldestPendingAt && Date.now() - new Date(e.oldestPendingAt).getTime() > 2 * 3600_000;
  const tone: StatusTone = e.failed > 0 || stuck ? 'danger' : e.retrying > 0 ? 'warning' : 'success';
  return (
    <Card data-testid="ops-email">
      <CardHeader>
        <Title icon={Mail} badge={<StatusBadge tone={tone}>{tone === 'success' ? 'Bình thường' : tone === 'warning' ? 'Đang thử lại' : 'Có lỗi'}</StatusBadge>}>Hàng đợi email</Title>
        <CardDescription>Thư thông báo nằm trong DB, gửi nền mỗi 5 giây; lỗi SMTP thử lại 5 lần (1 → 5 → 15 → 60 phút) rồi bỏ cuộc.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Đang chờ" value={e.pending} hint={e.oldestPendingAt ? `lâu nhất ${ago(e.oldestPendingAt)}` : undefined} />
          <Stat label="Đã gửi 24 giờ" value={e.sent24h} hint={e.lastSentAt ? `gần nhất ${ago(e.lastSentAt)}` : undefined} />
          <Stat label="Bỏ cuộc (30 ngày)" value={e.failed} />
          <Stat label="Bỏ qua (địa chỉ thử)" value={e.skipped30d} />
        </div>
        {e.failed > 0 && (
          <Button size="sm" variant="outline" className="justify-self-start" disabled={retry.isPending}
            onClick={async () => await confirmDialog({ title: `Gửi lại ${e.failed} email đã bỏ cuộc?`, description: 'Chỉ nên gửi lại sau khi đã sửa cấu hình SMTP / địa chỉ nhận.', confirmText: 'Gửi lại' }) && retry.mutate()}>
            <RotateCcw /> Gửi lại email lỗi
          </Button>
        )}
        {e.recentFailures.length > 0 && (
          <div className="rounded-lg border">
            <Table>
              <TableHeader><TableRow><TableHead>Thư</TableHead><TableHead className="hidden md:table-cell">Người nhận</TableHead><TableHead>Lỗi</TableHead></TableRow></TableHeader>
              <TableBody>
                {e.recentFailures.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="max-w-[16rem] text-xs"><div className="truncate font-medium" title={f.title}>{f.title}</div>
                      <div className="text-muted-foreground">{formatDateTime(f.createdAt)} · {f.attempts} lần{f.gaveUp ? ' · bỏ cuộc' : ' · sẽ thử lại'}</div></TableCell>
                    <TableCell className="hidden max-w-[12rem] truncate text-xs md:table-cell">{f.to ?? '—'}</TableCell>
                    <TableCell className="max-w-[20rem] text-xs text-destructive"><div className="line-clamp-2" title={f.error ?? ''}>{f.error ?? '—'}</div></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const Stat = ({ label, value, hint }: { label: string; value: number; hint?: string }) => (
  <div className="rounded-lg border p-3">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="text-xl font-semibold tabular-nums">{value.toLocaleString('vi-VN')}</div>
    {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
  </div>
);

function JobsCard({ jobs }: { jobs: IJobStatus[] }) {
  const bad = jobs.filter((j) => j.status === 'failing' || j.status === 'late').length;
  return (
    <Card data-testid="ops-jobs">
      <CardHeader>
        <Title icon={Cog} badge={<StatusBadge tone={bad ? 'danger' : 'success'}>{bad ? `${bad} việc có vấn đề` : 'Bình thường'}</StatusBadge>}>Job nền (tiến trình Api)</Title>
        <CardDescription>Đếm từ lần Api khởi động gần nhất. "Trễ" = quá 2 chu kỳ chưa chạy xong; chi tiết lỗi xem log (Seq / docker compose logs api).</CardDescription>
      </CardHeader>
      <CardContent className="px-0 sm:px-6">
        <Table>
          <TableHeader><TableRow><TableHead>Việc</TableHead><TableHead>Trạng thái</TableHead><TableHead className="hidden md:table-cell">Chạy xong lần cuối</TableHead><TableHead className="hidden lg:table-cell">Số lần</TableHead></TableRow></TableHeader>
          <TableBody>
            {jobs.map((j) => {
              const st = JOB[j.status] ?? { tone: 'muted' as const, label: j.status };
              return (
                <TableRow key={j.key} data-testid="ops-job-row">
                  <TableCell className="text-sm"><div className="font-medium">{j.name}</div><div className="text-xs text-muted-foreground">mỗi {every(j.intervalMinutes)}</div></TableCell>
                  <TableCell>
                    <StatusBadge tone={st.tone}>{j.running ? 'Đang chạy' : st.label}</StatusBadge>
                    {j.lastError && j.status === 'failing' && <div className="mt-1 max-w-[18rem] text-xs text-destructive line-clamp-2" title={j.lastError}>{j.lastError}</div>}
                  </TableCell>
                  <TableCell className="hidden text-xs md:table-cell">{j.lastFinishedAt ? <>{ago(j.lastFinishedAt)}{j.lastDurationMs != null ? ` · ${j.lastDurationMs} ms` : ''}</> : '—'}</TableCell>
                  <TableCell className="hidden text-xs tabular-nums lg:table-cell">{j.runs}{j.failures ? <span className="text-destructive"> ({j.failures} lỗi)</span> : ''}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** Tab "Vận hành" của trang Hệ thống (chỉ admin): phiên bản, sao lưu, hàng đợi email, job nền. Tự làm mới mỗi phút. */
export function OpsTab({ active }: { active: boolean }) {
  const { data, isLoading, error } = useOpsReport(active);
  if (isLoading) return <Spinner />;
  if (error || !data) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  return (
    <div className="grid gap-4" data-testid="system-ops">
      <div className="grid gap-4 lg:grid-cols-2">
        <BackupCard b={data.backup} />
        <VersionCard b={data.build} />
      </div>
      <EmailCard e={data.email} />
      <JobsCard jobs={data.jobs} />
      <p className="text-xs text-muted-foreground">Cập nhật {formatDateTime(data.generatedAt)} · tự làm mới mỗi phút.</p>
    </div>
  );
}
