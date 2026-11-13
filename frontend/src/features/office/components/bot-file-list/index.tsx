import { useState } from 'react';
import { formatTime } from '@/utils/date';
import type { BotWatchEventDto } from '../../types/office.types';
import { BotDiff, diffStat } from '../bot-activity-event';

/** Một file agent đã sửa trong phiên đang xem — gộp từ các sự kiện `file_edit` / `file_write` cùng `path`. */
export interface BotFileSummary {
  path: string;
  /** Các lần sửa theo thứ tự thời gian (`seq` tăng dần). */
  edits: BotWatchEventDto[];
  added: number;
  removed: number;
  /** Có lần ghi cả file (`file_write`) → nhãn "Mới". */
  created: boolean;
  /** Có lần sửa không kèm `diff` (file nhạy cảm — runner chỉ gửi đường dẫn). */
  hidden: boolean;
  /** `seq` / `at` của lần sửa gần nhất. */
  lastSeq: number;
  lastAt: string;
}

/**
 * Gộp sự kiện sửa / ghi file theo đường dẫn, file sửa gần nhất đứng đầu. Chỉ tính trên các sự kiện đang có trong bộ nhớ (phiên hiện tại,
 * ≤ 200 thao tác gần nhất — `use-bot-watch` đã bỏ phiên cũ khi có `session_start`); lần sửa lỗi (`ok = false`) không làm đổi file nên bỏ qua.
 */
export function summarizeFiles(events: BotWatchEventDto[]): BotFileSummary[] {
  const byPath = new Map<string, BotFileSummary>();
  for (const e of events) {
    if ((e.kind !== 'file_edit' && e.kind !== 'file_write') || e.ok === false) continue;
    const path = e.path ?? e.title ?? '(không rõ đường dẫn)';
    let f = byPath.get(path);
    if (!f) byPath.set(path, f = { path, edits: [], added: 0, removed: 0, created: false, hidden: false, lastSeq: e.seq, lastAt: e.at });
    const { added, removed } = diffStat(e.diff);
    f.edits.push(e);
    f.added += added;
    f.removed += removed;
    if (e.kind === 'file_write') f.created = true;
    if (!e.diff) f.hidden = true;
    if (e.seq >= f.lastSeq) { f.lastSeq = e.seq; f.lastAt = e.at; }
  }
  return [...byPath.values()].sort((a, b) => b.lastSeq - a.lastSeq);
}

/**
 * Tab "File đã sửa" của bảng "Màn hình của bot" (TEST-100): mỗi file một dòng (số lần sửa, tổng dòng + / -, giờ sửa gần nhất, nhãn "Mới"),
 * bấm để mở các diff của file đó theo thứ tự thời gian. File đổi sau khi mở tab → dòng nháy nhẹ. Không gọi API, không lưu — danh sách
 * tính từ sự kiện trong RAM nên chỉ là phần người xem đã nhận được (ghi chú cuối tab). Đường dẫn / diff do agent sinh ra → chữ thuần.
 */
export function BotFileList({ files }: { files: BotFileSummary[] }) {
  const [openPath, setOpenPath] = useState<string | null>(null);
  // Mốc lúc mở tab: chỉ nháy file đổi SAU đó (mở tab không nháy cả danh sách)
  const [baseline] = useState(() => files[0]?.lastSeq ?? 0);

  return (
    <div className="bot-act-log bot-act-files" data-testid="office-bot-files">
      {files.length === 0 && <p className="bot-act-empty" data-testid="office-bot-files-empty">Chưa sửa file nào trong phiên này</p>}
      {files.map((f) => {
        const open = openPath === f.path;
        const noDiff = f.edits.every((e) => !e.diff);
        return (
          <div key={f.path} className="bot-file" data-path={f.path}>
            {/* key đổi theo lần sửa gần nhất → nút dựng lại, hiệu ứng nháy chạy lại */}
            <button key={`${f.lastSeq}:${f.edits.length}:${f.added}:${f.removed}`} type="button" aria-expanded={open}
              className={`bot-file-row${f.lastSeq > baseline ? ' flash' : ''}`} onClick={() => setOpenPath(open ? null : f.path)}>
              <span className="caret" aria-hidden>{open ? '▾' : '▸'}</span>
              <code>{f.path}</code>
              {f.created && <em className="bot-file-new">Mới</em>}
              <span className="bot-file-stat">
                {noDiff ? <small>nội dung ẩn</small> : <><b className="add">+{f.added}</b> <b className="del">-{f.removed}</b></>}
                <small>{f.edits.length} lần · {formatTime(f.lastAt)}</small>
              </span>
            </button>
            {open && (
              <div className="bot-file-diffs">
                {f.edits.map((e) => (
                  <div key={e.id} data-id={e.id}>
                    <small>{formatTime(e.at)} · {e.kind === 'file_write' ? 'Ghi file' : 'Sửa'}</small>
                    {e.diff ? <BotDiff text={e.diff} /> : <small className="bot-file-hidden">Nội dung ẩn (file nhạy cảm)</small>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <p className="bot-file-note">Chỉ gồm thay đổi từ lúc bạn bắt đầu xem và 200 thao tác gần nhất</p>
    </div>
  );
}
