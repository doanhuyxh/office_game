import { http, httpDownload, httpStream, pageQs } from '@/services/api-client';
import type { IPaged, IPageQuery } from '@/types/api';
import type { IAgentTranscript, IAgentTranscriptFilter } from '../types/agentTranscript.types';

export const agentTranscriptKeys = {
  all: ['agent-transcripts'] as const,
  list: (f: IAgentTranscriptFilter, q: IPageQuery) => ['agent-transcripts', 'list', f, q] as const,
};

function filterQs(f: IAgentTranscriptFilter) {
  const p = new URLSearchParams();
  if (f.userId) p.set('userId', f.userId);
  if (f.kind) p.set('kind', f.kind);
  return p.toString();
}

/** Transcript phiên agent (TEST-144 / TEST-145) — chỉ admin / HR đăng nhập web; quyền kiểm ở BE (người khác / token AI → 403). */
export const agentTranscriptApi = {
  list: (f: IAgentTranscriptFilter, q: IPageQuery) => {
    const qs = filterQs(f);
    return http<IPaged<IAgentTranscript>>(`/api/agent-transcripts?${qs ? `${qs}&` : ''}${pageQs(q)}`);
  },
  /** Tải `transcript-<kind>-<key>.jsonl.gz` (đã giải mã); bản hết hạn → ApiError 404. */
  download: (t: Pick<IAgentTranscript, 'id' | 'kind' | 'key'>) =>
    httpDownload(`/api/agent-transcripts/${t.id}/download`, `transcript-${t.kind}-${t.key.replace(/[^A-Za-z0-9_-]/g, '_')}.jsonl.gz`),
  /** Mở luồng `.jsonl.gz` để xem nhanh trên web (TEST-197) — cùng endpoint tải về; không lưu cache. */
  open: (id: string, signal?: AbortSignal) => httpStream(`/api/agent-transcripts/${id}/download`, signal),
};
