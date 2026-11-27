import { useBranding } from '../../hooks/useBranding';

/** Tên công ty (mặc định "OfficeHub"). */
export function BrandName({ className }: { className?: string }) {
  const { name } = useBranding();
  return <span className={className} data-testid="brand-name">{name}</span>;
}
