// Public API của module Phê duyệt.
export { ApprovalStatusBadge } from './components/approval-card';
export { useInboxCount, useCancelApproval } from './hooks/useApprovals';
export { approvalKeys } from './api/approval.api';
export type { IApproval, ApprovalStatus } from './types/approval.types';
