/** Tiền VND: 15.000.000 ₫. null / undefined → "—". */
const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
export const formatMoney = (v: number | null | undefined) => (v == null ? '—' : money.format(Math.round(v) || 0)); // || 0: không hiện "-0 ₫"

/** Tải file từ API (cookie cùng origin) — dùng cho xuất Excel / Word. */
export function downloadUrl(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
