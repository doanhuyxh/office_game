import { PageHeader, PageToolbar } from '@/components/layout/PageHeader';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/common/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/common/tabs';
import { hasRole, useMe } from '@/features/auth';
import { useMyBalance } from '../hooks/useLeave';
import { BalanceCard, YearEndCard } from './BalanceCards';
import { LeaveRequestDialog } from './LeaveRequestDialog';
import { BalancesTable, MyLeavesTable, TeamCalendar } from './LeaveTables';

/** Nghỉ phép: của tôi (mọi người) · lịch nghỉ (quản lý / HR) · quỹ phép (HR). */
export function LeavePage() {
  const { data: me } = useMe();
  const isManager = hasRole(me, 'admin', 'hr', 'manager');
  const isHr = hasRole(me, 'admin', 'hr');
  const { data: balance, noProfile } = useMyBalance();
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader title="Nghỉ phép" />
      <Tabs defaultValue={noProfile && isManager ? 'team' : 'my'}>
        <PageToolbar actions={!noProfile && <Button onClick={() => setOpen(true)}><Plus /> Xin nghỉ</Button>}>
        <TabsList>
          <TabsTrigger value="my">Của tôi</TabsTrigger>
          {isManager && <TabsTrigger value="team">Lịch nghỉ</TabsTrigger>}
          {isHr && <TabsTrigger value="balances">Quỹ phép</TabsTrigger>}
        </TabsList>
        </PageToolbar>
        <TabsContent value="my" className="mt-4 space-y-6">
          {noProfile ? (
            <Card><CardHeader><CardTitle className="text-base">Tài khoản chưa gắn hồ sơ nhân viên</CardTitle>
              <CardDescription>Tài khoản quản trị hệ thống không có quỹ phép.</CardDescription></CardHeader></Card>
          ) : (
            <>
              {balance && <div className="grid gap-4 md:grid-cols-2"><BalanceCard b={balance} /><YearEndCard b={balance} /></div>}
              <div className="space-y-3"><h3 className="font-semibold">Đơn nghỉ của tôi</h3><MyLeavesTable /></div>
            </>
          )}
        </TabsContent>
        {isManager && <TabsContent value="team" className="mt-4"><TeamCalendar /></TabsContent>}
        {isHr && <TabsContent value="balances" className="mt-4"><BalancesTable /></TabsContent>}
      </Tabs>
      <LeaveRequestDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
