import { useState } from 'react';
import { ArrowDown, ArrowUp, FilePlus, FolderInput, History, Lock, LockOpen, MoreHorizontal, Pencil, PencilLine, Share2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { BotBadge } from '@/components/common/bot-badge';
import { Button } from '@/components/common/button';
import { confirmDialog, promptDialog } from '@/components/common/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/common/dropdown-menu';
import { Markdown } from '@/components/common/markdown';
import { formatDateTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { wikiApi } from '../../api/wiki.api';
import { useWikiMutation } from '../../hooks/useWiki';
import type { IWikiPage } from '../../types/wiki.types';
import type { IWikiNode } from '../../utils/wiki-tree';
import { WikiHistorySheet } from '../wiki-history-sheet';
import { WikiMoveDialog } from '../wiki-move-dialog';
import { WikiShareDialog } from '../wiki-share-dialog';

/** Tiền tố id tiêu đề trong trang sổ tay (mục lục ở `ProjectWiki` cuộn tới). */
export const WIKI_HEADING_PREFIX = 'wiki';

/**
 * Xem một trang sổ tay (TEST-217): đường dẫn trang cha, tiêu đề, tóm tắt, "Sửa lần cuối bởi … lúc …" (BOT), nhãn "Đã khoá bởi …",
 * nội dung Markdown (mục lục tiêu đề `##` do `ProjectWiki` dựng ở cột trái / phải). Nút / menu theo cờ API: Sửa (canEdit), Trang con (canEdit + chưa đủ cấp),
 * Lịch sử (mọi người xem), Chia sẻ link công khai cho khách (canManage — TEST-229), ⋯ Đổi tên / Chuyển trang cha / Lên / Xuống (canEdit), Khoá / Mở khoá / Xoá (canManage).
 */
export function WikiPageView({ projectId, page, node, siblings, tree, maxDepth, canCreate, onEdit, onNewChild, onSelect, onDeleted }: {
  projectId: string; page: IWikiPage;
  /** Nút của trang trong cây (độ sâu, con) — chưa có trong cây (vừa tạo, cây đang tải) → undefined. */
  node?: IWikiNode; siblings: IWikiNode[]; tree: IWikiNode[]; maxDepth: number; canCreate: boolean;
  onEdit: () => void; onNewChild: () => void; onSelect: (id: string) => void; onDeleted: (parentId: string | null) => void;
}) {
  const [history, setHistory] = useState(false);
  const [moving, setMoving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const idx = siblings.findIndex((s) => s.page.id === page.id);
  const canChild = page.canEdit && canCreate && !!node && node.depth < maxDepth;

  const rename = useWikiMutation(projectId, (title: string) => wikiApi.update(projectId, page.id, { baseVersion: page.version, title, note: 'Đổi tên' }));
  const reorder = useWikiMutation(projectId, (position: number) => wikiApi.move(projectId, page.id, page.parentId, position));
  const lock = useWikiMutation(projectId, (locked: boolean) => wikiApi.lock(projectId, page.id, locked));
  const remove = useWikiMutation(projectId, () => wikiApi.remove(projectId, page.id));

  const doRename = async () => {
    const t = await promptDialog({ title: 'Đổi tên trang', label: 'Tiêu đề', initial: page.title, required: true, confirmText: 'Lưu',
      onConfirm: (v) => (v === page.title ? undefined : rename.mutateAsync(v)) });
    if (t && t !== page.title) toast.success('Đã đổi tên');
  };
  const doLock = (locked: boolean) => lock.mutate(locked, {
    onSuccess: () => toast.success(locked ? 'Đã khoá trang — chỉ quản lý dự án sửa được' : 'Đã mở khoá trang'),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const doReorder = (position: number) => reorder.mutate(position, { onError: (err) => toast.error(errorMessage(err)) });
  const doDelete = async () => {
    const ok = await confirmDialog({
      title: `Xoá trang "${page.title}"?`,
      description: 'Trang biến mất khỏi sổ tay của mọi người (kể cả trợ lý AI). Trang còn trang con thì phải xoá / chuyển trang con trước.',
      confirmText: 'Xoá', destructive: true, onConfirm: () => remove.mutateAsync(undefined),
    });
    if (ok) { toast.success('Đã xoá trang'); onDeleted(page.parentId); }
  };

  const hasMenu = page.canEdit || page.canManage;
  return (
    <article className="grid min-w-0 gap-4" data-testid="wiki-page">
      <header className="grid gap-2">
        {page.path.length > 0 && <nav aria-label="Trang cha" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {page.path.map((c) => <span key={c.id} className="flex items-center gap-1">
            <button type="button" className="hover:text-foreground hover:underline" onClick={() => onSelect(c.id)}>{c.title}</button> /</span>)}
        </nav>}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="min-w-0 text-xl font-semibold wrap-anywhere" data-testid="wiki-page-title">{page.title}</h2>
          <div className="flex max-w-full flex-wrap items-center gap-2">
            {page.canEdit && <Button size="sm" onClick={onEdit} data-testid="wiki-edit"><Pencil /> Sửa</Button>}
            {canChild && <Button size="sm" variant="outline" onClick={onNewChild} data-testid="wiki-new-child"><FilePlus /> Trang con</Button>}
            <Button size="sm" variant="outline" onClick={() => setHistory(true)} data-testid="wiki-history-open"><History /> Lịch sử</Button>
            {page.canManage && <Button size="sm" variant="outline" onClick={() => setSharing(true)} data-testid="wiki-share-open"><Share2 /> Chia sẻ</Button>}
            {hasMenu && <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label="Thao tác khác" data-testid="wiki-menu"><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {page.canEdit && <>
                  <DropdownMenuItem onSelect={() => void doRename()}><PencilLine /> Đổi tên</DropdownMenuItem>
                  {node && <DropdownMenuItem onSelect={() => setMoving(true)}><FolderInput /> Chuyển trang cha</DropdownMenuItem>}
                  <DropdownMenuItem disabled={idx <= 0 || reorder.isPending} onSelect={() => doReorder(idx - 1)}><ArrowUp /> Lên trên</DropdownMenuItem>
                  <DropdownMenuItem disabled={idx < 0 || idx >= siblings.length - 1 || reorder.isPending} onSelect={() => doReorder(idx + 1)}><ArrowDown /> Xuống dưới</DropdownMenuItem>
                </>}
                {page.canManage && <>
                  {page.canEdit && <DropdownMenuSeparator />}
                  {page.locked
                    ? <DropdownMenuItem onSelect={() => doLock(false)} data-testid="wiki-unlock"><LockOpen /> Mở khoá</DropdownMenuItem>
                    : <DropdownMenuItem onSelect={() => doLock(true)} data-testid="wiki-lock"><Lock /> Khoá trang</DropdownMenuItem>}
                  <DropdownMenuItem variant="destructive" onSelect={() => void doDelete()} data-testid="wiki-delete"><Trash2 /> Xoá trang</DropdownMenuItem>
                </>}
              </DropdownMenuContent>
            </DropdownMenu>}
          </div>
        </div>
        {page.summary && <p className="text-sm text-muted-foreground" data-testid="wiki-page-summary">{page.summary}</p>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span data-testid="wiki-page-updated">Sửa lần cuối bởi {page.updatedByName}{page.updatedByBot && <BotBadge className="ml-1" />} lúc {formatDateTime(page.updatedAt)} · phiên bản {page.version}</span>
          {page.locked && <span className="inline-flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-warning" data-testid="wiki-locked">
            <Lock className="size-3" /> Đã khoá{page.lockedByName && ` bởi ${page.lockedByName}`}{page.lockedAt && ` lúc ${formatDateTime(page.lockedAt)}`}</span>}
        </div>
      </header>
      <div className="min-w-0 rounded-lg border p-4 wrap-anywhere @4xl/content:p-6" data-testid="wiki-page-content">
        {page.content.trim() ? <Markdown text={page.content} headingIds={WIKI_HEADING_PREFIX} /> : <p className="text-sm text-muted-foreground">Trang chưa có nội dung.{page.canEdit && ' Bấm "Sửa" để viết.'}</p>}
      </div>
      <WikiHistorySheet projectId={projectId} page={page} open={history} onClose={() => setHistory(false)} />
      {page.canManage && <WikiShareDialog projectId={projectId} pageId={page.id} pageTitle={page.title} hasChildren={(node?.children.length ?? 0) > 0}
        open={sharing} onClose={() => setSharing(false)} />}
      {node && moving && <WikiMoveDialog projectId={projectId} node={node} tree={tree} maxDepth={maxDepth} open={moving} onClose={() => setMoving(false)} />}
    </article>
  );
}
