import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/common/tabs';
import { CLIENT_GUIDES, type ConnectMode, EXAMPLE_PROMPTS, mcpUrl, tokenOrPlaceholder } from '../../utils/labels';
import { CopyBlock } from '../copy-block';

/** Hướng dẫn kết nối từng ứng dụng: "Đăng nhập" (OAuth, khuyên dùng) hoặc "Token" (dán token cá nhân). */
export function ConnectGuide({ newToken }: { newToken: string | null }) {
  const url = mcpUrl();
  const [mode, setMode] = useState<ConnectMode>(newToken ? 'token' : 'oauth');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Hướng dẫn kết nối</CardTitle>
        <CardDescription>
          Địa chỉ máy chủ MCP: <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{url}</code>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as ConnectMode)}>
          <TabsList>
            <TabsTrigger value="oauth">Đăng nhập (khuyên dùng)</TabsTrigger>
            <TabsTrigger value="token">Dùng token</TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="text-sm text-muted-foreground">
          {mode === 'oauth'
            ? 'Ứng dụng mở trang OfficeHub để bạn đăng nhập và bấm "Cho phép" — không cần chép token. Ứng dụng tự gia hạn; thu hồi ở mục "Ứng dụng đã kết nối".'
            : newToken
              ? 'Token vừa tạo đã được điền sẵn bên dưới (chỉ hiện đến khi rời trang).'
              : 'Dùng khi ứng dụng không mở được trình duyệt (máy chủ, CI…). Tạo token rồi thay <TOKEN> bên dưới.'}
        </p>
        {(() => {
          const guides = CLIENT_GUIDES.filter((g) => g[mode]);
          return (
            <Tabs key={mode} defaultValue={guides[0].id}>
              <TabsList className="flex-wrap group-data-[orientation=horizontal]/tabs:h-auto">
                {guides.map((g) => <TabsTrigger key={g.id} value={g.id}>{g.label}</TabsTrigger>)}
              </TabsList>
              {guides.map((g) => {
                const step = g[mode]!;
                const snippet = mode === 'oauth'
                  ? g.oauth!.snippet?.(url)
                  : g.token!.snippet(url, tokenOrPlaceholder(newToken));
                return (
                  <TabsContent key={g.id} value={g.id} className="grid gap-3 pt-2">
                    <p className="text-sm text-muted-foreground">{step.steps}</p>
                    {snippet && <CopyBlock label={step.where} value={snippet} />}
                  </TabsContent>
                );
              })}
            </Tabs>
          );
        })()}
        <div className="grid gap-2">
          <p className="text-sm font-medium">Thử hỏi trợ lý:</p>
          <ul className="grid gap-1 text-sm text-muted-foreground">
            {EXAMPLE_PROMPTS.map((p) => <li key={p}>“{p}”</li>)}
          </ul>
          <p className="text-xs text-muted-foreground">
            Trợ lý sẽ hỏi lại trước khi gửi đơn, chấm công hay duyệt đơn. Chấm công qua AI luôn được ghi là làm việc từ xa.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
