import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, X, XCircle } from 'lucide-react';
import { Button } from '@/components/common/button';
import { errorMessage } from '@/utils/errors';
import { documentApi, documentKeys } from '../api/document.api';
import type { ISpaceRef } from '../types/document.types';
import { formatSize } from '../utils/labels';
import { relativeDir, uploadToStorage } from '../utils/upload';

interface Item {
  key: string;
  name: string;
  path: string;
  size: number;
  progress: number;
  state: 'queued' | 'uploading' | 'done' | 'error';
  error?: string;
}

const CONCURRENCY = 3;

/**
 * Hàng đợi tải lên kho: tạo trước các thư mục (giữ cấu trúc khi chọn / kéo cả thư mục), rồi tải 3 file song song:
 * xin vé → PUT thẳng S3 (có % tiến độ) → đăng ký tài liệu (loại mặc định theo nhóm file, sửa sau trong chi tiết).
 */
export function useUploadQueue() {
  const qc = useQueryClient();
  const [items, setItems] = useState<Item[]>([]);
  const running = useRef(false);
  const patch = (key: string, p: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const start = useCallback(async (files: (File & { relPath?: string })[], space: ISpaceRef, folderId: string | null) => {
    if (!files.length) return;
    const batch = files.map((f, i) => ({ file: f, key: `${Date.now()}-${i}-${f.name}`, dir: relativeDir(f) }));
    setItems((list) => [...list.filter((i) => i.state !== 'done'),
      ...batch.map((b) => ({ key: b.key, name: b.file.name, path: b.dir, size: b.file.size, progress: 0, state: 'queued' as const }))]);
    running.current = true;

    // 1) Thư mục: tạo tuần tự (tránh hai request cùng tạo một thư mục)
    const folderOf = new Map<string, string | null>([['', folderId]]);
    for (const dir of [...new Set(batch.map((b) => b.dir))].filter(Boolean).sort()) {
      try {
        folderOf.set(dir, (await documentApi.ensureFolder(space, folderId, dir)).id);
      } catch (err) {
        batch.filter((b) => b.dir === dir).forEach((b) => patch(b.key, { state: 'error', error: errorMessage(err) }));
      }
    }
    qc.invalidateQueries({ queryKey: documentKeys.folders(space) });

    // 2) File: 3 luồng song song
    const queue = batch.filter((b) => folderOf.has(b.dir));
    const worker = async () => {
      for (let b = queue.shift(); b; b = queue.shift()) {
        const job = b;
        patch(job.key, { state: 'uploading' });
        try {
          const ticketId = await uploadToStorage(job.file, (r) => patch(job.key, { progress: r }));
          await documentApi.create({ ticketId, spaceKind: space.kind, spaceId: space.id, folderId: folderOf.get(job.dir) ?? null,
            docTypeId: null, title: null, description: null, tags: [] });
          patch(job.key, { state: 'done', progress: 1 });
        } catch (err) {
          patch(job.key, { state: 'error', error: errorMessage(err) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    running.current = false;
    qc.invalidateQueries({ queryKey: documentKeys.all });
  }, [qc]);

  const clear = () => setItems((list) => list.filter((i) => i.state === 'queued' || i.state === 'uploading'));
  return { items, start, clear };
}

export function UploadPanel({ items, onClear }: { items: Item[]; onClear: () => void }) {
  if (!items.length) return null;
  const done = items.filter((i) => i.state === 'done').length;
  const failed = items.filter((i) => i.state === 'error').length;
  const busy = items.some((i) => i.state === 'queued' || i.state === 'uploading');
  return (
    <div className="rounded-xl border bg-card" data-testid="upload-panel">
      <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
        <span className="font-medium">
          {busy ? 'Đang tải lên' : 'Đã tải lên'} {done}/{items.length} file{failed > 0 && <span className="text-destructive"> · {failed} lỗi</span>}
        </span>
        {!busy && <Button variant="ghost" size="icon-sm" aria-label="Đóng" onClick={onClear}><X /></Button>}
      </div>
      <ul className="max-h-56 divide-y overflow-y-auto">
        {items.map((i) => (
          <li key={i.key} className="grid gap-1 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              {i.state === 'done' ? <CheckCircle2 className="size-4 shrink-0 text-success" />
                : i.state === 'error' ? <XCircle className="size-4 shrink-0 text-destructive" />
                  : <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate">{i.path ? <span className="text-muted-foreground">{i.path}/</span> : null}{i.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {i.state === 'uploading' ? `${Math.round(i.progress * 100)}% · ` : ''}{formatSize(i.size)}
              </span>
            </div>
            {i.state === 'uploading' && (
              <div className="h-1 overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${i.progress * 100}%` }} /></div>
            )}
            {i.error && <p className="text-xs text-destructive">{i.error}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
