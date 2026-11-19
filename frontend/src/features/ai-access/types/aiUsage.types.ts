// Khớp DTO `/api/ai-usage/*` (backend Modules/Audit/Features/AiSessionUsageEndpoints.cs, Domain/AiSessionLedger.cs) — TEST-134 / TEST-136.

export type AiUsageGroupBy = 'day' | 'month' | 'year';
export type AiSessionKind = 'task' | 'chat' | 'meeting' | 'other';
export type AiSessionStatus = 'done' | 'failed' | 'skipped';

export interface IAiUsageFilter {
  group: AiUsageGroupBy;
  /** yyyy-MM-dd (lịch VN); null = mặc định của BE theo nhóm. */
  from: string | null;
  to: string | null;
  kind: AiSessionKind | null;
  /** Trạng thái phiên (TEST-195); null = mọi trạng thái. */
  status: AiSessionStatus | null;
  /** null = của tôi; 'all' / id tài khoản — chỉ admin / HR. */
  userId: string | null;
}

/** Một (kỳ × model). `costUsd` = tổng chi phí có; `costMissing` = số phiên của model này không có chi phí. */
export interface IAiUsageModelGroup {
  bucket: string;
  model: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  costMissing: number;
}

/** Tổng một kỳ (`bucket`) hoặc cả khoảng (`bucket` null) — đếm theo phiên. */
export interface IAiUsageTotal {
  bucket: string | null;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  costMissing: number;
}

export interface IAiUsageSummary {
  from: string;
  to: string;
  group: AiUsageGroupBy;
  userId: string | null;
  groups: IAiUsageModelGroup[];
  buckets: IAiUsageTotal[];
  total: IAiUsageTotal;
}

export interface IAiSessionModel {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costUsd: number | null;
}

export interface IAiSession {
  id: string;
  userId: string;
  userName: string | null;
  fullName: string | null;
  sourceId: string;
  kind: AiSessionKind;
  taskId: string | null;
  projectId: string | null;
  taskCode: string | null;
  executor: string;
  status: 'done' | 'failed' | 'skipped';
  startedAt: string;
  finishedAt: string;
  durationSeconds: number;
  turns: number | null;
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  models: IAiSessionModel[];
}
