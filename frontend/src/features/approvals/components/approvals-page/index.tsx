import { useState } from 'react';
import { UserRoundCog } from 'lucide-react';
import { Button } from '@/components/common/button';
import { PageHeader, PageToolbar } from '@/components/layout/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/common/tabs';
import { hasRole, useMe } from '@/features/auth';
import { useInbox, useMyApprovals, useMyDelegations } from '../../hooks/useApprovals';
import type { IApproval } from '../../types/approval.types';
import { ApprovalCard } from '../approval-card';
import { DelegationDialog } from '../delegation-dialog';
import { DelegationsTab } from '../delegations-tab';
import { useTabParam } from '@/hooks/useTabParam';

function List({ items, loading, empty, showRequester }: { items: IApproval[]; loading: boolean; empty: string; showRequester: boolean }) {
  if (loading) return <p className="text-sm text-muted-foreground">Đang tải…</p>;
  if (items.length === 0) return <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">{empty}</p>;
  return <div className="grid gap-3">{items.map((a) => <ApprovalCard key={a.id} item={a} showRequester={showRequester} />)}</div>;
}

/** Phê duyệt: đơn chờ tôi duyệt (quản lý / người được uỷ quyền / HR), đơn tôi đã gửi (mọi người), uỷ quyền duyệt. */
export function ApprovalsPage() {
  const { data: me } = useMe();
  const isHr = hasRole(me, 'admin', 'hr');
  const inbox = useInbox();
  const mine = useMyApprovals();
  const delegations = useMyDelegations();
  const [delegating, setDelegating] = useState(false);
  const count = inbox.data?.length ?? 0;
  const canDelegate = delegations.data?.canDelegate ?? false;
  // Tab trên URL (?tab=…) giữ khi reload. Chưa chọn: đợi hộp duyệt tải xong — có đơn chờ → "Chờ tôi duyệt", không → "Đơn của tôi".
  const [urlTab, setTab] = useTabParam('', ['inbox', 'mine', 'delegations']);
  const tab = urlTab || (inbox.isSuccess && count === 0 ? 'mine' : 'inbox');
  return (
    <div className="space-y-6">
      <PageHeader title="Phê duyệt" />
      <Tabs value={tab} onValueChange={setTab}>
        <PageToolbar
          actions={(canDelegate || isHr) && (
            <Button size="sm" variant="outline" onClick={() => setDelegating(true)} data-testid="delegate-button">
              <UserRoundCog className="size-4" /> Uỷ quyền duyệt
            </Button>
          )}>
          <TabsList>
            <TabsTrigger value="inbox">Chờ tôi duyệt{count > 0 && ` (${count})`}</TabsTrigger>
            <TabsTrigger value="mine">Đơn của tôi</TabsTrigger>
            <TabsTrigger value="delegations">Uỷ quyền</TabsTrigger>
          </TabsList>
        </PageToolbar>
        <TabsContent value="inbox" className="mt-4">
          <List items={inbox.data ?? []} loading={inbox.isLoading} empty="Không có đơn nào chờ bạn duyệt" showRequester />
        </TabsContent>
        <TabsContent value="mine" className="mt-4">
          <List items={mine.data ?? []} loading={mine.isLoading} empty="Bạn chưa gửi đơn nào" showRequester={false} />
        </TabsContent>
        <TabsContent value="delegations" className="mt-4">
          <DelegationsTab isHr={isHr} />
        </TabsContent>
      </Tabs>
      <DelegationDialog open={delegating} onClose={() => setDelegating(false)} isHr={isHr}
        myEmployeeId={delegations.data?.employeeId ?? null} canDelegateSelf={canDelegate} />
    </div>
  );
}
