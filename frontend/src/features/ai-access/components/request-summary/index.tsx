import { Link } from '@tanstack/react-router';

/** Tên trường hay gặp trong body lệnh ghi → nhãn tiếng Việt; trường lạ giữ nguyên tên. */
const FIELD_LABEL: Record<string, string> = {
  body: 'Nội dung',
  title: 'Tiêu đề',
  description: 'Mô tả',
  status: 'Trạng thái',
  statusId: 'Cột trạng thái',
  note: 'Ghi chú',
  reason: 'Lý do',
  comment: 'Bình luận',
  assigneeId: 'Người làm',
  dueDate: 'Hạn',
  priority: 'Ưu tiên',
  name: 'Tên',
  date: 'Ngày',
  from: 'Từ',
  to: 'Đến',
  startTime: 'Bắt đầu',
  endTime: 'Kết thúc',
};

const META_LABEL: Record<string, string> = {
  form: 'Tải tệp / form',
  binary: 'Dữ liệu nhị phân',
  too_large: 'Nội dung quá lớn, không lưu',
  truncated: 'Nội dung quá lớn, không lưu',
  invalid_json: 'Nội dung không phải JSON',
};

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'Có' : 'Không';
  return JSON.stringify(v, null, 1);
}

/** Id dự án trong path Api (`/api/projects/{guid}/…`) → link sang trang dự án. */
function projectIdOf(path: string): string | null {
  return /^\/api\/projects\/([0-9a-f-]{36})(\/|$)/i.exec(path)?.[1] ?? null;
}

/** Nội dung lệnh ghi của trợ lý AI (AiRequestDto.requestSummary — BE đã cắt + che trường nhạy cảm, chỉ giữ 7 ngày). */
export function RequestSummary({ summary, path }: { summary: string | null | undefined; path: string }) {
  const projectId = projectIdOf(path);
  let data: unknown = null;
  try {
    data = summary ? JSON.parse(summary) : null;
  } catch {
    data = null;
  }
  const obj = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  const meta = obj && typeof obj._type === 'string' ? obj._type : null;

  return (
    <div className="space-y-2 text-sm" data-testid="ai-request-summary">
      {!summary ? (
        <p className="text-muted-foreground">Không có nội dung (lệnh không gửi dữ liệu, hoặc đã quá 7 ngày lưu).</p>
      ) : meta ? (
        <p className="text-muted-foreground">
          {META_LABEL[meta] ?? meta}
          {typeof obj?.bytes === 'number' && ` · ${(obj.bytes / 1024).toFixed(1)} KB`}
        </p>
      ) : obj ? (
        <dl className="grid grid-cols-[minmax(6rem,max-content)_1fr] gap-x-4 gap-y-1">
          {Object.entries(obj).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{FIELD_LABEL[k] ?? k}</dt>
              <dd className="whitespace-pre-wrap wrap-break-word">{formatValue(v)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <pre className="whitespace-pre-wrap wrap-break-word font-mono text-xs">{summary}</pre>
      )}
      {projectId && (
        <Link to="/projects/$projectId" params={{ projectId }} className="text-primary hover:underline">
          Mở dự án →
        </Link>
      )}
    </div>
  );
}
