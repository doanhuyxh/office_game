import { Columns3 } from 'lucide-react';
import { Button } from '@/components/common/button';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import type { ColumnState } from './useColumns';

/** Nút "Cột": tick chọn cột hiển thị của bảng (menu không đóng khi tick). Đặt ở hàng công cụ của bảng, căn phải. */
export function ColumnsMenu({ state, className }: { state: ColumnState; className?: string }) {
  const optional = state.columns.filter((c) => !c.required);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={className} data-testid="columns-menu">
          <Columns3 className="size-4" /> Cột
          {state.hiddenCount > 0 && <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">ẩn {state.hiddenCount}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Cột hiển thị</DropdownMenuLabel>
        {optional.map((c) => (
          <DropdownMenuCheckboxItem key={c.id} checked={state.show(c.id)} onCheckedChange={(v) => state.toggle(c.id, v === true)}
            onSelect={(e) => e.preventDefault()}>
            {c.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={state.hiddenCount === 0 && optional.every((c) => !c.defaultHidden)} onSelect={() => state.reset()}>
          Về mặc định
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
