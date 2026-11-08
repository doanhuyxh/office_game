import { http, httpPost, pageQs } from '@/services/api-client';
import type { IPaged, IPageQuery } from '@/types/api';
import type {
  ContractStatus, IActivity, IAppendixRequest, IActivityRequest, ICollectRequest, IContactRequest, IContract, IContractDetail, IContractRequest, IContractUpdate, ICustomer,
  ICustomerDetail, ICustomerRequest, IInstallmentInput, IOpportunity, IOpportunityRequest, InstallmentState, IReceivables,
} from '../types/sales.types';

const base = '/api/sales';
const send = <T>(method: string, url: string, body?: unknown) => http<T>(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const qs = (o: Record<string, string | number | boolean | undefined | null>) =>
  Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');

export const salesKeys = {
  all: ['sales'] as const,
  customers: (search: string, inactive: boolean, q: IPageQuery) => ['sales', 'customers', search, inactive, q] as const,
  customer: (id: string) => ['sales', 'customer', id] as const,
  opportunities: ['sales', 'opportunities'] as const,
  contracts: (search: string, status: ContractStatus | undefined, q: IPageQuery) => ['sales', 'contracts', search, status, q] as const,
  contract: (id: string) => ['sales', 'contract', id] as const,
  receivables: (state: InstallmentState | undefined) => ['sales', 'receivables', state] as const,
  upcoming: ['sales', 'upcoming'] as const,
};

export const salesApi = {
  customers: (search: string, inactive: boolean, q: IPageQuery) => http<IPaged<ICustomer>>(`${base}/customers?${pageQs(q)}&${qs({ search, includeInactive: inactive || undefined })}`),
  customer: (id: string) => http<ICustomerDetail>(`${base}/customers/${id}`),
  saveCustomer: (id: string | undefined, b: ICustomerRequest): Promise<unknown> => (id ? send('PUT', `${base}/customers/${id}`, b) : httpPost<string>(`${base}/customers`, b)),
  addContact: (customerId: string, b: IContactRequest) => httpPost<string>(`${base}/customers/${customerId}/contacts`, b),
  updateContact: (id: string, b: IContactRequest) => send<void>('PUT', `${base}/contacts/${id}`, b),
  deleteContact: (id: string) => send<void>('DELETE', `${base}/contacts/${id}`),
  addActivity: (customerId: string, b: IActivityRequest) => httpPost<string>(`${base}/customers/${customerId}/activities`, b),
  upcoming: () => http<IActivity[]>(`${base}/activities/upcoming`),
  opportunities: () => http<IOpportunity[]>(`${base}/opportunities`),
  saveOpportunity: (id: string | undefined, b: IOpportunityRequest): Promise<unknown> =>
    (id ? send('PUT', `${base}/opportunities/${id}`, b) : httpPost<string>(`${base}/opportunities`, b)),
  contracts: (search: string, status: ContractStatus | undefined, q: IPageQuery) => http<IPaged<IContract>>(`${base}/contracts?${pageQs(q)}&${qs({ search, status })}`),
  contract: (id: string) => http<IContractDetail>(`${base}/contracts/${id}`),
  createContract: (b: IContractRequest) => httpPost<string>(`${base}/contracts`, b),
  updateContract: (id: string, b: IContractUpdate) => send<void>('PUT', `${base}/contracts/${id}`, b),
  addInstallment: (contractId: string, b: IInstallmentInput) => httpPost<string>(`${base}/contracts/${contractId}/installments`, b),
  cancelInstallment: (id: string, reason: string) => httpPost<void>(`${base}/installments/${id}/cancel`, { reason }),
  createAppendix: (contractId: string, b: IAppendixRequest) => httpPost<string>(`${base}/contracts/${contractId}/appendices`, b),
  cancelAppendix: (id: string, reason: string) => httpPost<void>(`${base}/appendices/${id}/cancel`, { reason }),
  collect: (id: string, b: ICollectRequest) => httpPost<string>(`${base}/installments/${id}/collect`, b),
  receivables: (state: InstallmentState | undefined) => http<IReceivables>(`${base}/receivables?${qs({ state })}`),
};
