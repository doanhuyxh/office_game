/** Khung thẻ chung của các khối: tiêu đề + phụ đề + link / nút bên phải. */
export function BlockCard({ title, hint, action, children, testId }: { title: string; hint?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <section className="min-w-0 rounded-xl border bg-card" data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{title}</h2>
          {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
