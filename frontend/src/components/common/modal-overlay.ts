/**
 * Lớp phủ dùng chung cho mọi modal (Dialog, AlertDialog, Sheet) — một nguồn duy nhất (TEST-226).
 * Màu + độ mờ nằm ở `.modal-overlay` (assets/styles/global.css): nền `--overlay` theo theme + `backdrop-filter: blur`,
 * modal lồng nhau chỉ phủ thêm nhẹ (không đen kịt), văn phòng 3D / prefers-reduced-transparency chỉ phủ tối, không blur.
 * Modal mới KHÔNG tự vẽ lớp phủ: dùng DialogContent / SheetContent / AlertDialogContent / confirmDialog.
 */
export const modalOverlayClassName =
  "modal-overlay fixed inset-0 z-50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
