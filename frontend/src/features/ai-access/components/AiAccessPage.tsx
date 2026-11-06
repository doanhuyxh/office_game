import { useState } from 'react';
import { Ban, Check, KeyRound, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/common/alert-dialog';
import { Button } from '@/components/common/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/common/tabs';
import { Spinner } from '@/components/feedback/Spinner';
import { PageHeader } from '@/components/layout/PageHeader';
import { formatDate, formatDateTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { useAccessTokens, useRevokeAccessToken } from '../hooks/useAccessTokens';
import type { IAccessToken } from '../types/accessToken.types';
import { CLIENT_GUIDES, EXAMPLE_PROMPTS, mcpUrl, TOKEN_STATUS, tokenOrPlaceholder } from '../utils/labels';
import { CopyBlock } from './CopyBlock';
import { CreateTokenDialog } from './CreateTokenDialog';

const CAN = [
  'Xem chấm công hôm nay, bảng công tháng, ngày lễ, ca làm',
  'Chấm công vào / ra (luôn tính là làm việc từ xa)',
  'Xem quỹ phép, gửi đơn nghỉ phép, tăng ca, giải trình chấm công; huỷ đơn đang chờ',
  'Quản lý / HR: xem đơn chờ duyệt, duyệt / từ chối, xem chấm công và lịch nghỉ của nhóm',
  'Xem thông báo, tra danh bạ đồng nghiệp',
];
const CANNOT = [
  'Hợp đồng lao động, lương',
  'Đổi mật khẩu, tạo token mới, quản trị tài khoản / vai trò',
  'Thêm / sửa nhân viên, ca làm, ngày lễ, điều chỉnh quỹ phép',
];

/** Trang "Kết nối AI": tạo / thu hồi token và hướng dẫn kết nối Claude, Cursor, Codex với máy chủ MCP của OfficeHub. */
export function AiAccessPage() {
  const tokens = useAccessTokens();
  const revoke = useRevokeAccessToken();
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<IAccessToken | null>(null);
  const url = mcpUrl();

  const doRevoke = () => {
    if (!revoking) return;
    revoke.mutate(revoking.id, {
      onSuccess: () => toast.success(`Đã thu hồi "${revoking.name}"`),
      onError: (err) => toast.error(errorMessage(err)),
      onSettled: () => setRevoking(null),
    });
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Kết nối AI"
        description="Dùng trợ lý AI (Claude, Cursor, Codex…) để chấm công, xin nghỉ, xem bảng công… bằng lời nói thay vì mở web."
        actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> Tạo token</Button>}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Trợ lý AI làm được</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm">
              {CAN.map((t) => <li key={t} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" />{t}</li>)}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Không làm được qua AI</CardTitle>
            <CardDescription>Vẫn xem / thao tác trên web như bình thường.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm">
              {CANNOT.map((t) => <li key={t} className="flex gap-2"><X className="mt-0.5 size-4 shrink-0 text-destructive" />{t}</li>)}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Token của tôi</CardTitle>
          <CardDescription>
            Token cho trợ lý AI thao tác với quyền của bạn. Mỗi ứng dụng nên dùng một token riêng; không dùng nữa hoặc nghi bị lộ thì thu hồi.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tokens.isLoading ? <Spinner /> : !tokens.data?.length ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center text-sm text-muted-foreground">
              <KeyRound className="size-8" />
              Chưa có token nào.
              <Button size="sm" variant="outline" onClick={() => setCreating(true)}><Plus className="size-4" /> Tạo token đầu tiên</Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tên</TableHead>
                    <TableHead>Mã</TableHead>
                    <TableHead>Tạo ngày</TableHead>
                    <TableHead>Hết hạn</TableHead>
                    <TableHead>Dùng lần cuối</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead className="w-0" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tokens.data.map((t) => (
                    <TableRow key={t.id} className={t.status !== 'Active' ? 'text-muted-foreground' : undefined}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell className="font-mono text-xs">{t.prefix}…</TableCell>
                      <TableCell>{formatDate(t.createdAt)}</TableCell>
                      <TableCell>{formatDate(t.expiresAt)}</TableCell>
                      <TableCell>{t.lastUsedAt ? formatDateTime(t.lastUsedAt) : '—'}</TableCell>
                      <TableCell><StatusBadge tone={TOKEN_STATUS[t.status].tone}>{TOKEN_STATUS[t.status].label}</StatusBadge></TableCell>
                      <TableCell>
                        {t.status === 'Active' && (
                          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setRevoking(t)}>
                            <Ban className="size-4" /> Thu hồi
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hướng dẫn kết nối</CardTitle>
          <CardDescription>
            Địa chỉ máy chủ MCP: <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{url}</code>
            {newToken ? ' · Token vừa tạo đã được điền sẵn bên dưới (chỉ hiện đến khi rời trang).' : ' · Thay <TOKEN> bằng token bạn vừa tạo.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={CLIENT_GUIDES[0].id}>
            <TabsList className="flex-wrap">
              {CLIENT_GUIDES.map((g) => <TabsTrigger key={g.id} value={g.id}>{g.label}</TabsTrigger>)}
            </TabsList>
            {CLIENT_GUIDES.map((g) => (
              <TabsContent key={g.id} value={g.id} className="grid gap-3 pt-2">
                <p className="text-sm text-muted-foreground">{g.steps}</p>
                <CopyBlock label={g.where} value={g.snippet(url, tokenOrPlaceholder(newToken))} />
              </TabsContent>
            ))}
          </Tabs>
          <div className="mt-6 grid gap-2">
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

      <CreateTokenDialog open={creating} onOpenChange={setCreating} onCreated={setNewToken} />

      <AlertDialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Thu hồi token "{revoking?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>Trợ lý AI đang dùng token này sẽ mất kết nối ngay. Không hoàn tác được.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction onClick={doRevoke} disabled={revoke.isPending}>Thu hồi</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
