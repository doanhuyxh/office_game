import { http, httpPost, pageQs } from '@/services/api-client';
import type { IPaged, IPageQuery } from '@/types/api';
import type { IAdjustment, IMyPayslip, IPayProfile, IPayrollRules, IPayslip, IPeriod, IPeriodDetail, ISettings } from '../types/payroll.types';

export const payrollKeys = {
  all: ['payroll'] as const,
  settings: ['payroll', 'settings'] as const,
  profilesPage: (q: IPageQuery) => ['payroll', 'profiles', 'page', q] as const,
  periods: ['payroll', 'periods'] as const,
  period: (id: string) => ['payroll', 'period', id] as const,
  payslips: (id: string, q: IPageQuery) => ['payroll', 'period', id, 'payslips', q] as const,
  my: ['payroll', 'my'] as const,
};

const base = '/api/payroll';
export const payrollApi = {
  settings: () => http<ISettings[]>(`${base}/settings`),
  saveSettings: (effectiveFrom: string, rules: IPayrollRules) => httpPost<ISettings>(`${base}/settings`, { effectiveFrom, rules }),
  profilesPage: (q: IPageQuery) => http<IPaged<IPayProfile>>(`${base}/profiles?${pageQs(q)}`),
  saveProfile: (employeeId: string, body: { dependents: number; insured: boolean | null; taxCode: string | null; note: string | null }) =>
    http<void>(`${base}/profiles/${employeeId}`, { method: 'PUT', body: JSON.stringify(body) }),
  periods: () => http<IPeriod[]>(`${base}/periods`),
  createPeriod: (month: string) => httpPost<IPeriod>(`${base}/periods`, { month }),
  period: (id: string) => http<IPeriodDetail>(`${base}/periods/${id}`),
  /** Phiếu lương của kỳ theo trang (sắp theo mã NV; BE chỉ giải mã phiếu trong trang). Tổng của kỳ lấy ở `period`. */
  payslips: (id: string, q: IPageQuery) => http<IPaged<IPayslip>>(`${base}/periods/${id}/payslips?${pageQs(q)}`),
  compute: (id: string) => httpPost<void>(`${base}/periods/${id}/compute`),
  lock: (id: string) => httpPost<void>(`${base}/periods/${id}/lock`),
  unlock: (id: string) => httpPost<void>(`${base}/periods/${id}/unlock`),
  exportUrl: (id: string) => `${base}/periods/${id}/export.xlsx`,
  addAdjustment: (id: string, body: { employeeId: string; label: string; amount: number; taxable: boolean }) =>
    httpPost<IAdjustment>(`${base}/periods/${id}/adjustments`, body),
  deleteAdjustment: (id: string) => http<void>(`${base}/adjustments/${id}`, { method: 'DELETE' }),
  my: () => http<IMyPayslip[]>(`${base}/my`),
};
