import { useEffect, useState } from 'react';
import { FolderKanban } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/common/tabs';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { PageHeader, PageToolbar } from '@/components/layout/PageHeader';
import { useMe } from '@/features/auth';
import { PATHS } from '@/config/paths';
import { useTrash } from '../../hooks/useDocuments';
import type { ISpaceRef } from '../../types/document.types';
import { parseSpaceKey } from '../../utils/labels';
import { AdminTab } from '../admin-tab';
import { AssetSheet } from '../asset-sheet';
import { AssetTable } from '../asset-table';
import { LibraryTab } from '../library-tab';
import { useTabParam } from '@/hooks/useTabParam';

/**
 * Kho tài sản số. URL: `?asset=<id>` mở chi tiết (link từ thông báo / phê duyệt), `?space=Project:<id>` mở thẳng một kho.
 * Tab: Quản trị (HR / admin) · Kho tài liệu · Thùng rác. Dự án + thành viên quản lý ở /projects (module Projects, 2026-11-08); kho dự án vẫn hiện ở Kho tài liệu.
 */
export function DocumentsPage() {
  const search = useSearch({ strict: false }) as { asset?: string; space?: string };
  const navigate = useNavigate();
  const me = useMe();
  const isHr = !!me.data?.roles.some((r) => r === 'admin' || r === 'hr');
  const [tab, setTab] = useTabParam('library', ['library', 'trash', ...(isHr ? ['admin'] : [])]);
  const [openId, setOpenId] = useState<string | null>(search.asset ?? null);
  const [space, setSpace] = useState<ISpaceRef | null>(search.space ? parseSpaceKey(search.space) : null);

  useEffect(() => { if (search.asset) setOpenId(search.asset); }, [search.asset]);
  useEffect(() => { if (search.space) { setSpace(parseSpaceKey(search.space)); setTab('library'); } }, [search.space, setTab]);
  const close = () => {
    setOpenId(null);
    if (search.asset) void navigate({ to: PATHS.documents, search: ((prev: Record<string, unknown>) => ({ ...prev, asset: undefined })) as never, replace: true });
  };

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Tài liệu" />
      <Tabs value={tab} onValueChange={setTab}>
        <PageToolbar actions={<Button size="sm" variant="outline" asChild><Link to={PATHS.projects}><FolderKanban /> Dự án</Link></Button>}>
          <TabsList>
            {isHr && <TabsTrigger value="admin">Quản trị</TabsTrigger>}
            <TabsTrigger value="library">Kho tài liệu</TabsTrigger>
            <TabsTrigger value="trash">Thùng rác</TabsTrigger>
          </TabsList>
        </PageToolbar>
        <TabsContent value="library" className="mt-4"><LibraryTab initialSpace={space} onOpen={setOpenId} /></TabsContent>
        <TabsContent value="trash" className="mt-4"><TrashTab onOpen={setOpenId} /></TabsContent>
        {isHr && <TabsContent value="admin" className="mt-4"><AdminTab onOpen={setOpenId} /></TabsContent>}
      </Tabs>
      <AssetSheet id={openId} onClose={close} />
    </div>
  );
}

function TrashTab({ onOpen }: { onOpen: (id: string) => void }) {
  const pg = usePageState('doc-trash');
  const { data, isLoading } = useTrash(pg.query);
  return (
    <div className="grid gap-2">
      <p className="text-sm text-muted-foreground">Tài liệu nháp đã xoá — mở để khôi phục hoặc xoá hẳn. Tự xoá hẳn sau 30 ngày.</p>
      <div className="rounded-xl border bg-card">
        <AssetTable rows={data?.items ?? []} loading={isLoading} onOpen={(r) => onOpen(r.id)} empty="Thùng rác trống." />
        <TablePagination state={pg} total={data?.total} unit="tài liệu" />
      </div>
    </div>
  );
}
