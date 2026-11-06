import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accessTokenApi, accessTokenKeys } from '../api/accessToken.api';

export const useAccessTokens = () => useQuery({ queryKey: accessTokenKeys.all, queryFn: accessTokenApi.list });

export function useCreateAccessToken() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: accessTokenApi.create, onSuccess: () => qc.invalidateQueries({ queryKey: accessTokenKeys.all }) });
}

export function useRevokeAccessToken() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: accessTokenApi.revoke, onSuccess: () => qc.invalidateQueries({ queryKey: accessTokenKeys.all }) });
}
