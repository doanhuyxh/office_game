/**
 * Khung xám nhấp nháy giả dạng dòng hoạt động (TEST-190) — hiện trong bảng "Màn hình của bot" khi đang kết nối, chưa có sự kiện
 * (tab Hoạt động + tab File đã sửa). `prefers-reduced-motion` → đứng yên (CSS).
 */
export function BotActSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="bot-act-skel" aria-hidden data-testid="office-bot-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="bot-act-skel-row">
          <span className="dot" />
          <span className="bar" style={{ width: `${[72, 54, 86, 63][i % 4]}%` }} />
        </div>
      ))}
    </div>
  );
}
