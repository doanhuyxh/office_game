import { useEffect, useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/common/tabs';
import { PageHeader, PageToolbar } from '@/components/layout/PageHeader';
import { useTabParam } from '@/hooks/useTabParam';
import { ContractSheet } from '../contract-sheet';
import { ContractsTab } from '../contracts-tab';
import { CustomerSheet } from '../customer-sheet';
import { CustomersTab } from '../customers-tab';
import { OpportunitiesTab } from '../opportunities-tab';
import { ReceivablesTab } from '../receivables-tab';

const TABS = ['customers', 'opportunities', 'contracts', 'receivables'] as const;

/**
 * Kinh doanh: Khách hàng · Cơ hội · Hợp đồng · Công nợ. Ai cũng dùng được; mỗi người thấy dữ liệu mình phụ trách + cấp dưới,
 * Ban giám đốc / kế toán (quyền Xem tài chính theo chức vụ) thấy tất cả — kiểm tra ở back-end. `?customer=<id>` mở thẳng khách (link từ thông báo).
 */
export function SalesPage() {
  const [tab, setTab] = useTabParam('customers', TABS);
  const search = useSearch({ strict: false }) as { customer?: string };
  const [creating, setCreating] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [contractId, setContractId] = useState<string | null>(null);
  useEffect(() => { if (search.customer) setCustomerId(search.customer); }, [search.customer]);
  const add = (key: string, label: string) => <Button size="sm" onClick={() => setCreating(key)}><Plus /> {label}</Button>;
  const actions = tab === 'customers' ? add('customer', 'Thêm khách') : tab === 'opportunities' ? add('opportunity', 'Thêm cơ hội') : tab === 'contracts' ? add('contract', 'Tạo hợp đồng') : null;
  const done = () => setCreating(null);
  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Kinh doanh" />
      <Tabs value={tab} onValueChange={(t) => { setCreating(null); setTab(t); }}>
        <PageToolbar actions={actions}>
          <TabsList>
            <TabsTrigger value="customers">Khách hàng</TabsTrigger>
            <TabsTrigger value="opportunities">Cơ hội</TabsTrigger>
            <TabsTrigger value="contracts">Hợp đồng</TabsTrigger>
            <TabsTrigger value="receivables">Công nợ</TabsTrigger>
          </TabsList>
        </PageToolbar>
        <TabsContent value="customers" className="mt-4"><CustomersTab creating={creating === 'customer'} onCreatedClose={done} onOpen={setCustomerId} /></TabsContent>
        <TabsContent value="opportunities" className="mt-4"><OpportunitiesTab creating={creating === 'opportunity'} onCreatedClose={done} /></TabsContent>
        <TabsContent value="contracts" className="mt-4"><ContractsTab creating={creating === 'contract'} onCreatedClose={done} onOpen={setContractId} /></TabsContent>
        <TabsContent value="receivables" className="mt-4"><ReceivablesTab onOpenContract={setContractId} /></TabsContent>
      </Tabs>
      <CustomerSheet id={customerId} onClose={() => setCustomerId(null)} onOpenContract={(id) => { setCustomerId(null); setContractId(id); }} />
      <ContractSheet id={contractId} onClose={() => setContractId(null)} onOpenCustomer={(id) => { setContractId(null); setCustomerId(id); }} />
    </div>
  );
}
