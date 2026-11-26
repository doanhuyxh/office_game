// Public API của module Dự án (thành viên, mốc nghiệm thu, công việc, ngày công).
export { ProjectLiveUpdates } from './components/project-live-updates';
// Loader route /projects/$projectId (routes/router.tsx, TEST-241): tải chi tiết + việc song song với chunk trang.
export { prefetchProject } from './hooks/useProjects';
export { AgentLimitsCard } from './components/agent-limits-card';
// Tệp đính kèm bình luận việc — trang công khai link tải lên (features/upload-link, TEST-175) dùng chung quy tắc / PUT S3.
export { MAX_COMMENT_FILES, fileProblem, formatBytes, isImageFile, putToS3 } from './utils/attachments';
export type { ICommentUploadTicket } from './types/project.types';
