import { PageHeader } from '@/components/layout/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/common/tabs';
import { useInbox, useMyApprovals } from '../hooks/useApprovals';
import type { IApproval } from '../types/approval.types';
import { ApprovalCard } from './ApprovalCard';
import { useTabParam } from '@/hooks/useTabParam';

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
  // Tab trên URL (?tab=…) giữ khi reload. Chưa chọn: đợi hộp duyệt tải xong — có đơn chờ → "Chờ tôi duyệt", không → "Đơn của tôi".
  const [urlTab, setTab] = useTabParam('', ['inbox', 'mine']);
  const tab = urlTab || (inbox.isSuccess && count === 0 ? 'mine' : 'inbox');
  return (
    <div className="space-y-6">
      <PageHeader title="Phê duyệt" />
      <Tabs value={tab} onValueChange={setTab}>
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
