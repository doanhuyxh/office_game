import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { FileUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import { FormField } from '@/components/common/FormField';
import { Label } from '@/components/common/label';
import { Textarea } from '@/components/common/textarea';
import { SettingsCardShell } from '../settings-card-shell';
import type { ISettingsGroup, SettingsValue } from '../../types/system.types';

/** Một ô của nhóm cấu hình. secret / secret-json: không bao giờ hiện giá trị, để trống = giữ nguyên; clearable = cho xoá hẳn. */
export interface ISettingsField {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'bool' | 'secret' | 'secret-json';
  hint?: string;
  placeholder?: string;
  clearable?: boolean;
  min?: number;
  max?: number;
}

/** Card cấu hình dạng danh sách ô (S3, SMTP, FCM) — sinh form từ `fields`. */
export function SettingsGroupCard({ group, icon, description, fields, testLabel }: {
  group: ISettingsGroup; icon: LucideIcon; description: ReactNode; fields: ISettingsField[]; testLabel?: string;
}) {
  const [values, setValues] = useState<Record<string, SettingsValue>>(group.values);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [clear, setClear] = useState<string[]>([]);
  useEffect(() => { setValues(group.values); setSecrets({}); setClear([]); }, [group]);
  const dirty = JSON.stringify(values) !== JSON.stringify(group.values) || Object.values(secrets).some((s) => s.trim()) || clear.length > 0;
  const set = (k: string, v: SettingsValue) => setValues((x) => ({ ...x, [k]: v }));
  const id = (k: string) => `settings-${group.group}-${k}`;
  return (
    <SettingsCardShell group={group} icon={icon} description={description} dirty={dirty} testLabel={testLabel}
      build={() => ({ values, secrets: Object.fromEntries(Object.entries(secrets).filter(([, s]) => s.trim())), clearSecrets: clear })}
      onSaved={() => { setSecrets({}); setClear([]); }}>
      {(errors) => (
        <div className="grid items-start gap-4 md:grid-cols-2">
          {fields.map((f) => {
            if (f.kind === 'bool') return (
              <div key={f.key} className="flex items-start gap-2 md:col-span-2">
                <Checkbox id={id(f.key)} checked={values[f.key] === true} onCheckedChange={(c) => set(f.key, c === true)} />
                <div className="grid gap-1">
                  <Label htmlFor={id(f.key)}>{f.label}</Label>
                  {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
                </div>
              </div>
            );
            if (f.kind === 'secret' || f.kind === 'secret-json') {
              const isSet = group.secrets[f.key] && !clear.includes(f.key);
              const hint = clear.includes(f.key) ? 'Sẽ xoá khi lưu.' : isSet ? 'Đã đặt — để trống để giữ nguyên.' : 'Chưa đặt.';
              const clearBox = f.clearable && group.secrets[f.key] && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={clear.includes(f.key)} onCheckedChange={(c) => setClear((x) => (c === true ? [...x, f.key] : x.filter((k) => k !== f.key)))} />
                  Xoá giá trị đang lưu
                </label>
              );
              if (f.kind === 'secret-json') return (
                <div key={f.key} className="grid gap-2 md:col-span-2">
                  <Label htmlFor={id(f.key)}>{f.label}</Label>
                  <Textarea id={id(f.key)} rows={4} className="font-mono text-xs" autoComplete="off" spellCheck={false} aria-invalid={!!errors[f.key]}
                    placeholder={isSet ? '•••••• (đã đặt — dán nội dung mới để thay)' : f.placeholder} value={secrets[f.key] ?? ''}
                    onChange={(e) => setSecrets((x) => ({ ...x, [f.key]: e.target.value }))} />
                  <div>
                    <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById(`${id(f.key)}-file`)?.click()}><FileUp /> Chọn file .json</Button>
                    <input id={`${id(f.key)}-file`} type="file" accept=".json,application/json" className="hidden"
                      onChange={async (e) => { const file = e.target.files?.[0]; if (file) { const text = await file.text(); setSecrets((x) => ({ ...x, [f.key]: text })); } e.target.value = ''; }} />
                  </div>
                  {errors[f.key] ? <p className="text-xs text-destructive">{errors[f.key]}</p> : <p className="text-xs text-muted-foreground">{f.hint ? `${f.hint} ` : ''}{hint}</p>}
                  {clearBox}
                </div>
              );
              return (
                <div key={f.key} className="grid gap-1">
                  <FormField id={id(f.key)} label={f.label} type="password" autoComplete="new-password" value={secrets[f.key] ?? ''}
                    placeholder={isSet ? '••••••' : f.placeholder} onChange={(e) => setSecrets((x) => ({ ...x, [f.key]: e.target.value }))}
                    error={errors[f.key]} hint={`${f.hint ? `${f.hint} ` : ''}${hint}`} />
                  {clearBox}
                </div>
              );
            }
            const v = values[f.key];
            return (
              <FormField key={f.key} id={id(f.key)} label={f.label} type={f.kind === 'number' ? 'number' : 'text'} min={f.min} max={f.max}
                placeholder={f.placeholder} value={v === null || v === undefined ? '' : String(v)} error={errors[f.key]} hint={f.hint}
                onChange={(e) => set(f.key, f.kind === 'number' ? (e.target.value === '' ? null : Math.trunc(Number(e.target.value))) : e.target.value)} />
            );
          })}
        </div>
      )}
    </SettingsCardShell>
  );
}
