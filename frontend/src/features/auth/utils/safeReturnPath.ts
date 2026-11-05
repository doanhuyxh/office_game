/** Chỉ cho quay lại đường dẫn nội bộ sau khi đăng nhập (chống open redirect). */
export function safeReturnPath(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, location.origin);
    return u.origin === location.origin ? u.pathname + u.search + u.hash : null;
  } catch {
    return null;
  }
}
