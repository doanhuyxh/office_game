import { useMemo, useState } from 'react';
import { Ban, Bot, Search } from 'lucide-react';
import { Badge } from '@/components/common/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { Input } from '@/components/common/input';
import { PageHeader } from '@/components/layout/PageHeader';
import { cn } from '@/utils/cn';
import { MCP_EXCLUDED, MCP_SERVER, MCP_TOOL_COUNT, MCP_TOOL_GROUPS, type McpTool } from '../../utils/catalog';

const KIND: Record<McpTool['kind'], { label: string; variant: 'secondary' | 'default' | 'destructive' }> = {
  read: { label: 'Chỉ đọc', variant: 'secondary' },
  write: { label: 'Ghi', variant: 'default' },
  destructive: { label: 'Ghi · cần xác nhận', variant: 'destructive' },
};

function ToolCard({ t }: { t: McpTool }) {
  const kind = KIND[t.kind];
  return (
    <Card className="gap-3" data-testid="mcp-tool">
      <CardHeader className="gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{t.title}</CardTitle>
          <Badge variant={kind.variant}>{kind.label}</Badge>
          {t.idempotent && <Badge variant="outline">Idempotent</Badge>}
        </div>
        <code className="font-mono text-xs text-primary">{t.name}</code>
        <CardDescription className="text-xs">{t.description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="text-xs">
          <span className="text-muted-foreground">Gọi API: </span>
          <code className="font-mono">{t.endpoint}</code>
        </div>
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Tham số</span>
          {t.params.length === 0 ? (
            <span className="text-xs text-muted-foreground/80">Không có</span>
          ) : (
            <ul className="grid gap-1.5">
              {t.params.map((p) => (
                <li key={p.name} className="grid gap-0.5 rounded-md border bg-muted/30 px-2 py-1.5 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <code className="font-mono font-medium">{p.name}</code>
                    <span className="text-muted-foreground">{p.type}</span>
                    <Badge variant={p.required ? 'default' : 'outline'} className="px-1.5 py-0 text-[10px]">
                      {p.required ? 'bắt buộc' : 'tuỳ chọn'}
                    </Badge>
                    {p.default !== undefined && <span className="text-muted-foreground/80">mặc định: {p.default}</span>}
                  </div>
                  <span className="text-muted-foreground">{p.description}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Trang quản trị: danh mục công cụ máy chủ MCP OfficeHub (chỉ admin — PAGE_ROLES). Dữ liệu từ utils/catalog.ts (bảo trì thủ công). */
export function McpToolsPage() {
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return MCP_TOOL_GROUPS;
    return MCP_TOOL_GROUPS
      .map((g) => ({ ...g, tools: g.tools.filter((t) => `${t.name} ${t.title} ${t.description}`.toLowerCase().includes(kw)) }))
      .filter((g) => g.tools.length > 0);
  }, [q]);
  const shown = groups.reduce((n, g) => n + g.tools.length, 0);

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Công cụ AI (MCP)" />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Bot className="size-4 text-muted-foreground" /> Máy chủ {MCP_SERVER.name}</CardTitle>
          <CardDescription>Trợ lý AI của nhân viên kết nối tới máy chủ này để thao tác thay họ, chạy đúng quyền của người dùng.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2 text-sm">
            <div><span className="text-muted-foreground">Endpoint: </span><code className="font-mono text-xs">{MCP_SERVER.endpoint}</code></div>
            <div><span className="text-muted-foreground">Giao thức: </span>{MCP_SERVER.transport}</div>
            <div><span className="text-muted-foreground">Xác thực: </span>{MCP_SERVER.auth}</div>
            <div><span className="text-muted-foreground">Số công cụ: </span><span className="font-medium">{MCP_TOOL_COUNT}</span></div>
            <p className="text-xs text-muted-foreground">{MCP_SERVER.note}</p>
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Không mở cho AI</span>
            <ul className="grid gap-1 text-xs text-muted-foreground">
              {MCP_EXCLUDED.map((x) => <li key={x} className="flex gap-1.5"><Ban className="mt-0.5 size-3.5 shrink-0 text-destructive" />{x}</li>)}
            </ul>
          </div>
        </CardContent>
      </Card>

      <div className="relative max-w-sm">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Tìm công cụ theo tên hoặc mô tả…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="mcp-search" />
      </div>

      {shown === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Không có công cụ nào khớp "{q}".</p>
      ) : (
        groups.map((g) => (
          <section key={g.name} className="grid gap-3">
            <h2 className={cn('text-sm font-semibold')}>{g.name} <span className="text-muted-foreground">({g.tools.length})</span></h2>
            <div className="grid gap-4 lg:grid-cols-2">
              {g.tools.map((t) => <ToolCard key={t.name} t={t} />)}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
