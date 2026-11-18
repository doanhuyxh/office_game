/** GET /api/projects/public/upload-links/{token}: chỉ mã việc + hạn + giới hạn (không tên việc, mô tả, bình luận, id). */
export interface IPublicUploadLink { taskCode: string; expiresAt: string; fileCount: number; maxFiles: number; maxFilesPerComment: number }
/** POST …/{token}/comments → tổng số tệp đã gửi qua link. */
export interface IPublicUploadDone { fileCount: number }
