import { PATHS } from '@/config/paths';
import type { INotificationTarget } from '../types/notification.types';
import { linkTarget } from './labels';

/** Đích điều hướng cho `navigate({ to, search })`. */
export interface IRoute {
  to: string;
  search?: Record<string, string>;
}

const withSearch = (to: string, search: Record<string, string | undefined | null>): IRoute => {
  const s = Object.fromEntries(Object.entries(search).filter((e): e is [string, string] => !!e[1]));
  return Object.keys(s).length ? { to, search: s } : { to };
};

/** Khoá trang của loại `page` (khớp BE NotificationLinkBuilder): chữ thường / số / '-' / '/', không bắt đầu bằng '/'. */
const PAGE_KEY = /^([a-z0-9-]+(\/[a-z0-9-]+)*)?$/;

/**
 * TEST-237: đối tượng thông báo (`target`) → màn hình web, theo từng loại (BE `NotificationTargetTypes`). Khớp `NotificationLinkBuilder` ở BE:
 * màn hình chưa mở được theo id (phê duyệt, lịch họp, hợp đồng, phiếu lương, tài sản, đề nghị chi) vẫn về trang danh sách.
 * Loại chưa biết → null (người gọi quay về `link`).
 */
export function targetToRoute(t: INotificationTarget | null | undefined): IRoute | null {
  if (!t) return null;
  const p = t.params ?? {};
  const id = t.id ?? '';
  switch (t.type) {
    case 'project_task':
      return p.projectId && id ? withSearch(`${PATHS.projects}/${p.projectId}`, { task: id, comment: p.commentId }) : null;
    case 'project':
      return id ? withSearch(`${PATHS.projects}/${id}`, { tab: p.tab, page: p.tab ? p.page : undefined }) : null;
    case 'wiki_share':
      return p.projectId ? withSearch(`${PATHS.projects}/${p.projectId}`, { tab: 'wiki', page: p.pageId }) : null;
    case 'approval_request':
    case 'approval_delegation':
      return { to: PATHS.approvals };
    case 'chat_conversation':
      return id ? { to: PATHS.chat, search: { c: id } } : null;
    case 'news_post':
      return id ? withSearch(`${PATHS.news}/${id}`, { comment: p.commentId }) : null;
    case 'meeting_booking':
      return { to: PATHS.meetings };
    case 'labor_contract':
      return { to: PATHS.contracts };
    case 'payslip':
      return { to: PATHS.payslips };
    case 'asset_device':
    case 'asset_service':
    case 'asset_review':
    case 'asset_handover':
      return { to: PATHS.assets };
    case 'employee':
      return { to: p.view === 'assets' ? PATHS.assets : PATHS.employees };
    case 'social_account':
      return p.view === 'posts' ? { to: PATHS.socialFacebook } : { to: PATHS.assets, search: { tab: 'social', platform: 'facebook' } };
    case 'social_post':
      return { to: PATHS.socialFacebook };
    case 'document_asset':
      return id ? { to: PATHS.documents, search: { asset: id } } : null;
    case 'expense_request':
      return { to: PATHS.finance };
    case 'sales_customer':
      return id ? { to: PATHS.sales, search: { customer: id } } : null;
    case 'sales_contract':
      return p.customerId ? { to: PATHS.sales, search: { customer: p.customerId } } : null;
    case 'sales_receivable':
      return { to: PATHS.sales, search: { tab: 'receivables' } };
    case 'profile_change_request':
      return { to: p.view === 'profile' ? PATHS.profile : PATHS.employees };
    case 'page': {
      const { key, ...query } = p;
      if (key === undefined || !PAGE_KEY.test(key)) return null;
      return withSearch(`/${key}`, query);
    }
    default:
      return null;
  }
}

/** Đích của một thông báo: theo `target`; thiếu / loại chưa biết → tách `link` (client G1, thông báo cũ). */
export function notificationRoute(n: { target?: INotificationTarget | null; link?: string | null }): IRoute | null {
  return targetToRoute(n.target) ?? (n.link ? linkTarget(n.link) : null);
}

/** Đích từ `data` của push FCM (map chuỗi: targetType / targetId / targetParams JSON + link). */
export function pushRoute(data: Record<string, string> | undefined): IRoute | null {
  if (!data) return null;
  let params: Record<string, string> | null = null;
  try {
    params = data.targetParams ? (JSON.parse(data.targetParams) as Record<string, string>) : null;
  } catch {
    params = null;
  }
  const target = data.targetType ? { type: data.targetType, id: data.targetId ?? null, params } : null;
  return notificationRoute({ target, link: data.link });
}

/** Chuỗi URL của đích (mở tab mới ở văn phòng ảo). */
export function routeHref(r: IRoute): string {
  return r.search ? `${r.to}?${new URLSearchParams(r.search).toString()}` : r.to;
}
