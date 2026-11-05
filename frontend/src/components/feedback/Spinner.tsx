/** Vòng xoay toàn trang — dùng khi đang tải màn hình (lazy) hoặc dữ liệu. */
export function Spinner({ label = 'Đang tải…' }: { label?: string }) {
  return (
    <div className="grid min-h-[50vh] place-items-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        {label}
      </div>
    </div>
  );
}
