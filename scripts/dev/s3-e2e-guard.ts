// Chặn e2e ghi file thử lẫn vào dữ liệu thật trên bucket (TEST-156): Api tạm của e2e dùng S3 thật phải chạy với S3__KeyPrefix=e2e/
// → mọi khoá nằm dưới e2e/files/…, dọn một lần bằng prefix. Gọi với link presigned đầu tiên Api trả (PUT / GET) TRƯỚC khi tải file lên.

/** Link presigned trỏ vào khoá dưới e2e/files/ (path-style /bucket/e2e/files/… hoặc virtual-host /e2e/files/…); không → dừng script. */
export function assertE2eS3Key(url: string): void {
  const path = decodeURIComponent(new URL(url).pathname);
  if (!/(^|\/)e2e\/files\//.test(path))
    throw new Error(`Link S3 không nằm dưới e2e/files/ (${path.slice(0, 80)}…) — chạy Api tạm với S3__KeyPrefix=e2e/ để file thử không lẫn dữ liệu thật`);
}
