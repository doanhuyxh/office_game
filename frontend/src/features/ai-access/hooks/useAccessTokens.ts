import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IPageQuery } from '@/types/api';
import { accessTokenApi, accessTokenKeys } from '../api/accessToken.api';

export const useAccessTokens = () => useQuery({ queryKey: accessTokenKeys.tokens, queryFn: accessTokenApi.list });
export const useGrants = () => useQuery({ queryKey: accessTokenKeys.grants, queryFn: accessTokenApi.grants });
/** HR: kết nối AI của cả công ty theo trang. */
export const useAiConnectionsPage = (q: IPageQuery, enabled = true) =>
  useQuery({ queryKey: accessTokenKeys.connectionsPage(q), queryFn: () => accessTokenApi.connectionsPage(q), enabled, placeholderData: (prev) => prev });
/** Nhật ký AI theo trang (BE cắt trang). `all` (HR) = mọi người, lọc theo `userId` nếu có; không thì của tôi. */
export const useAiActivityPage = (opts: { all?: boolean; userId?: string | null; query: IPageQuery }) =>
  useQuery({
    queryKey: accessTokenKeys.activityPage(opts.all ? opts.userId : null, opts.all, opts.query),
    queryFn: () => accessTokenApi.activityPage(opts.all ? opts.userId : null, opts.all, opts.query),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: accessTokenKeys.all });
}

export function useCreateAccessToken() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: accessTokenApi.create, onSuccess: invalidate });
}

export function useRevokeAccessToken() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: accessTokenApi.revoke, onSuccess: invalidate });
}

export function useRevokeGrant() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: accessTokenApi.revokeGrant, onSuccess: invalidate });
}

/** Webhook cá nhân — hỏi lại 5 giây khi đang có lần gửi chờ (để thấy kết quả "Gửi thử"). */
export const useWebhook = () =>
  useQuery({
    queryKey: accessTokenKeys.webhook, queryFn: accessTokenApi.webhook,
    refetchInterval: (q) => (q.state.data?.recent.some((d) => d.status === 'Pending') ? 5000 : false),
  });
