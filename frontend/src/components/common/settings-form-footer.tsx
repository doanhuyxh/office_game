import type { ReactNode } from 'react';
import { Button } from '@/components/common/button';

/**
 * Chân khối cấu hình (trang Hệ thống → Cấu hình, TEST-112): ghi chú ("Sửa lần cuối… bởi…") bên trái, hàng nút canh phải —
 * nút phụ (`children`, vd Kiểm tra) trước, nút "Lưu" (submit của form) luôn ngoài cùng bên phải.
 * Điện thoại: ghi chú một dòng riêng ở trên, hàng nút xuống dưới vẫn canh phải.
 * `saving` → nút Lưu hiện vòng xoay + "Đang lưu…" (TEST-131).
 */
export function SettingsFormFooter({ note, noteTestId, saveDisabled, saving, saveLabel = 'Lưu', children }: {
  note?: ReactNode;
  noteTestId?: string;
  saveDisabled?: boolean;
  /** Đang lưu: vòng xoay + "Đang lưu…", chặn bấm lần hai. */
  saving?: boolean;
  saveLabel?: string;
  /** Nút phụ, nằm bên trái nút Lưu (theo thứ tự truyền vào). */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2" data-testid="settings-form-footer">
      {note && <span className="me-auto basis-full text-xs text-muted-foreground sm:min-w-48 sm:flex-1 sm:basis-0" data-testid={noteTestId}>{note}</span>}
      {children}
      <Button type="submit" disabled={saveDisabled} loading={saving} loadingText="Đang lưu…" data-testid="settings-form-save">{saveLabel}</Button>
    </div>
  );
}
