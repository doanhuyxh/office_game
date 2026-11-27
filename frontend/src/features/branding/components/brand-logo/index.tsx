import { Building2 } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/utils/cn';
import { useBranding } from '../../hooks/useBranding';

/**
 * Logo công ty (ô vuông 32 px) — chưa có logo / ảnh lỗi → biểu tượng toà nhà trên nền màu chủ đạo như trước (TEST-261).
 * `tileClassName` đổi màu nền ô mặc định (vd sidebar dùng `bg-sidebar-primary`).
 */
export function BrandLogo({ className, tileClassName = 'bg-primary text-primary-foreground' }: { className?: string; tileClassName?: string }) {
  const { name, logoUrl } = useBranding();
  const [broken, setBroken] = useState<string | null>(null);
  if (logoUrl && broken !== logoUrl)
    return <img src={logoUrl} alt={name} className={cn('size-8 shrink-0 rounded-lg object-contain', className)} onError={() => setBroken(logoUrl)} data-testid="brand-logo" />;
  return (
    <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', tileClassName, className)}>
      <Building2 className="size-4" />
    </div>
  );
}
