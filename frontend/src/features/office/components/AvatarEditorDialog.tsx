import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/common/tabs';
import { errorMessage } from '@/utils/errors';
import { cn } from '@/utils/cn';
import {
  AVATAR_CATALOG, DEFAULT_LOOK, paletteOf, partOf, partsOf, randomLook, sameLook, withBody,
  type AvatarLook, type BodyType, type ColorKey, type Slot,
} from '../engine/avatarLook';
import { useMyLook, useSaveAvatar } from '../hooks/useAvatar';
import { AvatarPreview, type PreviewPose } from './AvatarPreview';

const TABS: { id: string; label: string; slot?: Slot; colors: { key: ColorKey; label: string }[] }[] = [
  { id: 'body', label: 'Dáng & da', colors: [{ key: 'skin', label: 'Màu da' }] },
  { id: 'head', label: 'Tóc & mặt', slot: 'head', colors: [{ key: 'hair', label: 'Màu tóc' }, { key: 'eyes', label: 'Màu mắt' }] },
  { id: 'top', label: 'Áo', slot: 'top', colors: [{ key: 'topColor', label: 'Màu áo' }] },
  { id: 'bottom', label: 'Quần / váy', slot: 'bottom', colors: [{ key: 'bottomColor', label: 'Màu quần / váy' }] },
  { id: 'shoes', label: 'Giày', slot: 'shoes', colors: [{ key: 'shoesColor', label: 'Màu giày' }] },
];

const POSES: { id: PreviewPose; label: string }[] = [{ id: 'idle', label: 'Đứng' }, { id: 'walk', label: 'Đi' }, { id: 'sit', label: 'Ngồi' }];

/**
 * Chỉnh nhân vật văn phòng 3D: dáng người, da, tóc, mắt, áo, quần, giày (+ màu). Lưu qua PUT /api/auth/avatar.
 * `onSaved(look | null)` — null = về mặc định; OfficeView dùng để đổi nhân vật trong cảnh + báo hub.
 */
export function AvatarEditorDialog({ open, onOpenChange, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (look: AvatarLook | null) => void;
}) {
  const { look: current, saved } = useMyLook();
  const [look, setLook] = useState<AvatarLook>(current);
  const [pose, setPose] = useState<PreviewPose>('idle');
  const [wave, setWave] = useState(0);
  const save = useSaveAvatar();

  // Mở lại → bắt đầu từ nhân vật đang lưu
  useEffect(() => { if (open) { setLook(current); setPose('idle'); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<AvatarLook>) => setLook((l) => ({ ...l, ...patch }));
  const changed = !sameLook(look, current);

  const submit = (next: AvatarLook | null) =>
    save.mutate(next, {
      onSuccess: (res) => {
        toast.success(next ? 'Đã lưu nhân vật' : 'Đã về nhân vật mặc định');
        onSaved?.(res);
        onOpenChange(false);
      },
      onError: (e) => toast.error(errorMessage(e)),
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] gap-3 overflow-y-auto sm:max-w-3xl" data-testid="avatar-editor">
        <DialogHeader>
          <DialogTitle>Nhân vật của bạn</DialogTitle>
          <DialogDescription>
            Hiện trong văn phòng 3D cho mọi người cùng thấy.{!saved && ' Bạn đang dùng nhân vật mặc định.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[260px_1fr]">
          <div className="flex flex-col gap-2">
            {open && <AvatarPreview look={look} pose={pose} waveKey={wave} className="h-56 w-full overflow-hidden rounded-lg border bg-muted/40 md:h-80" />}
            <div className="flex flex-wrap gap-1">
              {POSES.map((p) => (
                <Button key={p.id} type="button" size="xs" variant={pose === p.id ? 'default' : 'outline'} onClick={() => setPose(p.id)}>{p.label}</Button>
              ))}
              <Button type="button" size="xs" variant="outline" onClick={() => { setPose('idle'); setWave((w) => w + 1); }}>Vẫy tay</Button>
            </div>
          </div>

          <Tabs defaultValue="body" className="min-w-0">
            <TabsList className="flex h-auto w-full flex-wrap justify-start">
              {TABS.map((t) => <TabsTrigger key={t.id} value={t.id} className="flex-none">{t.label}</TabsTrigger>)}
            </TabsList>
            {TABS.map((t) => (
              <TabsContent key={t.id} value={t.id} className="mt-3 space-y-4">
                {t.id === 'body' && (
                  <Section label="Dáng người">
                    <div className="grid grid-cols-2 gap-2">
                      {(Object.keys(AVATAR_CATALOG.bodies) as BodyType[]).map((b) => (
                        <Choice key={b} active={look.body === b} onClick={() => setLook((l) => withBody(l, b))} testId={`avatar-body-${b}`}>
                          {AVATAR_CATALOG.bodies[b].label}
                        </Choice>
                      ))}
                    </div>
                  </Section>
                )}
                {t.slot && (
                  <Section label={t.label}>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {partsOf(look.body, t.slot).map((p) => (
                        <Choice key={p.id} active={look[t.slot!] === p.id} onClick={() => set({ [t.slot!]: p.id })} testId={`avatar-${t.slot}-${p.id}`}>
                          {p.label}
                        </Choice>
                      ))}
                    </div>
                  </Section>
                )}
                {t.colors.map((c) => (c.key === 'eyes' && !partOf(look, 'head')?.eyes?.length) ? null : (
                  <Section key={c.key} label={c.label}>
                    <Swatches value={look[c.key]} colors={paletteOf(c.key)} onChange={(v) => set({ [c.key]: v })} testId={`avatar-color-${c.key}`} />
                  </Section>
                ))}
                {t.id === 'head' && !partOf(look, 'head')?.hair?.length && (
                  <p className="text-xs text-muted-foreground">Kiểu này đội mũ nên không đổi được màu tóc.</p>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setLook(randomLook())}>Ngẫu nhiên</Button>
            <Button type="button" variant="ghost" disabled={save.isPending || (!saved && sameLook(look, DEFAULT_LOOK))}
              onClick={() => (saved ? submit(null) : setLook(DEFAULT_LOOK))}>Về mặc định</Button>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Huỷ</Button>
            <Button type="button" disabled={save.isPending || (saved && !changed)} onClick={() => submit(look)} data-testid="avatar-save">
              {save.isPending ? 'Đang lưu…' : 'Lưu nhân vật'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{label}</div>
      {children}
    </div>
  );
}

function Choice({ active, onClick, children, testId }: { active: boolean; onClick: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId} aria-pressed={active}
      className={cn('rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent',
        active && 'border-primary bg-primary/10 font-medium text-foreground ring-1 ring-primary')}>
      {children}
    </button>
  );
}

/** Ô màu: "Gốc" (null = màu của model) + bảng màu. Màu ô là dữ liệu nhân vật (không phải màu giao diện). */
function Swatches({ value, colors, onChange, testId }: { value: number | null; colors: string[]; onChange: (v: number | null) => void; testId?: string }) {
  const ring = (on: boolean) => cn('size-8 rounded-full border transition-transform hover:scale-110', on && 'ring-2 ring-primary ring-offset-2 ring-offset-background');
  return (
    <div className="flex flex-wrap gap-2" data-testid={testId}>
      <button type="button" className={cn(ring(value === null), 'bg-muted text-[10px] text-muted-foreground')} onClick={() => onChange(null)} title="Màu gốc" aria-pressed={value === null}>
        Gốc
      </button>
      {colors.map((c, i) => (
        <button key={c} type="button" className={ring(value === i)} style={{ backgroundColor: c }} onClick={() => onChange(i)} title={c} aria-label={`Màu ${i + 1}`} aria-pressed={value === i} />
      ))}
    </div>
  );
}
