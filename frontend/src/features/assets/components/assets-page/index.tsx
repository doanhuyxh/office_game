import { useState } from 'react';
import { FileSpreadsheet, Plus } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/common/tabs';
import { PageHeader, PageToolbar } from '@/components/layout/PageHeader';
import { FACEBOOK_PLATFORM } from '@/config/social-platforms';
import { useMe } from '@/features/auth';
import { useTabParam } from '@/hooks/useTabParam';
import { downloadUrl } from '@/utils/money';
import { assetExcelUrl } from '../../api/asset.api';
import { CategoriesTab } from '../categories-tab';
import { DevicesTab } from '../devices-tab';
import { MyAssetsTab } from '../my-assets-tab';
import { OverviewTab } from '../overview-tab';
import { ReviewsTab } from '../reviews-tab';
import { ServicesTab } from '../services-tab';
import { SocialTab } from '../social-tab';
import { StocktakesTab } from '../stocktakes-tab';
import { useSocialPlatformParam } from '../../hooks/useSocialPlatformParam';

const HR_TABS = ['overview', 'devices', 'services', 'social', 'reviews', 'stocktakes', 'categories'] as const;
const RESET_ON_TAB = ['platform'] as const; // sub-tab nền tảng của tab MXH

/**
 * Tài sản công ty. HR / admin: Tổng quan · Thiết bị · Dịch vụ · MXH (sub-tab theo nền tảng: Facebook BM · Zalo OA · TikTok) · Rà soát · Kiểm kê · Danh mục · Của tôi.
 * Mọi người khác: chỉ "Của tôi" (thiết bị + tài khoản đang giữ, và việc rà soát quyền nếu là người rà soát).
 */
export function AssetsPage() {
  const me = useMe();
  const isHr = !!me.data?.roles.some((r) => r === 'admin' || r === 'hr');
  const [tab, setTab] = useTabParam(isHr ? 'overview' : 'mine', isHr ? [...HR_TABS, 'mine'] : ['mine'], { reset: RESET_ON_TAB });
  const [creating, setCreating] = useState<string | null>(null);
  const [platform, setPlatform] = useSocialPlatformParam();
  const done = () => setCreating(null);
  const add = (key: string, label: string) => <Button size="sm" onClick={() => setCreating(key)}><Plus /> {label}</Button>;
  const excel = (url: string) => <Button size="sm" variant="outline" onClick={() => downloadUrl(url)}><FileSpreadsheet /> Xuất Excel</Button>;

  const actions = !isHr ? null : tab === 'devices' ? <>{excel(assetExcelUrl.devices)}{add('device', 'Thêm thiết bị')}</>
    : tab === 'services' ? <>{excel(assetExcelUrl.services)}{add('service', 'Thêm dịch vụ')}</>
    : tab === 'social' ? (platform === FACEBOOK_PLATFORM.key ? add('social', 'Thêm BM Facebook') : null)
    : tab === 'reviews' ? add('review', 'Bắt đầu rà soát')
    : tab === 'stocktakes' ? add('stocktake', 'Bắt đầu kiểm kê')
    : tab === 'categories' ? add('category', 'Thêm loại')
    : null;

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Tài sản" />
      <Tabs value={tab} onValueChange={(t) => { setCreating(null); setTab(t); }}>
        <PageToolbar actions={actions}>
          <TabsList>
            {isHr && <TabsTrigger value="overview">Tổng quan</TabsTrigger>}
            {isHr && <TabsTrigger value="devices">Thiết bị</TabsTrigger>}
            {isHr && <TabsTrigger value="services">Dịch vụ</TabsTrigger>}
            {isHr && <TabsTrigger value="social">MXH</TabsTrigger>}
            {isHr && <TabsTrigger value="reviews">Rà soát</TabsTrigger>}
            {isHr && <TabsTrigger value="stocktakes">Kiểm kê</TabsTrigger>}
            {isHr && <TabsTrigger value="categories">Danh mục</TabsTrigger>}
            <TabsTrigger value="mine">Của tôi</TabsTrigger>
          </TabsList>
        </PageToolbar>
        {isHr && <TabsContent value="devices" className="mt-4"><DevicesTab creating={creating === 'device'} onCreatedClose={done} /></TabsContent>}
        {isHr && <TabsContent value="services" className="mt-4"><ServicesTab creating={creating === 'service'} onCreatedClose={done} /></TabsContent>}
        {isHr && <TabsContent value="social" className="mt-4"><SocialTab platform={platform} onPlatformChange={(p) => { setCreating(null); setPlatform(p); }} creating={creating === 'social'} onCreatedClose={done} /></TabsContent>}
        {isHr && <TabsContent value="reviews" className="mt-4"><ReviewsTab creating={creating === 'review'} onCreatedClose={done} /></TabsContent>}
        {isHr && <TabsContent value="stocktakes" className="mt-4"><StocktakesTab creating={creating === 'stocktake'} onCreatedClose={done} /></TabsContent>}
        {isHr && <TabsContent value="categories" className="mt-4"><CategoriesTab creating={creating === 'category'} onCreatedClose={done} /></TabsContent>}
        {isHr && <TabsContent value="overview" className="mt-4"><OverviewTab /></TabsContent>}
        <TabsContent value="mine" className="mt-4"><MyAssetsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
