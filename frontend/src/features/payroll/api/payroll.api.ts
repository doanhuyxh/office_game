import { http, httpPost } from '@/services/api-client';
import type { IAdjustment, IMyPayslip, IPayProfile, IPayrollRules, IPeriod, IPeriodDetail, ISettings } from '../types/payroll.types';

export const payrollKeys = {
  all: ['payroll'] as const,
  settings: ['payroll', 'settings'] as const,
  profiles: ['payroll', 'profiles'] as const,
  periods: ['payroll', 'periods'] as const,
  period: (id: string) => ['payroll', 'period', id] as const,
  my: ['payroll', 'my'] as const,
};

const base = '/api/payroll';
export const payrollApi = {
  settings: () => http<ISettings[]>(`${base}/settings`),
  saveSettings: (effectiveFrom: string, rules: IPayrollRules) => httpPost<ISettings>(`${base}/settings`, { effectiveFrom, rules }),
  profiles: () => http<IPayProfile[]>(`${base}/profiles`),
  saveProfile: (employeeId: string, body: { dependents: number; insured: boolean | null; taxCode: string | null; note: string | null }) =>
    http<void>(`${base}/profiles/${employeeId}`, { method: 'PUT', body: JSON.stringify(body) }),
  periods: () => http<IPeriod[]>(`${base}/periods`),
  createPeriod: (month: string) => httpPost<IPeriod>(`${base}/periods`, { month }),
  period: (id: string) => http<IPeriodDetail>(`${base}/periods/${id}`),
  compute: (id: string) => httpPost<void>(`${base}/periods/${id}/compute`),
  lock: (id: string) => httpPost<void>(`${base}/periods/${id}/lock`),
  unlock: (id: string) => httpPost<void>(`${base}/periods/${id}/unlock`),
  exportUrl: (id: string) => `${base}/periods/${id}/export.xlsx`,
  addAdjustment: (id: string, body: { employeeId: string; label: string; amount: number; taxable: boolean }) =>
    httpPost<IAdjustment>(`${base}/periods/${id}/adjustments`, body),
  deleteAdjustment: (id: string) => http<void>(`${base}/adjustments/${id}`, { method: 'DELETE' }),
  my: () => http<IMyPayslip[]>(`${base}/my`),
};
