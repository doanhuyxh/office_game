import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Folder, FolderPlus, FolderUp, MoreHorizontal, Search, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/common/dropdown-menu';
import { Input } from '@/components/common/input';
import { SelectField } from '@/components/common/SelectField';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { Spinner } from '@/components/feedback/Spinner';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/utils/cn';
import { documentApi } from '../../api/document.api';
import { useAssets, useDocMutation, useFolders, useSpaces } from '../../hooks/useDocuments';
import type { AssetKind, AssetStatus, IAssetRow, IFolder, ISpace, ISpaceRef } from '../../types/document.types';
import { findSpace, KIND, parseSpaceKey, SPACE_KIND, spaceKey, STATUS } from '../../utils/labels';
import { filesFromDrop } from '../../utils/upload';
import { AssetTable } from '../asset-table';
import { FolderTree } from '../folder-tree';
import { PromptDialog, type PromptSpec } from '../prompt-dialog';
import { UploadPanel, useUploadQueue } from '../upload-queue';

const spaceLabel = (s: ISpace) => (s.kind === 'Company' ? 'Kho chung công ty' : `${SPACE_KIND[s.kind]} · ${s.name}${s.closed ? ' (đã đóng)' : ''}`);

/** Kho tài liệu: chọn kho → cây thư mục → tài liệu trong thư mục (hoặc tìm cả kho / mọi kho), tải file / cả thư mục, kéo thả. */
export function LibraryTab({ initialSpace, onOpen }: { initialSpace: ISpaceRef | null; onOpen: (id: string) => void }) {
  const spaces = useSpaces();
  const [space, setSpace] = useState<ISpaceRef | null>(initialSpace);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [allSpaces, setAllSpaces] = useState(false);
  const [kind, setKind] = useState<AssetKind | null>(null);
  const [status, setStatus] = useState<AssetStatus | null>(null);
  const [prompt, setPrompt] = useState<PromptSpec | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);
  const uploads = useUploadQueue();
  const debounced = useDebounce(search, 300);

  // Kho mặc định: kho trong URL nếu còn quyền, không thì phòng ban của mình (kho phòng ban đầu tiên), không thì kho công ty
  useEffect(() => {
    if (!spaces.data?.length) return;
    if (space && findSpace(spaces.data, space)) return;
    setSpace(spaces.data.find((s) => s.kind === 'Department') ?? spaces.data[0]);
  }, [spaces.data, space]);
  useEffect(() => { if (initialSpace) { setSpace(initialSpace); setFolderId(null); } }, [initialSpace]);

  const current = findSpace(spaces.data, space);
  const folders = useFolders(space);
  const searching = debounced.trim().length > 0;
  const filter = useMemo(() => ({
    space: searching && allSpaces ? null : space,
    folderId: searching ? null : folderId,
    search: debounced, kind, status,
  }), [space, folderId, debounced, searching, allSpaces, kind, status]);
  const pg = usePageState('doc-assets', JSON.stringify(filter));
  const assets = useAssets(filter, pg.query, !!space);
  const subfolders = (folders.data ?? []).filter((f) => f.parentId === folderId).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const crumbs = useMemo(() => {
    const byId = new Map((folders.data ?? []).map((f) => [f.id, f]));
    const list: IFolder[] = [];
    for (let c = folderId ? byId.get(folderId) : undefined; c && list.length < 30; c = c.parentId ? byId.get(c.parentId) : undefined) list.unshift(c);
    return list;
  }, [folders.data, folderId]);

  const createFolder = useDocMutation(({ name }: { name: string }) => documentApi.createFolder(space!, folderId, name));
  const renameFolder = useDocMutation(({ id, name }: { id: string; name: string }) => documentApi.renameFolder(id, name));
  const deleteFolder = useDocMutation((id: string) => documentApi.deleteFolder(id));

  const startUpload = (files: (File & { relPath?: string })[]) => {
    if (!current?.canWrite) { toast.error('Bạn không tải lên được kho này'); return; }
    if (files.length) void uploads.start(files, space!, folderId);
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    startUpload(await filesFromDrop(e.dataTransfer.items));
  };
  const locationOf = (r: IAssetRow) => {
    if (!searching || !allSpaces) return '';
    const s = findSpace(spaces.data, { kind: r.spaceKind, id: r.spaceId });
    return s ? spaceLabel(s) : SPACE_KIND[r.spaceKind];
  };

  if (spaces.isLoading) return <Spinner />;
  const spaceOptions = (spaces.data ?? []).map((s) => ({ value: spaceKey(s), label: spaceLabel(s) }));

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="grid min-w-0 content-start gap-3">
        <SelectField id="doc-space" label="Kho" value={space ? spaceKey(space) : null} options={spaceOptions}
          onChange={(v) => { if (v) { setSpace(parseSpaceKey(v)); setFolderId(null); setSearch(''); } }} />
        <div className="rounded-xl border bg-card p-2">
          {folders.isLoading ? <Spinner /> : (
            <FolderTree folders={folders.data ?? []} selected={folderId} onSelect={(id) => { setFolderId(id); setSearch(''); }}
              rootLabel={current ? (current.kind === 'Company' ? 'Kho chung công ty' : current.name) : 'Kho'} />
          )}
        </div>
      </aside>

      <section className={cn('grid min-w-0 content-start gap-3 rounded-xl', dragOver && 'outline-2 outline-dashed outline-primary')}
        onDragOver={(e) => { if (current?.canWrite && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
        onDrop={onDrop}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full min-w-0 sm:w-auto sm:min-w-48 sm:flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Tìm tiêu đề, mã, số hiệu, thẻ, tên file…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Tìm tài liệu" />
          </div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={allSpaces} onCheckedChange={(c) => setAllSpaces(c === true)} /> Mọi kho</label>
          <div className="w-36"><SelectField id="doc-kind" label="" value={kind} allowEmpty emptyLabel="Mọi nhóm file" onChange={(v) => setKind(v as AssetKind | null)}
            options={Object.entries(KIND).map(([value, k]) => ({ value, label: k.label }))} /></div>
          <div className="w-36"><SelectField id="doc-status" label="" value={status} allowEmpty emptyLabel="Mọi trạng thái" onChange={(v) => setStatus(v as AssetStatus | null)}
            options={Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))} /></div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <nav className="flex w-full min-w-0 flex-wrap items-center gap-1 text-sm sm:w-auto sm:flex-1" aria-label="Đường dẫn thư mục">
            {searching ? <span className="text-muted-foreground">Kết quả tìm {allSpaces ? 'trong mọi kho' : `trong ${current?.name ?? 'kho'}`}</span> : (
              <>
                <button type="button" className="font-medium hover:underline" onClick={() => setFolderId(null)}>{current?.kind === 'Company' ? 'Kho chung' : current?.name}</button>
                {crumbs.map((c) => (
                  <span key={c.id} className="flex items-center gap-1"><ChevronRight className="size-3.5 text-muted-foreground" />
                    <button type="button" className="hover:underline" onClick={() => setFolderId(c.id)}>{c.name}</button></span>
                ))}
              </>
            )}
          </nav>
          {current?.canWrite && (
            <>
              <Button size="sm" variant="outline" onClick={() => setPrompt({ title: 'Thư mục mới', input: 'line', label: 'Tên thư mục', required: true, confirm: 'Tạo',
                onConfirm: (name) => createFolder.mutateAsync({ name }) })}><FolderPlus /> Thư mục</Button>
              <Button size="sm" variant="outline" onClick={() => dirInput.current?.click()}><FolderUp /> Tải thư mục</Button>
              <Button size="sm" onClick={() => fileInput.current?.click()}><Upload /> Tải file</Button>
              <input ref={fileInput} type="file" multiple hidden onChange={(e) => { startUpload([...(e.target.files ?? [])]); e.target.value = ''; }} />
              <input ref={dirInput} type="file" hidden multiple {...{ webkitdirectory: '', directory: '' }}
                onChange={(e) => { startUpload([...(e.target.files ?? [])]); e.target.value = ''; }} />
            </>
          )}
        </div>
        {current?.closed && <p className="rounded-md bg-muted p-2 text-sm text-muted-foreground">Dự án đã đóng — kho chỉ đọc.</p>}

        <UploadPanel items={uploads.items} onClear={uploads.clear} />

        {!searching && subfolders.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
            {subfolders.map((f) => (
              <div key={f.id} className="flex items-center rounded-lg border bg-card hover:bg-muted/50">
                <button type="button" className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm" onClick={() => setFolderId(f.id)}>
                  <Folder className="size-4 shrink-0 text-warning" /><span className="truncate">{f.name}</span>
                  {f.assetCount > 0 && <span className="ms-auto text-xs text-muted-foreground">{f.assetCount}</span>}
                </button>
                {current?.canWrite && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Thao tác thư mục ${f.name}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setPrompt({ title: 'Đổi tên thư mục', input: 'line', label: 'Tên mới', initial: f.name, required: true, confirm: 'Lưu',
                        onConfirm: (name) => renameFolder.mutateAsync({ id: f.id, name }) })}>Đổi tên</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onSelect={() => setPrompt({ title: `Xoá thư mục "${f.name}"?`, confirm: 'Xoá', destructive: true,
                        description: 'Chỉ xoá được thư mục trống.', onConfirm: () => deleteFolder.mutateAsync(f.id) })}>Xoá</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="rounded-xl border bg-card">
          <AssetTable rows={assets.data?.items ?? []} loading={assets.isLoading} onOpen={(r) => onOpen(r.id)} showLocation={allSpaces && searching ? locationOf : undefined}
            empty={searching ? 'Không tìm thấy tài liệu nào.' : current?.canWrite ? 'Thư mục trống — bấm "Tải file" hoặc kéo thả file / thư mục vào đây.' : 'Thư mục trống.'} />
          <TablePagination state={pg} total={assets.data?.total} unit="tài liệu" />
        </div>
      </section>
      <PromptDialog spec={prompt} onClose={() => setPrompt(null)} />
    </div>
  );
}

