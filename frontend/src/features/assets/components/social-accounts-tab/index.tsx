import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Spinner } from '@/components/feedback/Spinner';
import { useSocialAccounts } from '../../hooks/useAssets';
import { FACEBOOK_PLATFORM, PLATFORM_UNSUPPORTED, SOCIAL_PLATFORMS, SOCIAL_STATUS, TOKEN_STATUS } from '../../utils/labels';
import { SocialAccountFormDialog } from '../social-account-form-dialog';
import { SocialAccountSheet } from '../social-account-sheet';

/**
 * Tab MXH (HR), chia theo nền tảng (`SOCIAL_PLATFORMS`): Facebook Business Manager (BM) — các BM của công ty, người đang giữ, số trang, trạng thái token
 * (bấm dòng mở chi tiết; nút "Thêm BM Facebook" ở đầu trang); Zalo OA, TikTok — chưa hỗ trợ, chỉ hiển thị, không thao tác / gọi API.
 * BM đang dùng có token lỗi (job kiểm tra mỗi 5 giờ / đăng bài phát hiện) → hộp cảnh báo đầu bảng + badge đỏ (trên điện thoại hiện ngay dưới tên BM).
 */
export function SocialAccountsTab({ creating, onCreatedClose }: { creating: boolean; onCreatedClose: () => void }) {
  const { data = [], isLoading } = useSocialAccounts();
  const [openId, setOpenId] = useState<string | null>(null);
  const broken = data.filter((a) => a.status === 'Active' && a.tokenStatus === 'Invalid');
  return (
    <div className="grid grid-cols-1 gap-6">
      <section className="grid grid-cols-1 gap-3" data-testid="social-platform-facebook">
        <h2 className="text-base font-semibold">{FACEBOOK_PLATFORM.label}</h2>
        <p className="text-sm text-muted-foreground">
          Mỗi Business Manager lưu một token System User (mã hoá, không ai xem lại được) để đăng bài lên các Fanpage của BM. Bàn giao BM cho nhân viên
          → người đó đăng bài ở menu Đăng bài MXH. Không lưu mật khẩu đăng nhập Facebook.
        </p>
        {broken.length > 0 && (
          <div className="grid gap-1 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm" role="alert" data-testid="social-token-broken">
            <p className="flex items-center gap-2 font-medium text-destructive">
              <TriangleAlert className="size-4 shrink-0" /> {broken.length} BM có token lỗi — không đăng bài được
            </p>
            <p className="text-muted-foreground">
              {broken.map((a) => a.name).join(', ')}. Mở BM → tạo token System User mới rồi bấm Thay token. Hệ thống tự kiểm tra token mỗi 5 giờ.
            </p>
          </div>
        )}
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business Manager</TableHead><TableHead>Người giữ</TableHead><TableHead>Trang</TableHead>
                <TableHead className="hidden md:table-cell">Token</TableHead><TableHead className="hidden lg:table-cell">Phòng ban</TableHead>
                <TableHead>Trạng thái</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={6}><Spinner /></TableCell></TableRow>}
              {!isLoading && data.length === 0 && (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Chưa có Facebook Business Manager nào.</TableCell></TableRow>
              )}
              {data.map((a) => (
                <TableRow key={a.id} className="cursor-pointer" onClick={() => setOpenId(a.id)} data-testid="social-row">
                  <TableCell className="max-w-[18rem]">
                    <div className="truncate font-medium">{a.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{[a.externalId && `ID ${a.externalId}`, a.loginHint].filter(Boolean).join(' · ') || 'Facebook'}</div>
                    {a.tokenStatus === 'Invalid' && (
                      <StatusBadge className="mt-1 md:hidden" tone={TOKEN_STATUS.Invalid.tone}>{TOKEN_STATUS.Invalid.label}</StatusBadge>
                    )}
                  </TableCell>
                  <TableCell>{a.holderName ? <>{a.holderName} <span className="text-xs text-muted-foreground">({a.holderCode})</span></> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="tabular-nums">{a.pageCount}</TableCell>
                  <TableCell className="hidden md:table-cell"><StatusBadge tone={TOKEN_STATUS[a.tokenStatus].tone}>{TOKEN_STATUS[a.tokenStatus].label}</StatusBadge></TableCell>
                  <TableCell className="hidden lg:table-cell">{a.ownerDepartmentName ?? '—'}</TableCell>
                  <TableCell><StatusBadge tone={SOCIAL_STATUS[a.status].tone}>{SOCIAL_STATUS[a.status].label}</StatusBadge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {SOCIAL_PLATFORMS.filter((p) => !p.supported).map((p) => (
          <section key={p.key} className="grid content-start gap-1.5 rounded-xl border bg-card p-4" data-testid={`social-platform-${p.key}`}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{p.label}</h2>
              <StatusBadge tone={PLATFORM_UNSUPPORTED.tone}>{PLATFORM_UNSUPPORTED.label}</StatusBadge>
            </div>
            <p className="text-sm text-muted-foreground">{p.note}</p>
          </section>
        ))}
      </div>
      <SocialAccountSheet accountId={openId} onClose={() => setOpenId(null)} />
      <SocialAccountFormDialog open={creating} onOpenChange={(o) => !o && onCreatedClose()} onCreated={(id) => setOpenId(id)} />
    </div>
  );
}
