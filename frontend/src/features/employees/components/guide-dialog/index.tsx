import { useEffect, useState } from 'react';
import { Bot, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { Label } from '@/components/common/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/common/tabs';
import { Textarea } from '@/components/common/textarea';
import { Spinner } from '@/components/feedback/Spinner';
import { formatDateTime } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useDepartmentDetail, useGuideTemplates, usePositionDetail, useSaveGuide } from '../../hooks/useOrg';
import { GuideText } from '../guide-text';

const DESC_MAX = 2_000; // khớp OrgGuide.DescriptionMax (BE)
const GUIDE_MAX = 40_000; // khớp OrgGuide.GuideMax

export type GuideTarget = { kind: 'department' | 'position'; id: string; name: string } | null;

/** Xem / sửa mô tả + hướng dẫn. Quyền sửa do BE quyết định (canEditGuide): HR; phòng ban thì thêm trưởng phòng đó. */
export function GuideDialog({ target, onClose }: { target: GuideTarget; onClose: () => void }) {
  const dept = useDepartmentDetail(target?.kind === 'department' ? target.id : null);
  const pos = usePositionDetail(target?.kind === 'position' ? target.id : null);
  const detail = target?.kind === 'department' ? dept : pos;
  const templates = useGuideTemplates();
  const save = useSaveGuide();
  const [description, setDescription] = useState('');
  const [guide, setGuide] = useState('');
  const [tab, setTab] = useState('edit');
  const data = detail.data;
  const canEdit = data?.canEditGuide ?? false;
  const errors = fieldErrors(save.error);

  useEffect(() => {
    if (!target) { save.reset(); return; }
    if (data) { setDescription(data.guide.description ?? ''); setGuide(data.guide.guide ?? ''); setTab(data.canEditGuide ? 'edit' : 'view'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, data?.guide.guideUpdatedAt, data?.canEditGuide]);

  const template = target?.kind === 'department' ? templates.data?.department : templates.data?.position;
  const submit = () => target && save.mutate({ kind: target.kind, id: target.id, description: description.trim() || null, guide: guide.trim() || null }, {
    onSuccess: () => { toast.success('Đã lưu mô tả & hướng dẫn'); onClose(); },
    onError: (e) => !Object.keys(fieldErrors(e)).length && toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{target?.kind === 'department' ? 'Phòng ban' : 'Chức vụ'}: {target?.name}</DialogTitle>
          <DialogDescription className="flex items-start gap-1.5">
            <Bot className="mt-0.5 size-4 shrink-0" />
            Mọi nhân viên và trợ lý AI (MCP) của họ đọc được nội dung này để hiểu vai trò, trách nhiệm. Không ghi thông tin nhạy cảm (lương, mật khẩu…).
          </DialogDescription>
        </DialogHeader>
        {detail.isLoading || !data ? <Spinner /> : (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              {canEdit && <TabsTrigger value="edit">Soạn</TabsTrigger>}
              <TabsTrigger value="view">Xem</TabsTrigger>
            </TabsList>
            {canEdit && (
              <TabsContent value="edit" className="grid gap-4 pt-2">
                <div className="grid gap-2">
                  <Label htmlFor="g-desc">Mô tả ngắn</Label>
                  <Textarea id="g-desc" rows={2} maxLength={DESC_MAX} value={description} onChange={(e) => setDescription(e.target.value)}
                    placeholder={target?.kind === 'department' ? 'Vd: Phụ trách tuyển dụng, chấm công, chính sách nhân sự' : 'Vd: Quản lý một phòng, chịu trách nhiệm kết quả của phòng'} />
                  <p className="text-xs text-muted-foreground">{description.length.toLocaleString('vi-VN')}/{DESC_MAX.toLocaleString('vi-VN')} · hiện ở danh sách và trợ lý AI dùng để tìm đúng phòng / cấp</p>
                  {errors.description && <p className="text-xs text-destructive">{errors.description}</p>}
                </div>
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="g-guide">Hướng dẫn chi tiết (Markdown)</Label>
                    {template && <Button type="button" size="sm" variant="outline" onClick={() => setGuide((g) => (g.trim() ? `${g.trimEnd()}\n\n${template}` : template))}>
                      <FileText className="size-4" /> Chèn khung mẫu</Button>}
                  </div>
                  <Textarea id="g-guide" rows={14} maxLength={GUIDE_MAX} className="font-mono text-xs" value={guide} onChange={(e) => setGuide(e.target.value)}
                    placeholder={'## Trách nhiệm chính\n- …\n\n## Đầu mối liên hệ\n- Việc … → liên hệ …'} />
                  <p className="text-xs text-muted-foreground">{guide.length.toLocaleString('vi-VN')}/{GUIDE_MAX.toLocaleString('vi-VN')} · hỗ trợ ## tiêu đề, - gạch đầu dòng, **đậm**</p>
                  {errors.guide && <p className="text-xs text-destructive">{errors.guide}</p>}
                </div>
              </TabsContent>
            )}
            <TabsContent value="view" className="grid gap-3 pt-2">
              {!description && !guide && <p className="text-sm text-muted-foreground">Chưa có mô tả / hướng dẫn.</p>}
              {description && <p className="text-sm text-muted-foreground">{description}</p>}
              {guide && <div className="rounded-md border p-4"><GuideText text={guide} /></div>}
              {data.guide.guideUpdatedAt && <p className="text-xs text-muted-foreground">Cập nhật {formatDateTime(data.guide.guideUpdatedAt)}{data.guide.guideUpdatedByName ? ` bởi ${data.guide.guideUpdatedByName}` : ''}</p>}
            </TabsContent>
          </Tabs>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Đóng</Button>
          {canEdit && <Button onClick={submit} disabled={save.isPending}>Lưu</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
