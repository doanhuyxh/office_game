import { useState } from 'react';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Spinner } from '@/components/feedback/Spinner';
import { useSocialAccounts } from '../../hooks/useAssets';
import { SOCIAL_STATUS, TOKEN_STATUS } from '../../utils/labels';
import { SocialAccountFormDialog } from '../social-account-form-dialog';
import { SocialAccountSheet } from '../social-account-sheet';

/** Tab MXH (HR): các Business Manager Facebook của công ty, người đang giữ, số trang, trạng thái token. Bấm dòng mở chi tiết. */
export function SocialAccountsTab({ creating, onCreatedClose }: { creating: boolean; onCreatedClose: () => void }) {
  const { data = [], isLoading } = useSocialAccounts();
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-1 gap-3">
      <p className="text-sm text-muted-foreground">
        Mỗi Business Manager lưu một token System User (mã hoá, không ai xem lại được) để đăng bài lên các Fanpage của BM. Bàn giao BM cho nhân viên
        → người đó đăng bài ở menu Đăng bài MXH. Không lưu mật khẩu đăng nhập Facebook.
      </p>
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
              <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Chưa có Business Manager nào.</TableCell></TableRow>
            )}
            {data.map((a) => (
              <TableRow key={a.id} className="cursor-pointer" onClick={() => setOpenId(a.id)} data-testid="social-row">
                <TableCell className="max-w-[18rem]">
                  <div className="truncate font-medium">{a.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{[a.externalId && `ID ${a.externalId}`, a.loginHint].filter(Boolean).join(' · ') || 'Facebook'}</div>
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
      <SocialAccountSheet accountId={openId} onClose={() => setOpenId(null)} />
      <SocialAccountFormDialog open={creating} onOpenChange={(o) => !o && onCreatedClose()} onCreated={(id) => setOpenId(id)} />
    </div>
  );
}
