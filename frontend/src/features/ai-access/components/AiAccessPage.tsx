import { useState } from 'react';
import { AppWindow, Ban, Check, KeyRound, Plus, X } from 'lucide-react';
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
import { hasRole, useMe } from '@/features/auth';
import { formatDate, formatDateTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import {
  useAccessTokens, useAiActivity, useAiConnections, useGrants, useRevokeAccessToken, useRevokeGrant,
} from '../hooks/useAccessTokens';
import { TOKEN_STATUS } from '../utils/labels';
import { ActivityTable } from './ActivityTable';
import { ConnectGuide } from './ConnectGuide';
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

/** Thứ cần thu hồi: token cá nhân hoặc ứng dụng OAuth. */
interface RevokeTarget { kind: 'token' | 'app'; id: string; name: string; owner?: string }

function useRevoke() {
  const revokeToken = useRevokeAccessToken();
  const revokeGrant = useRevokeGrant();
  const [target, setTarget] = useState<RevokeTarget | null>(null);
  const pending = revokeToken.isPending || revokeGrant.isPending;
  const confirm = () => {
    if (!target) return;
    const m = target.kind === 'token' ? revokeToken : revokeGrant;
    m.mutate(target.id, {
      onSuccess: () => toast.success(`Đã thu hồi "${target.name}"`),
      onError: (err) => toast.error(errorMessage(err)),
      onSettled: () => setTarget(null),
    });
  };
  const dialog = (
    <AlertDialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Thu hồi {target?.kind === 'app' ? 'ứng dụng' : 'token'} "{target?.name}"{target?.owner ? ` của ${target.owner}` : ''}?</AlertDialogTitle>
          <AlertDialogDescription>Trợ lý AI đang dùng sẽ mất kết nối ngay. Không hoàn tác được.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Huỷ</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} disabled={pending}>Thu hồi</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { ask: setTarget, dialog };
}

const RevokeButton = ({ onClick }: { onClick: () => void }) => (
  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onClick}>
    <Ban className="size-4" /> Thu hồi
  </Button>
);

function MyTab({ onCreate, newToken }: { onCreate: () => void; newToken: string | null }) {
  const tokens = useAccessTokens();
  const grants = useGrants();
  const activity = useAiActivity();
  const revoke = useRevoke();

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Trợ lý AI làm được</CardTitle></CardHeader>
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

      <ConnectGuide newToken={newToken} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ứng dụng đã kết nối</CardTitle>
          <CardDescription>Ứng dụng bạn đã bấm "Cho phép" (đăng nhập OAuth). Tự gia hạn khi còn dùng; không dùng 30 ngày sẽ hết hạn.</CardDescription>
        </CardHeader>
        <CardContent>
          {grants.isLoading ? <Spinner /> : !grants.data?.length ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
              <AppWindow className="size-8" />Chưa kết nối ứng dụng nào.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ứng dụng</TableHead>
                    <TableHead>Kết nối ngày</TableHead>
                    <TableHead>Dùng lần cuối</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead className="w-0" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grants.data.map((g) => (
                    <TableRow key={g.id} className={g.status !== 'Active' ? 'text-muted-foreground' : undefined}>
                      <TableCell className="font-medium">{g.clientName}</TableCell>
                      <TableCell>{formatDate(g.createdAt)}</TableCell>
                      <TableCell>{g.lastUsedAt ? formatDateTime(g.lastUsedAt) : '—'}</TableCell>
                      <TableCell><StatusBadge tone={TOKEN_STATUS[g.status].tone}>{TOKEN_STATUS[g.status].label}</StatusBadge></TableCell>
                      <TableCell>{g.status === 'Active' && <RevokeButton onClick={() => revoke.ask({ kind: 'app', id: g.id, name: g.clientName })} />}</TableCell>
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
          <CardTitle className="text-base">Token của tôi</CardTitle>
          <CardDescription>
            Cho ứng dụng không đăng nhập được bằng trình duyệt. Mỗi ứng dụng một token riêng; không dùng nữa hoặc nghi bị lộ thì thu hồi.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tokens.isLoading ? <Spinner /> : !tokens.data?.length ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center text-sm text-muted-foreground">
              <KeyRound className="size-8" />
              Chưa có token nào.
              <Button size="sm" variant="outline" onClick={onCreate}><Plus className="size-4" /> Tạo token</Button>
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
                      <TableCell>{t.status === 'Active' && <RevokeButton onClick={() => revoke.ask({ kind: 'token', id: t.id, name: t.name })} />}</TableCell>
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
          <CardTitle className="text-base">Hoạt động gần đây</CardTitle>
          <CardDescription>Mọi thao tác trợ lý AI đã làm thay bạn (lưu 180 ngày).</CardDescription>
        </CardHeader>
        <CardContent><ActivityTable rows={activity.data} loading={activity.isLoading} /></CardContent>
      </Card>
      {revoke.dialog}
    </div>
  );
}

function CompanyTab() {
  const connections = useAiConnections(true);
  const [userId, setUserId] = useState<string | null>(null);
  const activity = useAiActivity({ all: true, userId });
  const revoke = useRevoke();
  const selected = connections.data?.find((c) => c.userId === userId);

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Kết nối AI đang hoạt động</CardTitle>
          <CardDescription>
            Token và ứng dụng của mọi nhân viên. Thu hồi khi nhân viên mất máy, nghỉ việc hoặc có dấu hiệu lạm dụng.
            Tắt kết nối AI cho cả công ty: đặt <code className="font-mono text-xs">AccessTokens__Enabled=false</code> trong .env rồi khởi động lại Api.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {connections.isLoading ? <Spinner /> : !connections.data?.length ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Chưa ai kết nối trợ lý AI.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nhân viên</TableHead>
                    <TableHead>Loại</TableHead>
                    <TableHead>Tên</TableHead>
                    <TableHead>Dùng lần cuối</TableHead>
                    <TableHead>Hết hạn</TableHead>
                    <TableHead className="w-0" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {connections.data.map((c) => (
                    <TableRow key={`${c.kind}-${c.id}`}>
                      <TableCell>
                        <button type="button" className="text-left hover:underline" onClick={() => setUserId(c.userId)}>
                          <div className="font-medium">{c.fullName}</div>
                          <div className="text-xs text-muted-foreground">{c.userName}</div>
                        </button>
                      </TableCell>
                      <TableCell><StatusBadge tone={c.kind === 'app' ? 'info' : 'muted'}>{c.kind === 'app' ? 'Ứng dụng' : 'Token'}</StatusBadge></TableCell>
                      <TableCell>{c.name}</TableCell>
                      <TableCell>{c.lastUsedAt ? formatDateTime(c.lastUsedAt) : '—'}</TableCell>
                      <TableCell>{formatDate(c.expiresAt)}</TableCell>
                      <TableCell><RevokeButton onClick={() => revoke.ask({ kind: c.kind, id: c.id, name: c.name, owner: c.fullName })} /></TableCell>
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
          <CardTitle className="text-base">Nhật ký AI {selected ? `— ${selected.fullName}` : 'toàn công ty'}</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2">
            Bấm tên nhân viên ở bảng trên để lọc.
            {userId && <Button size="sm" variant="link" className="h-auto p-0" onClick={() => setUserId(null)}>Xem tất cả</Button>}
          </CardDescription>
        </CardHeader>
        <CardContent><ActivityTable rows={activity.data} loading={activity.isLoading} showUser /></CardContent>
      </Card>
      {revoke.dialog}
    </div>
  );
}

/** Trang "Kết nối AI": đăng nhập OAuth / token cho trợ lý AI (Claude, Cursor, Codex, GitHub Copilot), ứng dụng đã kết nối, nhật ký; HR xem toàn công ty. */
export function AiAccessPage() {
  const me = useMe();
  const isHr = hasRole(me.data, 'admin', 'hr');
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Kết nối AI"
        description="Dùng trợ lý AI (Claude, Cursor, Codex, GitHub Copilot…) để chấm công, xin nghỉ, xem bảng công… bằng lời nói thay vì mở web."
        actions={<Button variant="outline" onClick={() => setCreating(true)}><Plus className="size-4" /> Tạo token</Button>}
      />
      {isHr ? (
        <Tabs defaultValue="me">
          <TabsList>
            <TabsTrigger value="me">Của tôi</TabsTrigger>
            <TabsTrigger value="company">Toàn công ty</TabsTrigger>
          </TabsList>
          <TabsContent value="me" className="pt-2"><MyTab onCreate={() => setCreating(true)} newToken={newToken} /></TabsContent>
          <TabsContent value="company" className="pt-2"><CompanyTab /></TabsContent>
        </Tabs>
      ) : (
        <MyTab onCreate={() => setCreating(true)} newToken={newToken} />
      )}
      <CreateTokenDialog open={creating} onOpenChange={setCreating} onCreated={setNewToken} />
    </div>
  );
}
