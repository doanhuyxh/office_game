import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Card, CardContent } from '@/components/common/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Label } from '@/components/common/label';
import { Textarea } from '@/components/common/textarea';
import { PATHS } from '@/config/paths';
import { cn } from '@/utils/cn';
import { formatDateTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { useApprove, useCancelApproval, useReject } from '../../hooks/useApprovals';
import type { IApproval } from '../../types/approval.types';
import { APPROVAL_STATUS, APPROVAL_TYPE, STEP_ICON } from '../../utils/labels';

export function ApprovalStatusBadge({ status }: { status: IApproval['status'] }) {
  return <StatusBadge tone={APPROVAL_STATUS[status].tone}>{APPROVAL_STATUS[status].label}</StatusBadge>;
}

/** Một đơn: tiêu đề, người gửi, tiến trình các bước duyệt, nút duyệt / từ chối / huỷ theo quyền (server trả canDecide, canCancel). */
export function ApprovalCard({ item, showRequester }: { item: IApproval; showRequester: boolean }) {
  const approve = useApprove();
  const reject = useReject();
  const cancel = useCancelApproval();
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');
  const onError = (e: unknown) => toast.error(errorMessage(e));

  return (
    <Card data-testid="approval-card">
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-xs text-muted-foreground">{APPROVAL_TYPE[item.type] ?? item.type} · gửi {formatDateTime(item.createdAt)}</div>
            <div className="font-semibold">{item.title}</div>
            {showRequester && (
              <div className="text-sm text-muted-foreground">
                {item.requester.code} · {item.requester.fullName}{item.requester.departmentName && ` · ${item.requester.departmentName}`}
              </div>
            )}
          </div>
          <ApprovalStatusBadge status={item.status} />
        </div>
        <p className="text-sm whitespace-pre-line">{item.summary}</p>
        {item.type === 'document_publish' && (
          <Link to={PATHS.documents} search={{ asset: item.subjectId }} className="justify-self-start text-sm text-primary hover:underline">Xem tài liệu</Link>
        )}
        <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {item.steps.map((s) => (
            <li key={s.order} className={cn(s.status === 'Rejected' && 'text-destructive', s.status === 'Approved' && 'text-success', s.status === 'Pending' && 'font-semibold')}>
              {STEP_ICON[s.status]} {s.kind === 'Manager' ? `Quản lý: ${s.approverName}` : 'HR'}
              {s.decidedByName && ` (${s.decidedByName}${s.onBehalfOfName ? `, duyệt thay ${s.onBehalfOfName}` : ''})`}
              {s.comment && <span className="text-muted-foreground"> — “{s.comment}”</span>}
            </li>
          ))}
        </ol>
        {item.canDecide && item.decideOnBehalfOfName && (
          <p className="text-xs text-info" data-testid="on-behalf-note">Bạn duyệt thay {item.decideOnBehalfOfName} (được uỷ quyền).</p>
        )}
        {(item.canDecide || item.canCancel) && (
          <div className="flex flex-wrap gap-2">
            {item.canDecide && (
              <>
                <Button size="sm" disabled={approve.isPending}
                  onClick={() => approve.mutate({ id: item.id }, { onSuccess: () => toast.success('Đã duyệt'), onError })}>
                  {item.decideOnBehalfOfName ? 'Duyệt thay' : 'Duyệt'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setComment(''); setRejecting(true); }}>Từ chối</Button>
              </>
            )}
            {item.canCancel && (
              <Button size="sm" variant="ghost" disabled={cancel.isPending}
                onClick={() => confirm('Huỷ đơn này?') && cancel.mutate(item.id, { onSuccess: () => toast.success('Đã huỷ đơn'), onError })}>Huỷ đơn</Button>
            )}
          </div>
        )}
      </CardContent>
      <Dialog open={rejecting} onOpenChange={setRejecting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Từ chối: {item.title}</DialogTitle>
            <DialogDescription>Người gửi sẽ thấy lý do này.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="reject-comment">Lý do *</Label>
            <Textarea id="reject-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(false)}>Huỷ</Button>
            <Button variant="destructive" disabled={!comment.trim() || reject.isPending}
              onClick={() => reject.mutate({ id: item.id, comment }, { onSuccess: () => { toast.success('Đã từ chối'); setRejecting(false); }, onError })}>
              Từ chối
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
