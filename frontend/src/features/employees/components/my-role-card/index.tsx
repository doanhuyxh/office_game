import { useState } from 'react';
import { Bot, ChevronDown } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/common/collapsible';
import { cn } from '@/utils/cn';
import { useMyRole } from '../../hooks/useOrg';
import { GuideText } from '../guide-text';

function Section({ title, sub, description, guide, defaultOpen }: { title: string; sub?: string; description: string | null; guide: string | null; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  if (!description && !guide) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border">
      <CollapsibleTrigger className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left">
        <span>
          <span className="text-sm font-medium">{title}</span>{sub && <span className="ml-1 text-xs text-muted-foreground">{sub}</span>}
          {description && <span className="block text-xs text-muted-foreground">{description}</span>}
        </span>
        {guide && <ChevronDown className={cn('mt-0.5 size-4 shrink-0 transition-transform', open && 'rotate-180')} />}
      </CollapsibleTrigger>
      {guide && <CollapsibleContent className="border-t px-3 py-2"><GuideText text={guide} /></CollapsibleContent>}
    </Collapsible>
  );
}

/** "Vai trò của tôi" — đúng nội dung tool MCP get_my_role trả cho trợ lý AI. Ẩn với tài khoản không có hồ sơ nhân viên. */
export function MyRoleCard() {
  const { data } = useMyRole();
  if (!data) return null;
  const { me, position, departments, manager, headOf } = data;
  const hasGuides = !!position?.description || !!position?.guide || departments.some((d) => d.description || d.guide);
  return (
    <Card data-testid="my-role">
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5"><Bot className="size-4" /> Vai trò của tôi · trợ lý AI của bạn cũng đọc nội dung này</CardDescription>
        <CardTitle className="text-lg">{[me.jobTitle, position?.name].filter(Boolean).join(' · ') || 'Chưa có chức danh / chức vụ'}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {departments.length > 0 ? departments.map((d) => d.name).join(' › ') : 'Chưa thuộc phòng ban'}
          {manager && ` · Quản lý: ${manager.fullName}`}
          {headOf.length > 0 && ` · Trưởng: ${headOf.join(', ')}`}
        </p>
      </CardHeader>
      <CardContent className="grid gap-2">
        {position && <Section title={`Chức vụ: ${position.name}`} sub={`cấp ${position.level}`} description={position.description} guide={position.guide} defaultOpen />}
        {departments.map((d, i) => (
          <Section key={d.id} title={i === 0 ? `Phòng: ${d.name}` : `Phòng cấp trên: ${d.name}`} sub={d.headName ? `trưởng: ${d.headName}` : undefined}
            description={d.description} guide={d.guide} defaultOpen={i === 0} />
        ))}
        {!hasGuides && <p className="text-sm text-muted-foreground">HR chưa soạn mô tả / hướng dẫn cho chức vụ và phòng ban của bạn.</p>}
      </CardContent>
    </Card>
  );
}
