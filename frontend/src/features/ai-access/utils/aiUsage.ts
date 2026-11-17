import { addDays } from '@/utils/date';
import { formatNumber } from '@/utils/number';
import type { AiSessionKind, AiUsageGroupBy, IAiSession } from '../types/aiUsage.types';

export const GROUP_LABEL: Record<AiUsageGroupBy, string> = { day: 'Ngày', month: 'Tháng', year: 'Năm' };

export const KIND_LABEL: Record<AiSessionKind, string> = { task: 'Việc', chat: 'Chat', meeting: 'Họp', other: 'Khác' };

export const SESSION_STATUS: Record<IAiSession['status'], { label: string; tone: 'success' | 'danger' | 'muted' }> = {
  done: { label: 'Xong', tone: 'success' },
  failed: { label: 'Lỗi', tone: 'danger' },
  skipped: { label: 'Bỏ qua', tone: 'muted' },
};

const usd2 = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd4 = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** Chi phí USD kiểu Việt Nam: $1,23 (dưới 1 xu → tới 4 chữ số: $0,0042). null → "—" (nhà cung cấp không báo, không phải 0). */
export function formatUsd(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const abs = Math.abs(v);
  return `$${(abs > 0 && abs < 0.01 ? usd4 : usd2).format(v)}`;
}

/** Token rút gọn: 1.234 · 123.456 · 1,2 tr · 3,4 tỷ (chỗ hiển thị kèm `title` số đầy đủ). */
export function formatTokensShort(n: number): string {
  if (Math.abs(n) >= 1e9) return `${formatNumber(n / 1e9, 1)} tỷ`;
  if (Math.abs(n) >= 1e6) return `${formatNumber(n / 1e6, 1)} tr`;
  return formatNumber(n, 0);
}

/** Tổng token của một dòng (vào + ra + cache đọc + cache ghi). */
export const totalTokens = (x: { inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null }) =>
  (x.inputTokens ?? 0) + (x.outputTokens ?? 0) + (x.cacheReadTokens ?? 0) + (x.cacheWriteTokens ?? 0);

/** 754 giây → "12 phút 34 giây"; < 1 phút → "45 giây". */
export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  if (h) return m ? `${h} giờ ${m} phút` : `${h} giờ`;
  if (m) return s ? `${m} phút ${s} giây` : `${m} phút`;
  return `${s} giây`;
}

/** Nhãn kỳ: 2026-11-17 → 17/11 (`long` → 17/11/2026) · 2026-11 → 11/2026 · 2026 → 2026. */
export function bucketLabel(bucket: string, long = false): string {
  if (bucket.length === 10) return `${bucket.slice(8, 10)}/${bucket.slice(5, 7)}${long ? `/${bucket.slice(0, 4)}` : ''}`;
  if (bucket.length === 7) return `${bucket.slice(5, 7)}/${bucket.slice(0, 4)}`;
  return bucket;
}

/** Mọi kỳ trong khoảng (trục X liên tục, kỳ không có dữ liệu = cột trống). Năm: từ năm đầu có dữ liệu (`firstData`). */
export function allBuckets(group: AiUsageGroupBy, from: string, to: string, firstData?: string): string[] {
  const out: string[] = [];
  if (group === 'day') {
    for (let d = from; d <= to && out.length < 4000; d = addDays(d, 1)) out.push(d);
  } else if (group === 'month') {
    let [y, m] = from.slice(0, 7).split('-').map(Number);
    const end = to.slice(0, 7);
    while (out.length < 200) {
      const b = `${y}-${String(m).padStart(2, '0')}`;
      if (b > end) break;
      out.push(b);
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  } else {
    const start = Math.max(Number((firstData ?? to).slice(0, 4)), Number(from.slice(0, 4)));
    for (let y = start; y <= Number(to.slice(0, 4)); y++) out.push(String(y));
  }
  return out;
}

/** Bảng màu cố định cho model (Tailwind, chạy cả sáng / tối): băm theo tên model → cùng model luôn cùng màu ở mọi bộ lọc / trang. */
const PALETTE = [
  'bg-violet-500', 'bg-sky-500', 'bg-amber-500', 'bg-emerald-500', 'bg-rose-500',
  'bg-indigo-500', 'bg-teal-500', 'bg-orange-500', 'bg-fuchsia-500', 'bg-lime-600',
];

export function modelColor(model: string): string {
  let h = 0;
  for (let i = 0; i < model.length; i++) h = (h * 31 + model.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
