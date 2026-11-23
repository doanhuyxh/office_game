import { useEffect, useRef, useState } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { BotBadge } from '@/components/common/bot-badge';
import { Button } from '@/components/common/button';
import { confirmDialog } from '@/components/common/confirm-dialog';
import { FormField } from '@/components/common/FormField';
import { Markdown } from '@/components/common/markdown';
import { ApiError } from '@/services/api-client';
import { formatDateTime } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { wikiApi, wikiKeys } from '../../api/wiki.api';
import { useWikiMutation } from '../../hooks/useWiki';
import type { IWikiConflict, IWikiPage } from '../../types/wiki.types';
import { MarkdownEditor } from '../markdown-editor';

const LEAVE = { title: 'Bỏ nội dung chưa lưu?', description: 'Trang đang soạn có thay đổi chưa lưu — rời đi sẽ mất phần này.', confirmText: 'Bỏ thay đổi', destructive: true };

/** 409 sửa đồng thời (có `version` trong ProblemDetails) → thông tin bản mới nhất; 409 khác (dự án đóng…) → null. */
function conflictOf(err: unknown): IWikiConflict | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const p = err.problem as Record<string, unknown>;
  return typeof p.version === 'number' ? { version: p.version, updatedByName: String(p.updatedByName ?? ''), updatedAt: String(p.updatedAt ?? ''), updatedByBot: p.updatedByBot === true } : null;
}

/**
 * Soạn / sửa một trang sổ tay (TEST-217): tiêu đề, tóm tắt, nội dung Markdown (Viết / Xem trước), ghi chú thay đổi.
 * Sửa gửi `baseVersion`; người khác đã lưu trước → 409: báo ai vừa sửa, GIỮ NGUYÊN bản đang soạn, cho xem bản mới nhất để tự gộp —
 * chỉ khi người dùng bấm "Lấy bản N làm gốc" thì lần Lưu sau mới ghi lên bản N (không tự ghi đè).
 * Còn thay đổi chưa lưu mà rời trang / đổi trang / đổi tab / đóng tab trình duyệt → hỏi xác nhận (`useBlocker`).
 */
export function WikiPageEditor({ projectId, page, parentId, parentTitle, maxContent, onSaved, onCancel }: {
  projectId: string;
  /** Trang đang sửa; không có = tạo trang mới dưới `parentId`. */
  page?: IWikiPage;
  parentId?: string | null;
  parentTitle?: string;
  maxContent: number;
  onSaved: (p: IWikiPage) => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(page?.title ?? '');
  const [summary, setSummary] = useState(page?.summary ?? '');
  const [content, setContent] = useState(page?.content ?? '');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(false);
  const [baseVersion, setBaseVersion] = useState(page?.version ?? 0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<IWikiConflict | null>(null);
  const [latest, setLatest] = useState<IWikiPage | null>(null);
  const [latestLoading, setLatestLoading] = useState(false);
  const [latestRaw, setLatestRaw] = useState(false);

  const dirty = title !== (page?.title ?? '') || summary !== (page?.summary ?? '') || content !== (page?.content ?? '') || note.trim() !== '';
  // Ref: shouldBlockFn đọc giá trị mới nhất; `doneRef` — đã lưu / đã huỷ → không chặn nữa (cha đổi URL ngay sau đó)
  const dirtyRef = useRef(dirty);
  const doneRef = useRef(false);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  const blocking = () => dirtyRef.current && !doneRef.current;
  useBlocker({
    shouldBlockFn: async () => (blocking() ? !(await confirmDialog(LEAVE)) : false),
    enableBeforeUnload: blocking,
  });

  const save = useWikiMutation(projectId, () => {
    const t = title.trim();
    const n = note.trim() || null;
    if (!page) return wikiApi.create(projectId, { title: t, summary: summary.trim() || null, content, parentId: parentId ?? null, note: n });
    return wikiApi.update(projectId, page.id, {
      baseVersion,
      title: t === page.title ? null : t,
      summary: summary.trim() === (page.summary ?? '') ? null : summary.trim(),
      content: content === page.content ? null : content,
      note: n,
    });
  });

  const submit = () => {
    setErrors({});
    save.mutate(undefined, {
      onSuccess: (p) => {
        doneRef.current = true;
        toast.success(page ? 'Đã lưu trang' : 'Đã tạo trang');
        onSaved(p);
      },
      onError: (err) => {
        const c = conflictOf(err);
        if (c) { setConflict(c); setLatest(null); return; }
        const fe = fieldErrors(err);
        if (Object.keys(fe).length) setErrors(fe);
        else toast.error(errorMessage(err));
      },
    });
  };

  const showLatest = async () => {
    if (!page) return;
    setLatestLoading(true);
    try {
      setLatest(await qc.fetchQuery({ queryKey: wikiKeys.page(projectId, page.id), queryFn: () => wikiApi.page(projectId, page.id), staleTime: 0 }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLatestLoading(false);
    }
  };

  const cancel = async () => {
    if (dirty && !(await confirmDialog(LEAVE))) return;
    doneRef.current = true;
    onCancel();
  };

  return (
    <form className="grid min-w-0 gap-4" data-testid="wiki-editor" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {!page && parentTitle && <p className="text-xs text-muted-foreground">Trang con của <b>{parentTitle}</b></p>}
      {conflict && <div role="alert" className="grid gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm" data-testid="wiki-conflict">
        <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <span><b>{conflict.updatedByName}</b>{conflict.updatedByBot && <BotBadge className="ml-1" />} vừa sửa trang này (phiên bản {conflict.version}
            {conflict.updatedAt && `, lúc ${formatDateTime(conflict.updatedAt)}`}). Bản bạn đang soạn <b>chưa được lưu</b> và vẫn còn nguyên bên dưới —
            xem bản mới nhất, gộp phần thay đổi vào bản của bạn rồi lấy bản mới nhất làm gốc để lưu.</span></p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" loading={latestLoading} loadingText="Đang tải…" onClick={() => void showLatest()} data-testid="wiki-conflict-show">
            {latest ? 'Tải lại bản mới nhất' : 'Xem bản mới nhất'}</Button>
          {latest && <Button type="button" size="sm" onClick={() => { setBaseVersion(latest.version); setConflict(null); setLatest(null); }} data-testid="wiki-conflict-rebase">
            Đã gộp — lấy bản {latest.version} làm gốc</Button>}
        </div>
        {latest && <div className="grid gap-2 rounded-md border bg-background p-3" data-testid="wiki-conflict-latest">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Bản mới nhất (phiên bản {latest.version}) · {latest.title}</span>
            <button type="button" className="underline" onClick={() => setLatestRaw((v) => !v)}>{latestRaw ? 'Xem dạng hiển thị' : 'Xem Markdown gốc'}</button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {latestRaw ? <pre className="font-mono text-xs whitespace-pre-wrap wrap-anywhere">{latest.content}</pre> : <Markdown text={latest.content || '_(trống)_'} />}
          </div>
        </div>}
      </div>}
      <FormField id="wiki-title" label="Tiêu đề" value={title} maxLength={200} required onChange={(e) => setTitle(e.target.value)} error={errors.title} autoFocus={!page} />
      <FormField id="wiki-summary" label="Tóm tắt (một dòng, tuỳ chọn)" value={summary} maxLength={300} onChange={(e) => setSummary(e.target.value)} error={errors.summary}
        placeholder="Trang này nói về gì — hiện ở đầu trang và trong kết quả tìm" />
      <MarkdownEditor id="wiki-content" label={<span>Nội dung <span className="font-normal text-muted-foreground">({content.length.toLocaleString('vi-VN')}/{maxContent.toLocaleString('vi-VN')} ký tự)</span></span>}
        value={content} onChange={setContent} preview={preview} onPreviewChange={setPreview} rows={18} maxLength={maxContent} minHeightClass="min-h-80"
        error={errors.content} placeholder="Viết bằng Markdown: ## Tiêu đề mục, - danh sách, **đậm**, `code`, bảng…" />
      <FormField id="wiki-note" label="Ghi chú thay đổi (tuỳ chọn)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} error={errors.note}
        placeholder="vd Thêm mục quy trình deploy" />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={() => void cancel()}><X /> Huỷ</Button>
        <Button type="submit" className="min-w-24" disabled={!title.trim() || !!conflict} loading={save.isPending} loadingText={page ? 'Đang lưu…' : 'Đang tạo…'} data-testid="wiki-save">
          <Save /> {page ? 'Lưu' : 'Tạo trang'}</Button>
      </div>
    </form>
  );
}
