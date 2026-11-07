import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { AssetSheet, AssetTable, DocumentsBrowser, useRecentPublished, type ISpaceRef } from '@/features/documents';
import { useDepartments } from '@/features/employees';
import type { MapObject } from '../engine/mapTypes';
import { OFFICE_MAP } from '../engine/officeMap';
import type { ScreenDto } from '../types/office.types';

/** Hộp thoại tài liệu trong văn phòng: duyệt một kho (tủ hồ sơ, kệ thư viện, nút HUD) hoặc bảng tin (mới ban hành). */
export type DocsMode =
  | { kind: 'browse'; space: ISpaceRef | null; title: string; present?: boolean }
  | { kind: 'notices'; title: string };

export function OfficeDocsDialog({ mode, onClose, onPresent }: { mode: DocsMode | null; onClose: () => void; onPresent?: (assetId: string) => void }) {
  return (
    <Dialog open={!!mode} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="h-[90vh] content-start w-[96vw] max-w-[min(1200px,96vw)] overflow-y-auto sm:max-w-[min(1200px,96vw)]" data-testid="office-docs">
        <DialogHeader>
          <DialogTitle>{mode?.title}</DialogTitle>
          <DialogDescription>
            {mode?.kind === 'notices' ? 'Tài liệu ban hành trong 60 ngày gần nhất, trong các kho bạn được xem.'
              : mode?.present ? 'Mở một tài liệu rồi bấm "Chiếu lên màn hình phòng" — người đang ở trong phòng cùng xem.'
                : 'Kéo thả file / thư mục vào đây hoặc thẳng vào văn phòng để tải lên kho.'}
          </DialogDescription>
        </DialogHeader>
        {mode?.kind === 'browse' && <DocumentsBrowser initialSpace={mode.space} onPresent={mode.present ? onPresent : undefined} />}
        {mode?.kind === 'notices' && <Notices onPresent={onPresent} />}
      </DialogContent>
    </Dialog>
  );
}

function Notices({ onPresent }: { onPresent?: (assetId: string) => void }) {
  const recent = useRecentPublished();
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      <div className="rounded-xl border bg-card">
        <AssetTable rows={recent.data ?? []} loading={recent.isLoading} onOpen={(r) => setOpenId(r.id)} empty="Chưa có tài liệu nào được ban hành gần đây."
          extraHead="Số hiệu" extra={(r) => <span className="whitespace-nowrap text-xs">{r.documentNumber}</span>} />
      </div>
      <AssetSheet id={openId} onClose={() => setOpenId(null)} onPresent={onPresent} />
    </>
  );
}

/** Khoảng cách từ điểm tới hình chữ nhật (0 nếu ở trong). */
const distRect = (x: number, z: number, r: { x0: number; x1: number; z0: number; z1: number }) =>
  Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

/**
 * Phòng ban sở hữu tủ hồ sơ: phòng ban có khu (`departments.MapZone` = area / room zone) gần tủ nhất (≤ 5 m — tủ ở dải tiện ích
 * hay sát tường vẫn thuộc khu bên cạnh). Không có → null (mở kho mặc định).
 */
export function useCabinetDepartment() {
  const departments = useDepartments();
  return (o: MapObject) => {
    let best: { id: string; name: string; d: number } | null = null;
    for (const dep of departments.data ?? []) {
      if (!dep.mapZone) continue;
      const rects = [...OFFICE_MAP.areas.filter((a) => a.id === dep.mapZone), ...OFFICE_MAP.rooms.filter((r) => r.zone === dep.mapZone)];
      for (const r of rects) {
        const d = distRect(o.x, o.z, r);
        if (d <= 5 && (!best || d < best.d)) best = { id: dep.id, name: dep.name, d };
      }
    }
    return best;
  };
}

/** Tài liệu đang chiếu trên màn hình phòng (HUD). Bấm khung để phóng to; ai trong phòng cũng tắt được. */
export function ScreenDocPanel({ screen, onClear }: { screen: ScreenDto | null; onClear: () => void }) {
  const [big, setBig] = useState(false);
  if (!screen) return null;
  const media = !screen.inline ? (
    <a className="screen-doc-open" href={screen.url} target="_blank" rel="noreferrer">Loại file này không xem trực tiếp được — mở / tải về</a>
  ) : screen.kind === 'Image' ? <img src={screen.url} alt={screen.title} />
    : screen.kind === 'Video' ? <video src={screen.url} controls playsInline preload="metadata" />
      : screen.kind === 'Audio' ? <audio src={screen.url} controls />
        : <iframe src={screen.url} title={screen.title} />;
  return (
    <div className={`card screen screen-doc ${big ? 'big' : ''}`} data-testid="office-screen-doc">
      <div className="screen-doc-head">
        <span>📺 <b>{screen.title}</b> · {screen.byName} đang chiếu ở {screen.roomName}</span>
        <div>
          <button type="button" onClick={() => setBig((b) => !b)}>{big ? 'Thu nhỏ' : 'Phóng to'}</button>
          <a href={screen.url} target="_blank" rel="noreferrer">Mở tab mới</a>
          <button type="button" className="danger" onClick={onClear} data-testid="office-screen-clear">Tắt chiếu</button>
        </div>
      </div>
      <div className="screen-doc-body">{media}</div>
    </div>
  );
}
