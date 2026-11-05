import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { PATHS } from '@/config/paths';
import { authApi, authKeys } from '../api/auth.api';

export function useLogout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    await authApi.logout().catch(() => {});
    qc.setQueryData(authKeys.me, null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== authKeys.me[0] });
    navigate({ to: PATHS.login });
  };
}
