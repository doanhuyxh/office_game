/**
 * Số kiểu Việt Nam (1.234,5), tối đa `maxFractionDigits` chữ số thập phân.
 * Làm tròn TRƯỚC rồi bỏ dấu âm của số 0: −0 (vd `-b.pending` khi pending = 0) hay −0,001 (sai số float) → "0", không phải "−0".
 */
export function formatNumber(n: number, maxFractionDigits = 2): string {
  const f = 10 ** maxFractionDigits;
  const r = Math.round(n * f) / f || 0; // || 0: −0 và NaN → 0
  return r.toLocaleString('vi-VN', { maximumFractionDigits: maxFractionDigits });
}
