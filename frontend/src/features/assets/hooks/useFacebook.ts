import { useQuery } from '@tanstack/react-query';
import { facebookApi, facebookKeys } from '../api/facebook.api';

/** Facebook Business Manager (Tài sản → MXH → Facebook BM). Ghi dữ liệu: `useAssetMutation` (useAssets.ts) + `facebookApi`. */
export const useFacebookAccounts = (enabled = true) => useQuery({ queryKey: facebookKeys.accounts, queryFn: facebookApi.accounts, enabled });
export const useFacebookAccount = (id: string | null) =>
  useQuery({ queryKey: facebookKeys.account(id ?? ''), queryFn: () => facebookApi.account(id!), enabled: !!id });
