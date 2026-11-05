// Public API của module Phê duyệt.
export { ApprovalsPage } from './components/ApprovalsPage';
export { ApprovalStatusBadge } from './components/ApprovalCard';
export { useInboxCount, useCancelApproval } from './hooks/useApprovals';
export { approvalKeys } from './api/approval.api';
export type { IApproval, ApprovalStatus } from './types/approval.types';
