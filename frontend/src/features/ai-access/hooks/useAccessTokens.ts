import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accessTokenApi, accessTokenKeys } from '../api/accessToken.api';

export const useAccessTokens = () => useQuery({ queryKey: accessTokenKeys.tokens, queryFn: accessTokenApi.list });
export const useGrants = () => useQuery({ queryKey: accessTokenKeys.grants, queryFn: accessTokenApi.grants });
/** HR. */
export const useAiConnections = (enabled: boolean) =>
  useQuery({ queryKey: accessTokenKeys.connections, queryFn: accessTokenApi.connections, enabled });
/** `all` (HR) = mọi người, lọc theo `userId` nếu có; không thì của tôi. */
export const useAiActivity = (opts: { all?: boolean; userId?: string | null; enabled?: boolean } = {}) =>
  useQuery({
    queryKey: accessTokenKeys.activity(opts.userId, opts.all),
    queryFn: () => accessTokenApi.activity(opts.all ? opts.userId : null),
    enabled: opts.enabled ?? true,
    refetchInterval: 30_000,
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
