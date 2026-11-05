import { http, httpPost, httpUpload } from '@/services/api-client';
import type { IContract, ICreateAmendment, IStoredFile, IUpsertContract } from '../types/contract.types';

const put = <T>(url: string, body: unknown) => http<T>(url, { method: 'PUT', body: JSON.stringify(body) });
const del = (url: string) => http<void>(url, { method: 'DELETE' });

export const contractKeys = {
  all: ['contracts'] as const,
  list: ['contracts', 'list'] as const,
  my: ['contracts', 'my'] as const,
};

const base = '/api/contracts';
export const contractApi = {
  list: () => http<IContract[]>(base),
  my: () => http<IContract[]>(`${base}/my`),
  create: (body: IUpsertContract) => httpPost<IContract>(base, body),
  update: (id: string, body: IUpsertContract) => put<IContract>(`${base}/${id}`, body),
  terminate: (id: string, terminatedOn: string, reason: string) => httpPost<IContract>(`${base}/${id}/terminate`, { terminatedOn, reason }),
  remove: (id: string) => del(`${base}/${id}`),
  addAmendment: (id: string, body: ICreateAmendment) => httpPost<IContract>(`${base}/${id}/amendments`, body),
  removeAmendment: (id: string, amendmentId: string) => del(`${base}/${id}/amendments/${amendmentId}`),
  uploadFile: (id: string, file: File, amendmentId?: string) =>
    httpUpload<IStoredFile>(`${base}/${id}${amendmentId ? `/amendments/${amendmentId}` : ''}/file`, file),
  fileUrl: (id: string, amendmentId?: string) =>
    http<{ url: string; name: string }>(`${base}/${id}${amendmentId ? `/amendments/${amendmentId}` : ''}/file`),
};
