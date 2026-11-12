/**
 * Nguồn ảnh / video được tự tải trong trang (TEST-22): cùng domain OfficeHub và S3 (`*.amazonaws.com` — file tải lên của công ty).
 * Ảnh / video từ nơi khác (do người dùng dán vào Markdown, link media của việc) KHÔNG tự tải — hiện thành link bấm mở,
 * tránh ảnh theo dõi (lộ IP / thời điểm xem của đồng nghiệp) và file rất nặng. Đổi danh sách → sửa cả `img-src` / `media-src` CSP nếu cần.
 */
const TRUSTED_HOST_SUFFIXES = ['.amazonaws.com'];

export function isTrustedMediaUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url, window.location.origin);
    if (u.origin === window.location.origin) return true;
    return u.protocol === 'https:' && TRUSTED_HOST_SUFFIXES.some((s) => u.hostname.endsWith(s));
  } catch {
    return false;
  }
}
