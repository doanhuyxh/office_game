import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/common/tabs';
import { PageHeader, PageToolbar } from '@/components/layout/PageHeader';
import { Spinner } from '@/components/feedback/Spinner';
import { useTabParam } from '@/hooks/useTabParam';
import { useFinancePerms } from '../../hooks/useFinance';
import { EntriesTab } from '../entries-tab';
import { ExpensesTab } from '../expenses-tab';
import { OverviewTab } from '../overview-tab';
import { SettingsTab } from '../settings-tab';

/**
 * Tài chính. Mọi nhân viên: tab "Đề nghị chi" (của mình). Người có quyền tài chính theo CHỨC VỤ (không theo vai trò admin / hr):
 * Tổng quan · Sổ thu chi · Đề nghị chi (tất cả) · Cấu hình. Quyền kiểm tra lại ở back-end cho mọi request.
 */
export function FinancePage() {
  const perms = useFinancePerms();
  const tabs = perms.view ? ['overview', 'entries', 'expenses', 'settings'] : ['expenses'];
  const [tab, setTab] = useTabParam(perms.view ? 'overview' : 'expenses', tabs);
  const [creating, setCreating] = useState<string | null>(null);
  if (perms.loading) return <Spinner />;
  const actions = tab === 'entries' && perms.record ? <Button size="sm" onClick={() => setCreating('entry')}><Plus /> Ghi giao dịch</Button>
    : tab === 'expenses' ? <Button size="sm" onClick={() => setCreating('expense')}><Plus /> Đề nghị chi</Button>
    : null;
  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Tài chính" />
      <Tabs value={tab} onValueChange={(t) => { setCreating(null); setTab(t); }}>
        <PageToolbar actions={actions}>
          <TabsList>
            {perms.view && <TabsTrigger value="overview">Tổng quan</TabsTrigger>}
            {perms.view && <TabsTrigger value="entries">Sổ thu chi</TabsTrigger>}
            <TabsTrigger value="expenses">Đề nghị chi</TabsTrigger>
            {perms.view && <TabsTrigger value="settings">Cấu hình</TabsTrigger>}
          </TabsList>
        </PageToolbar>
        {perms.view && <TabsContent value="overview" className="mt-4"><OverviewTab /></TabsContent>}
        {perms.view && <TabsContent value="entries" className="mt-4"><EntriesTab creating={creating === 'entry'} onCreatedClose={() => setCreating(null)} /></TabsContent>}
        <TabsContent value="expenses" className="mt-4"><ExpensesTab creating={creating === 'expense'} onCreatedClose={() => setCreating(null)} /></TabsContent>
        {perms.view && <TabsContent value="settings" className="mt-4"><SettingsTab /></TabsContent>}
      </Tabs>
    </div>
  );
}
