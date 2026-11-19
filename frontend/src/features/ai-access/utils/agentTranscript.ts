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
