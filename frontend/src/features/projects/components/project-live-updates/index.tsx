import { useEffect, useRef } from 'react';
import { useQueryClient, type Query, type QueryKey } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { toast } from 'sonner';
import { projectApi, projectKeys } from '../../api/project.api';
import type { IProjectActivity, ITaskDetail } from '../../types/project.types';
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
    case 'Follow': return `${who} thêm ${a.to ?? '?'} theo dõi ${a.taskCode}`;
    case 'Reviewer': return `${who} đặt người review ${a.taskCode}: ${a.to ?? 'không ai'}`;
    case 'StreakBlocked': return `${who} bị chặn ở ${a.taskCode} (thao tác ${a.to ?? ''} liên tiếp) — cần người thật xem`;
    case 'Unfollow': return `${who} bỏ ${a.from ?? '?'} khỏi người theo dõi ${a.taskCode}`;
    default: return `${who} sửa ${a.taskCode}: ${a.taskTitle}`;
  }
}

/**
 * Khoá cần làm mới khi có hoạt động mới (TEST-241 — thay cho invalidate cả tiền tố ['projects'], vốn tải lại mọi query dự án đang mở:
 * sổ tay, ngày công, tài chính, phụ lục…): mỗi dự án có hoạt động → chi tiết (đếm / tiến độ) + danh sách việc; mỗi việc → chi tiết việc + bình luận
 * (hộp thoại đang mở); thêm "việc của tôi" + danh sách dự án (đếm việc, tiến độ). Invalidate chỉ gọi lại query đang có người dùng, còn lại chỉ đánh dấu cũ.
 */
export function liveUpdateKeys(items: Pick<IProjectActivity, 'projectId' | 'taskId'>[]): QueryKey[] {
  const projects = [...new Set(items.map((a) => a.projectId))];
  const tasks = [...new Set(items.map((a) => a.taskId).filter(Boolean))];
  return [
    ...projects.flatMap((id) => [projectKeys.detail(id), projectKeys.tasks(id)]),
    ...tasks.flatMap((id) => [projectKeys.task(id), projectKeys.comments(id)]),
    projectKeys.myTasks,
    ['projects', 'list'],
  ];
}

/** Hộp thoại việc ĐANG MỞ của một dự án có hoạt động (vd việc nó chờ vừa xong / đổi phụ thuộc) — cũng làm mới phần "phải chờ" / "đang chờ việc này". */
const openTaskOf = (projects: Set<string>) => ({
  predicate: (q: Query) => q.queryKey[0] === 'projects' && q.queryKey[1] === 'task' && q.getObserversCount() > 0
    && projects.has((q.state.data as ITaskDetail | undefined)?.task.projectId ?? ''),
});

/**
 * Theo dõi thay đổi ở các dự án (hỏi /api/projects/activity mỗi 5 giây khi tab đang mở, con trỏ thời gian, bỏ trùng theo id):
 * có thay đổi → làm mới đúng dữ liệu liên quan (`liveUpdateKeys`: bảng việc, chi tiết dự án, hộp thoại việc + bình luận, việc của tôi);
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
            for (const queryKey of liveUpdateKeys(fresh)) void qc.invalidateQueries({ queryKey });
            void qc.invalidateQueries(openTaskOf(new Set(fresh.map((a) => a.projectId))));
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
