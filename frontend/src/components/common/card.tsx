import type { HTMLAttributes } from 'react';
import { cn } from '@/utils/cn';

type DivProps = HTMLAttributes<HTMLDivElement>;

export const Card = ({ className, ...p }: DivProps) => (
  <div className={cn('rounded-xl border bg-card text-card-foreground shadow-sm', className)} {...p} />
);
export const CardHeader = ({ className, ...p }: DivProps) => <div className={cn('flex flex-col gap-1.5 p-6', className)} {...p} />;
export const CardTitle = ({ className, ...p }: DivProps) => <div className={cn('font-semibold leading-none tracking-tight', className)} {...p} />;
export const CardDescription = ({ className, ...p }: DivProps) => <div className={cn('text-sm text-muted-foreground', className)} {...p} />;
export const CardContent = ({ className, ...p }: DivProps) => <div className={cn('p-6 pt-0', className)} {...p} />;
