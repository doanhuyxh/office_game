import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { toast } from 'sonner';
import { projectApi, projectKeys } from '../../api/project.api';
import type { IProjectActivity } from '../../types/project.types';
import { stateLabel } from '../../utils/labels';

const INTERVAL = 5000;
/** Quá từng này thay đổi của một dự án trong một lần hỏi → gộp thành một toast. */
const GROUP_AFTER = 2;

/** "🤖 Bot Thợ chuyển TEST-1 → Đang làm". */
export function describeActivity(a: IProjectActivity): string {
  const who = `${a.byBot ? '🤖 ' : ''}${a.actorName}`;
  switch (a.kind) {
    case 'Created': return `${who} tạo việc ${a.taskCode}: ${a.taskTitle}`;
    case 'Moved': return `${who} chuyển ${a.taskCode} → ${stateLabel(a.to) || '?'}`;
    case 'Assigned': return `${who} giao ${a.taskCode} cho ${a.to ?? 'không ai'}`;
    case 'DueChanged': return `${who} đổi hạn ${a.taskCode}`;
    case 'Depends': return `${who} đổi việc phải chờ của ${a.taskCode}`;
    case 'Commented': return `${who} bình luận ${a.taskCode}: ${a.text ?? ''}`;
    case 'CommentDeleted': return `${who} xoá một bình luận ở ${a.taskCode}`;
    default: return `${who} sửa ${a.taskCode}: ${a.taskTitle}`;
  }
}

/**
 * Theo dõi thay đổi ở các dự án (hỏi /api/projects/activity mỗi 5 giây khi tab đang mở, con trỏ thời gian, bỏ trùng theo id):
 * có thay đổi → làm mới dữ liệu dự án (bảng việc, hộp thoại việc, việc của tôi tự cập nhật);
 * toast chỉ khi KHÔNG đang xem đúng dự án đó (ở trang khác / dự án khác) và mình là thành viên. Gắn một lần ở Header, không vẽ gì.
 */
export function ProjectLiveUpdates() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    let cursor: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let stopped = false;
    const seen = new Set<string>();

    const notify = (items: IProjectActivity[]) => {
      const current = /^\/projects\/([0-9a-f-]{36})/i.exec(pathRef.current)?.[1];
      const byProject = new Map<string, IProjectActivity[]>();
      for (const a of items) {
        if (!a.member || a.projectId === current) continue;
        byProject.set(a.projectId, [...(byProject.get(a.projectId) ?? []), a]);
      }
      for (const [projectId, list] of byProject) {
        const open = { label: 'Mở', onClick: () => void navigate({ to: '/projects/$projectId', params: { projectId } }) };
        if (list.length > GROUP_AFTER)
          toast(`${list.length} cập nhật mới trong dự án`, { description: `${list[0].projectName} · ${describeActivity(list[list.length - 1])}`, action: open });
        else for (const a of list) toast(describeActivity(a), { description: a.projectName, action: open });
      }
    };

    const tick = async () => {
      if (running || stopped) return;
      clearTimeout(timer);
      running = true;
      try {
        if (document.visibilityState === 'visible') {
          const feed = await projectApi.activity(cursor);
          const fresh = cursor === null ? [] : feed.items.filter((a) => !seen.has(a.id));
          cursor = feed.cursor;
          for (const a of feed.items) seen.add(a.id);
          if (seen.size > 2000) [...seen].slice(0, 1000).forEach((id) => seen.delete(id));
          if (fresh.length > 0) {
            void qc.invalidateQueries({ queryKey: projectKeys.all });
            notify(fresh);
          }
        }
      } catch {
        // mất mạng / hết phiên: thử lại lần sau
      } finally {
        running = false;
        if (!stopped) timer = setTimeout(() => void tick(), INTERVAL);
      }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void tick(); };

    void tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [qc, navigate]);

  return null;
}
