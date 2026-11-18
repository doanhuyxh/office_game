import type { KindCost } from './store';

/** Nhãn loại job trong `report`. */
export const KIND_LABEL: Record<string, string> = {
  task: 'việc',
  chat: 'chat',
  meeting: 'họp',
  review: 'review',
  deploy: 'deploy',
};

const n = (x: number) => x.toLocaleString('en');

/**
 * Mục "Theo loại" của `report` (TEST-139 — mốc đo trước / sau khi tối ưu token): mỗi loại job một dòng gồm số phiên, chi phí (tổng + trung bình
 * mỗi phiên có chi phí), token vào KHÔNG cache / ghi cache / đọc cache / ra, tỉ lệ đọc cache (= đọc cache / tổng token vào của các phiên có báo
 * cache). Phiên không báo cache (CLI tự khai báo, job trước TEST-135): token vào tính cả vào "không cache"; tỉ lệ "—" khi không phiên nào báo.
 */
export function kindReportLines(rows: KindCost[]): string[] {
  return rows.map((r) => {
    const read = r.cache_read ?? 0,
      write = r.cache_write ?? 0;
    const plain = Math.max(0, (r.input ?? 0) - read - write);
    const avg = r.costed ? `$${((r.cost ?? 0) / r.costed).toFixed(3)} / phiên` : 'chi phí không rõ';
    const hit = r.input_with_cache ? `${Math.round((read / r.input_with_cache) * 100)}%` : '—';
    return (
      `${KIND_LABEL[r.kind] ?? r.kind}\t${r.jobs} phiên\t$${(r.cost ?? 0).toFixed(2)} (${avg})` +
      `\tvào ${n(plain)} · ghi cache ${n(write)} · đọc cache ${n(read)} · ra ${n(r.output ?? 0)}\tđọc cache ${hit}`
    );
  });
}
