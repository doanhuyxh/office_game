import { formatNumber } from '@/utils/number';
import type { AgentTranscriptKind } from '../types/agentTranscript.types';

export const TRANSCRIPT_KIND_LABEL: Record<AgentTranscriptKind, string> = { task: 'Việc', chat: 'Chat', meeting: 'Họp' };

/** Kích thước file (bản gzip): 512 B · 12,3 KB · 4,5 MB. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${formatNumber(n, 0)} B`;
  if (n < 1024 * 1024) return `${formatNumber(n / 1024, 1)} KB`;
  return `${formatNumber(n / 1024 / 1024, 1)} MB`;
}

/** Bản bàn giao rút gọn cho ô bảng: bỏ ký hiệu Markdown đầu dòng / nhấn mạnh, gộp xuống dòng thành một dòng. */
export const summaryPreview = (s: string) =>
  s.replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+|>\s?)/gm, '').replace(/(\*\*|__|`)/g, '').replace(/\s+/g, ' ').trim();

/**
 * Ngưỡng xem nhanh trên web (TEST-197), so với `sizeBytes` (bản gzip) của danh sách: lớn hơn → bảng xem không tự tải, báo + Tải về / "Vẫn mở".
 * Server nhận tối đa 6 MB nén. Đo 2026-11-19 (Chrome máy tính): bản thật 4,9 MB nén (8,7 MB chữ) mở 0,3 giây; bản dễ nén 5,7 MB nén (45 MB chữ)
 * 0,36 giây, heap ~176 MB. Ngưỡng 3 MB nén (≈ 5 MB chữ bản thật, ≤ ~25 MB chữ bản dễ nén) giữ an toàn cho máy yếu / điện thoại.
 */
export const TRANSCRIPT_VIEW_MAX_BYTES = 3 * 1024 * 1024;
