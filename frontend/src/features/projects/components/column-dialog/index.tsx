import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Check, Info, Maximize2, Minimize2, Plus, Trash2, X } from 'lucide-react';
import { BotBadge } from '@/components/common/bot-badge';
import { Button } from '@/components/common/button';
import { confirmDialog } from '@/components/common/confirm-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Label } from '@/components/common/label';
import { SelectField } from '@/components/common/SelectField';
import { Switch } from '@/components/common/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/common/tooltip';
import { cn } from '@/utils/cn';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { projectApi } from '../../api/project.api';
import { useProjectMutation } from '../../hooks/useProjects';
import type { IMember, ITaskColumn, ITaskColumnRequest } from '../../types/project.types';
import { COLUMN_PALETTE } from '../../utils/labels';
import { MarkdownEditor } from '../markdown-editor';

/** Độ dài tối đa hướng dẫn của cột — khớp TaskColumnRules.MaxGuide (back-end). */
const MAX_GUIDE = 10_000;

/** Biểu tượng (i): phần giải thích dài của một lựa chọn nằm trong tooltip để hộp thoại gọn, dễ quét mắt. */
function InfoTip({ children, label }: { children: ReactNode; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={label}><Info className="size-3.5" /></button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{children}</TooltipContent>
    </Tooltip>
  );
}

/** Một dòng lựa chọn bật / tắt: tên + mô tả ngắn một dòng + (i) giải thích + công tắc bên phải. */
function SwitchRow({ id, title, hint, info, checked, disabled, onChange }: {
  id: string; title: string; hint: string; info: ReactNode; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <Label htmlFor={id} className="cursor-pointer">{title}</Label>
          <InfoTip label={`Giải thích: ${title}`}>{info}</InfoTip>
        </div>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} className="mt-0.5" checked={checked} disabled={disabled} onCheckedChange={onChange} data-testid={id} />
    </div>
  );
}

/**
 * Thêm / sửa / xoá một trạng thái (cột) công việc — chỉ hiện với chức vụ có quyền "Quản lý trạng thái công việc" (back-end kiểm).
 * `column`: undefined = đóng, null = thêm mới (cuối bảng). Xoá cột còn việc → chọn cột nhận việc.
 * "Đánh thức bot theo dõi" (TEST-184): chọn bot thành viên dự án được đánh thức ở cột (không chọn = mọi bot theo dõi việc); back-end kiểm bot / thành viên.
 * Hướng dẫn cho bot ở cột (TEST-186): chỉ soạn khi bật đánh thức; tắt thì không gửi `guide` → nội dung đã lưu giữ nguyên (bật lại không mất).
 * Bố cục (TEST-189): bật đánh thức → hai cột "Cài đặt" | "Hướng dẫn cho bot" (màn hẹp: hai tab), khung soạn cao hết hộp thoại (một thanh cuộn),
 * phóng to được; tắt → một cột hẹp. Thanh đáy cố định: Xoá (trái) · Huỷ · Lưu.
 */
export function ColumnDialog({ projectId, column, columns, members, onClose }: {
  projectId: string; column: ITaskColumn | null | undefined; columns: ITaskColumn[]; members: IMember[]; onClose: () => void;
}) {
  const open = column !== undefined;
  const [f, setF] = useState<ITaskColumnRequest>({ name: '', color: COLUMN_PALETTE[0], isDone: false, approverOnly: false, wakeFollowers: false, wakeBotIds: [] });
  const bots = members.filter((m) => m.isBot);
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [guide, setGuide] = useState('');
  const [guidePreview, setGuidePreview] = useState(false);
  const [tab, setTab] = useState<'settings' | 'guide'>('settings');
  const [maxed, setMaxed] = useState(false);
  const [picking, setPicking] = useState(false);
  const save = useProjectMutation((b: ITaskColumnRequest): Promise<unknown> => (column ? projectApi.updateColumn(column.id, b) : projectApi.createColumn(projectId, b)));
  const remove = useProjectMutation((a: { id: string; moveTo: string | null }) => projectApi.deleteColumn(a.id, a.moveTo));
  const others = columns.filter((c) => c.id !== column?.id);
  useEffect(() => {
    if (!open) return;
    save.reset(); remove.reset(); setMoveTo(null); setTab('settings'); setMaxed(false); setPicking(false);
    setGuide(column?.guide ?? ''); setGuidePreview(!!column?.guide);
    // Bot đã rời dự án không hiện ở danh sách → bỏ khỏi lựa chọn (lưu lại sẽ xoá).
    const botIds = (column?.wakeBotIds ?? []).filter((id) => bots.some((b) => b.employeeId === id));
    setF(column ? { name: column.name, color: column.color, isDone: column.isDone, approverOnly: column.approverOnly, wakeFollowers: !!column.wakeFollowers, wakeBotIds: botIds }
      : { name: '', color: COLUMN_PALETTE[columns.length % COLUMN_PALETTE.length], isDone: false, approverOnly: false, wakeFollowers: false, wakeBotIds: [] });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open, column?.id]);
  const errors = fieldErrors(save.error);
  const set = <K extends keyof ITaskColumnRequest>(k: K, v: ITaskColumnRequest[K]) => setF((x) => ({ ...x, [k]: v }));
  const toggleBot = (id: string, on: boolean) => setF((x) => ({ ...x, wakeBotIds: on ? [...x.wakeBotIds, id] : x.wakeBotIds.filter((b) => b !== id) }));
  const picked = bots.filter((b) => f.wakeBotIds.includes(b.employeeId));
  const unpicked = bots.filter((b) => !f.wakeBotIds.includes(b.employeeId));
  const lastDone = !!column?.isDone && !others.some((c) => c.isDone);
  const wide = f.wakeFollowers;
  const del = async () => {
    if (!column) return;
    if (column.taskCount > 0 && !moveTo) { setTab('settings'); toast.error('Chọn trạng thái để chuyển việc sang trước khi xoá'); return; }
    const target = others.find((c) => c.id === moveTo)?.name;
    if (!(await confirmDialog({ title: `Xoá trạng thái "${column.name}"?`, destructive: true, confirmText: 'Xoá',
      description: column.taskCount > 0 ? `${column.taskCount} việc sẽ chuyển sang "${target}".` : undefined,
      onConfirm: () => remove.mutateAsync({ id: column.id, moveTo }) }))) return;
    toast.success('Đã xoá trạng thái'); onClose();
  };
  const tabBtn = (v: 'settings' | 'guide', text: string, alert?: boolean) => (
    <button type="button" role="tab" aria-selected={tab === v} onClick={() => setTab(v)} data-testid={`col-tab-${v}`}
      className={cn('flex-1 rounded-md px-2 py-1.5 text-sm whitespace-nowrap', tab === v ? 'bg-background font-medium shadow-xs' : 'text-muted-foreground hover:text-foreground')}>
      {text}{alert && <span className="ml-1 inline-block size-1.5 rounded-full bg-destructive align-middle" aria-label="có lỗi" />}
    </button>
  );
  const settingsErr = !!(errors.name || errors.color || errors.isDone || errors.wakeBotIds);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="column-dialog" data-layout={wide ? 'two-column' : 'single'}
        className={cn('flex flex-col gap-0 overflow-hidden p-0',
          maxed ? 'h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none sm:max-w-none'
            : wide ? 'h-[92dvh] sm:max-w-5xl' : 'max-h-[92dvh] sm:max-w-md')}>
        <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
          <DialogTitle>{column ? `Sửa trạng thái "${column.name}"` : 'Thêm trạng thái'}</DialogTitle>
        </DialogHeader>
        {wide && !maxed && (
          <div className="shrink-0 px-6 pt-3 lg:hidden">
            <div className="flex rounded-lg bg-muted p-[3px]" role="tablist" aria-label="Phần của hộp thoại">
              {tabBtn('settings', 'Cài đặt', settingsErr)}{tabBtn('guide', 'Hướng dẫn cho bot', !!errors.guide)}
            </div>
          </div>
        )}
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ ...f, name: f.name.trim(), wakeBotIds: f.wakeFollowers ? f.wakeBotIds : [], ...(f.wakeFollowers ? { guide } : {}) }, {
            onSuccess: () => { toast.success(column ? 'Đã lưu trạng thái' : 'Đã thêm trạng thái'); onClose(); },
            onError: (err) => {
              const fe = fieldErrors(err);
              if (fe.guide && !(fe.name || fe.color || fe.isDone || fe.wakeBotIds)) setTab('guide'); else if (Object.keys(fe).length) { setTab('settings'); setMaxed(false); }
              if (!Object.keys(fe).length) toast.error(errorMessage(err));
            },
          });
        }}>
          <div className={cn('grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)]', wide && 'lg:grid-cols-[22rem_minmax(0,1fr)]')}>
            {/* Cột trái — Cài đặt */}
            <section aria-label="Cài đặt" data-testid="col-settings"
              className={cn('grid min-h-0 content-start gap-5 overflow-y-auto px-6 py-5', wide && tab !== 'settings' && 'hidden lg:grid', maxed && 'hidden lg:hidden')}>
              {wide && <h3 className="hidden text-xs font-semibold tracking-wide text-muted-foreground uppercase lg:block">Cài đặt</h3>}
              <FormField id="col-name" label="Tên trạng thái *" required autoFocus maxLength={50} value={f.name} onChange={(e) => set('name', e.target.value)} error={errors.name}
                placeholder="vd Thiết kế, QA, Chờ khách duyệt" />
              <div className="grid gap-2">
                <Label>Màu</Label>
                <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Màu trạng thái">
                  {COLUMN_PALETTE.map((c) => (
                    <button key={c} type="button" role="radio" aria-checked={f.color === c} aria-label={c} onClick={() => set('color', c)}
                      className="grid size-7 place-items-center rounded-full ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                      style={{ backgroundColor: c }}>
                      {f.color === c && <Check className="size-4 text-white" />}
                    </button>
                  ))}
                  <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Màu khác">
                    <input type="color" aria-label="Chọn màu khác" className="size-7 cursor-pointer rounded border bg-transparent p-0.5"
                      value={f.color ?? COLUMN_PALETTE[0]} onChange={(e) => set('color', e.target.value)} />
                    Khác
                  </label>
                </div>
                {errors.color && <p className="text-xs text-destructive">{errors.color}</p>}
              </div>
              <div className="grid gap-4 border-t pt-4">
                <SwitchRow id="col-done" title="Trạng thái hoàn thành" checked={f.isDone} disabled={lastDone} onChange={(v) => set('isDone', v)}
                  hint={lastDone ? 'Dự án cần ít nhất một trạng thái hoàn thành.' : 'Việc ở đây tính là xong.'}
                  info="Việc ở trạng thái hoàn thành không báo quá hạn và được tính vào % tiến độ dự án. Dự án cần ít nhất một trạng thái hoàn thành." />
                {errors.isDone && <p className="-mt-2 text-xs text-destructive">{errors.isDone}</p>}
                <SwitchRow id="col-approver" title="Cần người duyệt" checked={f.approverOnly} onChange={(v) => set('approverOnly', v)}
                  hint="Chỉ quản lý dự án chuyển việc vào / ra."
                  info="Chỉ quản lý dự án được chuyển việc vào trạng thái này, hoặc trả việc về trạng thái trước. Bot không bao giờ chuyển việc vào / ra trạng thái cần duyệt." />
                <SwitchRow id="col-wake" title="Đánh thức bot theo dõi" checked={f.wakeFollowers} onChange={(v) => { set('wakeFollowers', v); if (!v) setMaxed(false); }}
                  hint="Việc vào đây thì gọi bot theo dõi việc."
                  info="Việc chuyển vào trạng thái này thì các bot đang theo dõi việc được gọi. Bot làm theo hướng dẫn cho bot của cột; chưa có thì tự xem hướng dẫn dự án để biết bước của mình." />
              </div>
              {f.wakeFollowers && (
                <div className="grid gap-2" data-testid="col-wake-bots">
                  <div className="flex items-center gap-1">
                    <Label>Bot được gọi</Label>
                    <InfoTip label="Giải thích: Bot được gọi">Không chọn bot nào = đánh thức tất cả bot theo dõi việc. Bot được chọn vẫn phải là người theo dõi của việc mới được gọi.</InfoTip>
                  </div>
                  {bots.length === 0 ? <p className="text-sm text-muted-foreground">Dự án chưa có thành viên là bot</p> : (
                    <>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {picked.map((b) => (
                          <span key={b.employeeId} className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/50 py-0.5 pr-0.5 pl-2.5 text-sm"
                            data-testid={`col-wake-chip-${b.code ?? b.employeeId}`}>
                            <span className="truncate">{b.fullName}</span>
                            {b.code && <span className="text-xs text-muted-foreground">{b.code}</span>}
                            <BotBadge className="shrink-0" />
                            <button type="button" className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                              aria-label={`Bỏ ${b.fullName}`} onClick={() => toggleBot(b.employeeId, false)} data-testid={`col-wake-bot-remove-${b.code ?? b.employeeId}`}>
                              <X className="size-3.5" /></button>
                          </span>
                        ))}
                        {unpicked.length > 0 && (
                          <Button type="button" variant="outline" size="sm" className="h-7 rounded-full" aria-expanded={picking}
                            onClick={() => setPicking((x) => !x)} data-testid="col-wake-add"><Plus /> Thêm bot</Button>
                        )}
                      </div>
                      {picking && unpicked.length > 0 && (
                        <div className="grid gap-0.5 rounded-md border p-1 shadow-xs" role="listbox" aria-label="Bot thành viên dự án" data-testid="col-wake-bot-list">
                          {unpicked.map((b) => (
                            <button key={b.employeeId} type="button" role="option" aria-selected={false}
                              className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                              onClick={() => { toggleBot(b.employeeId, true); if (unpicked.length <= 1) setPicking(false); }} data-testid={`col-wake-bot-${b.code ?? b.employeeId}`}>
                              <span className="truncate">{b.fullName}</span>
                              {b.code && <span className="text-xs text-muted-foreground">{b.code}</span>}
                              <BotBadge className="ml-auto shrink-0" />
                            </button>
                          ))}
                        </div>
                      )}
                      {picked.length === 0 && <p className="text-xs text-muted-foreground" data-testid="col-wake-all">Mọi bot theo dõi việc sẽ được gọi</p>}
                    </>
                  )}
                  {errors.wakeBotIds && <p className="text-xs text-destructive">{errors.wakeBotIds}</p>}
                </div>
              )}
              {column && column.taskCount > 0 && others.length > 0 && (
                <div className="rounded-lg border border-dashed p-3">
                  <SelectField id="col-move" label={`Khi xoá: chuyển ${column.taskCount} việc sang`} value={moveTo} onChange={setMoveTo}
                    options={others.map((c) => ({ value: c.id, label: c.name }))} placeholder="Chọn trạng thái…" />
                </div>
              )}
            </section>
            {/* Cột phải — Hướng dẫn cho bot (chỉ khi bật đánh thức) */}
            {wide && (
              <section aria-label="Hướng dẫn cho bot" data-testid="col-guide"
                className={cn('min-h-0 flex-col gap-2 overflow-y-auto px-6 py-5 lg:overflow-hidden lg:border-l', tab === 'guide' || maxed ? 'flex' : 'hidden lg:flex')}>
                <MarkdownEditor id="col-guide" fill value={guide} onChange={setGuide} preview={guidePreview} onPreviewChange={setGuidePreview}
                  label={<span className="flex items-center gap-1">Hướng dẫn cho bot ở cột này
                    <InfoTip label="Giải thích: Hướng dẫn cho bot">Bot được đánh thức ở cột này đọc hướng dẫn này thay cho cả hướng dẫn dự án. Bot không tự sửa được.</InfoTip></span>}
                  rows={12} minHeightClass="min-h-60" maxLength={MAX_GUIDE} error={errors.guide} emptyText="Chưa có hướng dẫn — bot đọc hướng dẫn chung của dự án."
                  placeholder={'## Review\n1. Đọc bình luận kết quả của người làm, lấy commit…\n2. Chạy build / test…\n3. Bình luận "REVIEW: ĐẠT" hoặc "REVIEW: CẦN SỬA"'} />
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="tabular-nums" data-testid="col-guide-count">{guide.length.toLocaleString('vi-VN')} / {MAX_GUIDE.toLocaleString('vi-VN')} ký tự</span>
                  <Button type="button" variant="ghost" size="sm" className="h-7" onClick={() => setMaxed((x) => !x)} aria-pressed={maxed} data-testid="col-guide-max">
                    {maxed ? <><Minimize2 /> Thu nhỏ</> : <><Maximize2 /> Phóng to</>}</Button>
                </div>
                {guide.trim() && f.wakeBotIds.length === 0 && (
                  <p className="shrink-0 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-xs text-warning" data-testid="col-guide-all-bots">
                    Chưa chọn bot: mọi bot theo dõi việc sẽ được gọi và đọc hướng dẫn này.</p>
                )}
              </section>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2 border-t bg-background px-4 py-3 sm:px-6" data-testid="column-dialog-footer">
            {column && <Button type="button" variant="ghost" className="text-destructive" loading={remove.isPending} disabled={others.length === 0 || lastDone}
              aria-label="Xoá trạng thái" data-testid="col-delete" title={lastDone ? 'Không xoá trạng thái hoàn thành cuối cùng' : undefined} onClick={() => void del()}>
              <Trash2 /><span className="hidden sm:inline">Xoá trạng thái</span></Button>}
            <span className="ml-auto" />
            <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
            <Button type="submit" className="min-w-24" loading={save.isPending} loadingText="Đang lưu…">{column ? 'Lưu' : 'Thêm'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
