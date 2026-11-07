import { useState } from 'react';
import type { ISpaceRef } from '../../types/document.types';
import { AssetSheet } from '../asset-sheet';
import { LibraryTab } from '../library-tab';

/**
 * Kho tài liệu gọn để nhúng nơi khác (văn phòng 3D): chọn kho + thư mục + tải lên + chi tiết.
 * `initialSpace` mở thẳng một kho (tủ hồ sơ phòng ban, kệ thư viện); `onPresent` → nút "Chiếu lên màn hình phòng" trong chi tiết.
 */
export function DocumentsBrowser({ initialSpace, onPresent }: { initialSpace?: ISpaceRef | null; onPresent?: (assetId: string) => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      <LibraryTab initialSpace={initialSpace ?? null} onOpen={setOpenId} />
      <AssetSheet id={openId} onClose={() => setOpenId(null)} onPresent={onPresent} />
    </>
  );
}
