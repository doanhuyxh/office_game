import { PageHeader } from '@/components/layout/PageHeader';
import { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/common/tabs';
import { useInbox, useMyApprovals } from '../hooks/useApprovals';
import type { IApproval } from '../types/approval.types';
import { ApprovalCard } from './ApprovalCard';

function List({ items, loading, empty, showRequester }: { items: IApproval[]; loading: boolean; empty: string; showRequester: boolean }) {
  if (loading) return <p className="text-sm text-muted-foreground">Đang tải…</p>;
  if (items.length === 0) return <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">{empty}</p>;
  return <div className="grid gap-3">{items.map((a) => <ApprovalCard key={a.id} item={a} showRequester={showRequester} />)}</div>;
}

/** Phê duyệt: đơn chờ tôi duyệt (quản lý / HR) và đơn tôi đã gửi (mọi người). */
export function ApprovalsPage() {
  const inbox = useInbox();
  const mine = useMyApprovals();
  const count = inbox.data?.length ?? 0;
  // Chọn tab mặc định SAU khi hộp duyệt tải xong (có đơn chờ → mở "Chờ tôi duyệt"), sau đó để người dùng tự chuyển.
  const [tab, setTab] = useState<string | null>(null);
  useEffect(() => { if (tab === null && inbox.isSuccess) setTab(count > 0 ? 'inbox' : 'mine'); }, [tab, inbox.isSuccess, count]);
  return (
    <div className="space-y-6">
      <PageHeader title="Phê duyệt" description="Đơn nghỉ phép và giải trình chấm công. Thứ tự duyệt: quản lý trực tiếp → HR." />
      <Tabs value={tab ?? 'inbox'} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="inbox">Chờ tôi duyệt{count > 0 && ` (${count})`}</TabsTrigger>
          <TabsTrigger value="mine">Đơn của tôi</TabsTrigger>
        </TabsList>
        <TabsContent value="inbox" className="mt-4">
          <List items={inbox.data ?? []} loading={inbox.isLoading} empty="Không có đơn nào chờ bạn duyệt" showRequester />
        </TabsContent>
        <TabsContent value="mine" className="mt-4">
          <List items={mine.data ?? []} loading={mine.isLoading} empty="Bạn chưa gửi đơn nào" showRequester={false} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
