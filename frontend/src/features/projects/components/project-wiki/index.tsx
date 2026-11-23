import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, FilePlus, Search, X } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Input } from '@/components/common/input';
import { Spinner } from '@/components/feedback/Spinner';
import { useDebounce } from '@/hooks/useDebounce';
import { errorMessage } from '@/utils/errors';
import { wikiKeys } from '../../api/wiki.api';
import { useWikiPage, useWikiSearch, useWikiTree } from '../../hooks/useWiki';
import type { IProjectDetail } from '../../types/project.types';
import type { IWikiPage } from '../../types/wiki.types';
import { buildWikiTree, flattenWikiTree, type IWikiNode } from '../../utils/wiki-tree';
import { WikiPageEditor } from '../wiki-page-editor';
import { WikiPageTree } from '../wiki-page-tree';
import { WikiPageView } from '../wiki-page-view';

type Mode = { kind: 'view' } | { kind: 'edit'; id: string } | { kind: 'new'; parentId: string | null };

/**
 * Tab "Sổ tay" của dự án (TEST-217, API TEST-215): trái = ô tìm (debounce) + cây trang + "Trang mới"; phải = trang đang chọn
 * (xem / sửa / tạo). Trang đang mở trên URL `?tab=wiki&page=<id>` (gửi link được); không có → trang gốc đầu tiên.
 * Từ `@4xl/content` 2 cột; hẹp → 1 cột, cây thu gọn phía trên. Nút theo cờ API (`canEdit`, `canManage`) — FE không tự suy quyền.
 */
export function ProjectWiki({ d }: { d: IProjectDetail }) {
  const p = d.project;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const urlPage = (useSearch({ strict: false }) as { page?: string }).page ?? null;
  const tree = useWikiTree(p.id);
  const nodes = useMemo(() => buildWikiTree(tree.data?.pages ?? []), [tree.data]);
  const flat = useMemo(() => flattenWikiTree(nodes), [nodes]);
  const selectedId = urlPage ?? nodes[0]?.page.id ?? null;
  const page = useWikiPage(p.id, selectedId);
  const [mode, setMode] = useState<Mode>({ kind: 'view' });
  const [q, setQ] = useState('');
  const term = useDebounce(q.trim(), 300);
  const search = useWikiSearch(p.id, term);
  const [treeOpen, setTreeOpen] = useState(false);

  // Đổi trang (cây, link, đường dẫn cha) → thoát chế độ sửa / tạo. Chỉ đổi SAU khi URL đã đổi: còn chữ chưa lưu thì editor hỏi trước (useBlocker),
  // bấm "ở lại" → URL không đổi → bản đang soạn còn nguyên.
  useEffect(() => { setMode({ kind: 'view' }); }, [selectedId]);

  const select = (id: string | null) => {
    setTreeOpen(false);
    void navigate({ to: '.', search: ((prev: Record<string, unknown>) => ({ ...prev, tab: 'wiki', page: id ?? undefined })) as never, replace: true });
  };
  const onSaved = (saved: IWikiPage) => {
    qc.setQueryData(wikiKeys.page(p.id, saved.id), saved);
    if (saved.id !== selectedId) select(saved.id);
    else setMode({ kind: 'view' });
  };

  if (tree.isLoading) return <Spinner />;
  if (tree.error || !tree.data) return <p className="text-sm text-destructive">{errorMessage(tree.error, 'Không tải được sổ tay')}</p>;
  const t = tree.data;
  const closedReadOnly = p.status === 'Closed' && !t.canEdit;
  const full = t.pages.length >= t.maxPages;
  const node: IWikiNode | undefined = flat.find((n) => n.page.id === selectedId);
  const siblings = node ? (node.page.parentId ? flat.find((n) => n.page.id === node.page.parentId)?.children ?? [] : nodes) : [];
  const newRoot = () => setMode({ kind: 'new', parentId: null });

  const treePanel = (
    <div className="grid gap-2">
      {term ? (search.isLoading ? <Spinner /> : search.error ? <p className="text-xs text-destructive">{errorMessage(search.error)}</p>
        : (search.data?.length ?? 0) === 0 ? <p className="px-2 text-sm text-muted-foreground">Không có trang nào khớp "{term}".</p>
        : <ul className="grid gap-1" data-testid="wiki-search-results">
            {search.data!.map((h) => (
              <li key={h.id}>
                <button type="button" className="grid w-full gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted" onClick={() => select(h.id)} data-testid="wiki-search-hit">
                  <span className="truncate text-sm font-medium">{h.title}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{h.snippet}</span>
                </button>
              </li>))}
          </ul>)
        : <WikiPageTree nodes={nodes} selectedId={selectedId} onSelect={select} />}
    </div>
  );

  const aside = (
    <aside className="grid content-start gap-3 rounded-lg border p-3 @4xl/content:sticky @4xl/content:top-20 @4xl/content:max-h-[calc(100dvh-6rem)] @4xl/content:overflow-y-auto">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm trong sổ tay…" className="h-8 pr-8 pl-8" aria-label="Tìm trong sổ tay" maxLength={200} data-testid="wiki-search" />
        {q && <button type="button" className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Xoá ô tìm" onClick={() => setQ('')}><X className="size-4" /></button>}
      </div>
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="text-xs font-medium uppercase tracking-wide text-muted-foreground @4xl/content:pointer-events-none" onClick={() => setTreeOpen((v) => !v)}
          aria-expanded={treeOpen} data-testid="wiki-tree-toggle">
          Trang ({t.pages.length})<span className="@4xl/content:hidden"> {treeOpen ? '▴' : '▾'}</span></button>
        {t.canEdit && <Button size="sm" variant="outline" className="h-7" disabled={full} title={full ? `Sổ tay tối đa ${t.maxPages} trang` : undefined} onClick={newRoot} data-testid="wiki-new">
          <FilePlus /> Trang mới</Button>}
      </div>
      <div className={treeOpen || term ? 'block' : 'hidden @4xl/content:block'}>{treePanel}</div>
    </aside>
  );

  const main = mode.kind === 'new'
    ? <WikiPageEditor key={`new-${mode.parentId ?? 'root'}`} projectId={p.id} parentId={mode.parentId} maxContent={t.maxContent}
        parentTitle={mode.parentId ? flat.find((n) => n.page.id === mode.parentId)?.page.title : undefined} onSaved={onSaved} onCancel={() => setMode({ kind: 'view' })} />
    : !selectedId ? null
    : page.isLoading ? <Spinner />
    : page.error || !page.data ? <div className="grid justify-items-start gap-2 rounded-lg border border-dashed p-4">
        <p className="text-sm text-muted-foreground">{errorMessage(page.error, 'Trang không còn hoặc đã bị xoá.')}</p>
        {nodes[0] && <Button size="sm" variant="outline" onClick={() => select(null)}>Về trang đầu</Button>}
      </div>
    : mode.kind === 'edit' && mode.id === page.data.id && page.data.canEdit
      ? <WikiPageEditor key={`edit-${page.data.id}`} projectId={p.id} page={page.data} maxContent={t.maxContent} onSaved={onSaved} onCancel={() => setMode({ kind: 'view' })} />
      : <WikiPageView projectId={p.id} page={page.data} node={node} siblings={siblings} tree={nodes} maxDepth={t.maxDepth} canCreate={!full}
          onEdit={() => setMode({ kind: 'edit', id: page.data!.id })} onNewChild={() => setMode({ kind: 'new', parentId: page.data!.id })}
          onSelect={select} onDeleted={(parentId) => select(parentId)} />;

  return (
    <div className="grid gap-3" data-testid="project-wiki">
      {closedReadOnly && <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground" data-testid="wiki-closed">Dự án đã đóng — chỉ đọc.</p>}
      {t.pages.length === 0 && mode.kind !== 'new'
        ? <div className="grid max-w-2xl justify-items-start gap-3 rounded-lg border border-dashed p-6" data-testid="wiki-empty">
            <BookOpen className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">Sổ tay dự án chưa có trang nào</p>
            <p className="text-sm text-muted-foreground">Sổ tay là nơi ghi kiến thức dùng chung của dự án cho cả người và trợ lý AI: quyết định đã chốt, cách vận hành,
              quy ước, tài liệu kỹ thuật… Mỗi trang viết bằng Markdown, sắp theo cây, có lịch sử phiên bản. Luật làm việc ngắn vẫn ở tab "Hướng dẫn",
              file chính thức vẫn ở kho tài liệu.</p>
            {t.canEdit && <Button size="sm" onClick={newRoot} data-testid="wiki-create-first"><FilePlus /> Tạo trang đầu tiên</Button>}
          </div>
        : <div className="grid max-w-[88rem] items-start gap-4 @4xl/content:grid-cols-[16rem_minmax(0,1fr)] @4xl/content:gap-6 @6xl/content:grid-cols-[18rem_minmax(0,1fr)]">
            {t.pages.length > 0 ? aside : <div className="hidden @4xl/content:block" />}
            <div className="min-w-0">{main}</div>
          </div>}
    </div>
  );
}
