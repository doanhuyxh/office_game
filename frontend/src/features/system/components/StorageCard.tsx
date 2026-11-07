import { Download, HardDrive, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Spinner } from '@/components/feedback/Spinner';
import { formatDate, formatDateTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { useStorageReport } from '../hooks/useSystem';
import type { IStorageReport } from '../types/system.types';

/** 1 234 567 → "1,2 MB" */
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toLocaleString('vi-VN', { maximumFractionDigits: v < 10 ? 2 : 1 })} ${units[i]}`;
}

/** CSV (UTF-8 BOM để Excel đọc đúng tiếng Việt): tổng quan, theo mục, theo lớp lưu trữ, theo tháng, file lớn nhất. */
function downloadCsv(r: IStorageReport) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows: unknown[][] = [
    ['Báo cáo dung lượng S3 — OfficeHub'], ['Thời điểm quét', formatDateTime(r.generatedAt)], ['Bucket', r.buckets.join(', ')], ['Thư mục gốc', r.keyPrefix],
    ['Tổng số file', r.totalObjects], ['Tổng dung lượng (byte)', r.totalBytes], ['Tổng dung lượng', formatBytes(r.totalBytes)],
    ['Chi phí ước tính (USD / tháng, S3 Standard tham khảo)', r.estimatedUsdPerMonth], r.truncated ? ['Lưu ý', 'Chỉ quét 200 000 file đầu'] : [], [],
    ['Mục', 'Bucket', 'Thư mục', 'Số file', 'Dung lượng (byte)', 'Dung lượng', 'Sửa gần nhất'],
    ...r.groups.map((g) => [g.label, g.bucket, g.prefix, g.objects, g.bytes, formatBytes(g.bytes), g.lastModified ? formatDateTime(g.lastModified) : '']),
    [], ['Lớp lưu trữ', 'Số file', 'Dung lượng (byte)', 'Dung lượng'], ...r.byClass.map((c) => [c.label, c.objects, c.bytes, formatBytes(c.bytes)]),
    [], ['Tháng (theo ngày sửa)', 'Số file', 'Dung lượng (byte)', 'Dung lượng'], ...r.monthly.map((m) => [m.key, m.objects, m.bytes, formatBytes(m.bytes)]),
    [], ['File lớn nhất', 'Bucket', 'Dung lượng (byte)', 'Dung lượng', 'Lớp', 'Sửa lúc'],
    ...r.largest.map((o) => [o.key, o.bucket, o.bytes, formatBytes(o.bytes), o.storageClass, o.lastModified ? formatDateTime(o.lastModified) : '']),
  ];
  const csv = '﻿' + rows.map((row) => row.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `bao-cao-s3-${r.generatedAt.slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** Dung lượng S3 đang dùng (chỉ admin): bấm "Quét" mới gọi (liệt kê object có thể mất vài giây). */
export function StorageCard() {
  const r = useStorageReport();
  const data = r.data;
  const max = Math.max(1, ...(data?.groups.map((g) => g.bytes) ?? []));
  const maxMonth = Math.max(1, ...(data?.monthly.map((m) => m.bytes) ?? []));
  return (
    <Card className="lg:col-span-2" data-testid="system-storage">
      <CardHeader className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1.5">
          <CardTitle className="flex items-center gap-2 text-base"><HardDrive className="size-4 text-muted-foreground" />Dung lượng lưu trữ S3</CardTitle>
          <CardDescription>
            {data ? <>Quét lúc {formatDateTime(data.generatedAt)} · bucket {data.buckets.join(', ')} · thư mục <code className="rounded bg-muted px-1 text-xs">{data.keyPrefix || '/'}</code></>
              : 'Liệt kê mọi file của OfficeHub trên S3 (file nghiệp vụ, sao lưu, bản build web) và tổng hợp theo mục.'}
          </CardDescription>
        </div>
        <div className="flex gap-2">
          {!r.started ? <Button size="sm" onClick={r.load}><HardDrive /> Quét dung lượng</Button> : data && (
            <>
              <Button size="sm" variant="outline" disabled={r.rescanning}
                onClick={() => void r.rescan().catch((e) => toast.error(errorMessage(e)))}><RefreshCw className={r.rescanning ? 'animate-spin' : ''} /> Quét lại</Button>
              <Button size="sm" variant="outline" onClick={() => downloadCsv(data)} data-testid="system-storage-csv"><Download /> Tải CSV</Button>
            </>
          )}
        </div>
      </CardHeader>
      {r.started && (
        <CardContent className="grid gap-5">
          {r.isLoading ? <Spinner /> : r.error ? <p className="text-sm text-destructive">{errorMessage(r.error)}</p> : data && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Tổng dung lượng" value={formatBytes(data.totalBytes)} />
                <Stat label="Số file" value={data.totalObjects.toLocaleString('vi-VN')} hint={data.truncated ? 'Chỉ quét 200 000 file đầu' : undefined} />
                <Stat label="Chi phí lưu trữ ước tính" value={`~$${data.estimatedUsdPerMonth.toLocaleString('en-US')}/tháng`} hint="S3 Standard ~$0,025/GB, chưa gồm request / băng thông" />
                <Stat label="Lớp lưu trữ" value={data.byClass.map((c) => c.label).join(', ') || '—'} />
              </div>

              <div className="grid gap-2">
                <h3 className="text-sm font-semibold">Theo mục</h3>
                {data.groups.length === 0 ? <p className="text-sm text-muted-foreground">Chưa có file nào.</p> : (
                  <ul className="grid gap-2 text-sm">
                    {data.groups.map((g) => (
                      <li key={`${g.bucket}/${g.prefix}`} className="grid gap-1">
                        <div className="flex flex-wrap justify-between gap-2">
                          <span>{g.label} <span className="text-xs text-muted-foreground">{g.prefix}/{data.buckets.length > 1 ? ` · ${g.bucket}` : ''}</span></span>
                          <span className="tabular-nums text-muted-foreground">{g.objects.toLocaleString('vi-VN')} file · <b className="text-foreground">{formatBytes(g.bytes)}</b></span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded bg-muted"><div className="h-full rounded bg-primary" style={{ width: `${(g.bytes / max) * 100}%` }} /></div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="grid gap-2">
                <h3 className="text-sm font-semibold">Dung lượng mới theo tháng (ngày ghi file)</h3>
                <div className="grid h-32 grid-cols-12 items-end gap-1.5">
                  {data.monthly.map((m) => (
                    <div key={m.key} className="flex h-full flex-col items-center justify-end gap-1" title={`${m.label}: ${m.objects} file · ${formatBytes(m.bytes)}`}>
                      <span className="text-[10px] text-muted-foreground tabular-nums">{m.bytes ? formatBytes(m.bytes) : ''}</span>
                      <div className="w-full rounded-t bg-primary" style={{ height: `${(m.bytes / maxMonth) * 100}%`, minHeight: m.bytes ? 2 : 0 }} />
                      <span className="text-[10px] text-muted-foreground">{m.label.replace(/\/\d+$/, '')}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-2">
                <h3 className="text-sm font-semibold">15 file lớn nhất</h3>
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader><TableRow><TableHead>File</TableHead><TableHead className="text-right">Dung lượng</TableHead><TableHead className="hidden md:table-cell">Lớp</TableHead><TableHead className="hidden md:table-cell">Sửa lúc</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {data.largest.map((o) => (
                        <TableRow key={`${o.bucket}/${o.key}`}>
                          <TableCell className="max-w-[28rem] truncate font-mono text-xs" title={o.key}>{o.key}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatBytes(o.bytes)}</TableCell>
                          <TableCell className="hidden md:table-cell">{o.storageClass}</TableCell>
                          <TableCell className="hidden md:table-cell">{o.lastModified ? formatDate(o.lastModified) : '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
