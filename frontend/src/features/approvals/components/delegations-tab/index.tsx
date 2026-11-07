import { useState } from 'react';
import { Checkbox } from '@/components/common/checkbox';
import { Label } from '@/components/common/label';
import { useAllDelegations, useMyDelegations } from '../../hooks/useApprovals';
import { DelegationList } from '../delegation-list';

/** Tab "Uỷ quyền": uỷ quyền tôi đã giao, uỷ quyền tôi được nhận; HR xem thêm toàn bộ uỷ quyền trong công ty. */
export function DelegationsTab({ isHr }: { isHr: boolean }) {
  const mine = useMyDelegations();
  const [showEnded, setShowEnded] = useState(false);
  const all = useAllDelegations(showEnded ? 'all' : 'current', isHr);
  const given = mine.data?.given ?? [];
  const received = mine.data?.received ?? [];
  return (
    <div className="grid gap-6">
      {(mine.data?.canDelegate || given.length > 0) && (
        <section className="grid gap-2">
          <h2 className="text-sm font-semibold">Tôi uỷ quyền cho</h2>
          <DelegationList items={given} loading={mine.isLoading} show="delegate"
            empty="Bạn chưa uỷ quyền duyệt cho ai. Bấm “Uỷ quyền duyệt” khi nghỉ phép / đi công tác." />
        </section>
      )}
      <section className="grid gap-2">
        <h2 className="text-sm font-semibold">Tôi được uỷ quyền duyệt thay</h2>
        <DelegationList items={received} loading={mine.isLoading} show="delegator" empty="Không có uỷ quyền nào cho bạn" />
      </section>
      {isHr && (
        <section className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Toàn công ty</h2>
            <div className="flex items-center gap-2">
              <Checkbox id="dg-ended" checked={showEnded} onCheckedChange={(c) => setShowEnded(c === true)} />
              <Label htmlFor="dg-ended" className="text-sm font-normal">Gồm cả đã hết hạn / thu hồi</Label>
            </div>
          </div>
          <DelegationList items={all.data ?? []} loading={all.isLoading} show="both" empty="Không có uỷ quyền nào đang hoặc sắp hiệu lực" />
        </section>
      )}
    </div>
  );
}
