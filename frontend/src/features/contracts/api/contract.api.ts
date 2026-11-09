import { http, httpPost, httpUpload, pageQs } from '@/services/api-client';
import type { IPaged, IPageQuery } from '@/types/api';
import type {
  ContractFilter, ContractType, IContractSummary, IOtpSent, ISignRequest, IContract, IContractTemplate, ICreateAmendment, IStoredFile, ITemplateField, IUpsertContract,
} from '../types/contract.types';

const put = <T>(url: string, body: unknown) => http<T>(url, { method: 'PUT', body: JSON.stringify(body) });
const del = (url: string) => http<void>(url, { method: 'DELETE' });

export const contractKeys = {
  all: ['contracts'] as const,
  listPage: (filter: ContractFilter, search: string, q: IPageQuery) => ['contracts', 'list', 'page', filter, search, q] as const,
  summary: ['contracts', 'summary'] as const,
  nextNumber: (type: string) => ['contracts', 'next-number', type] as const,
  my: ['contracts', 'my'] as const,
  templates: ['contracts', 'templates'] as const,
  templateFields: ['contracts', 'templates', 'fields'] as const,
  signRequests: ['contracts', 'sign-requests'] as const,
};

const base = '/api/contracts';
export const contractApi = {
  /** Một trang — BE lọc (filter, search) + cắt trang, chỉ giải mã lương của trang. */
  listPage: (filter: ContractFilter, search: string, q: IPageQuery) =>
    http<IPaged<IContract>>(`${base}?filter=${filter}&search=${encodeURIComponent(search)}&${pageQs(q)}`),
  summary: () => http<IContractSummary>(`${base}/summary`),
  /** Số hợp đồng kế tiếp gợi ý (vd. 013/2026/HĐLĐ; thử việc …/HĐTV). */
  nextNumber: (type: ContractType) => http<{ number: string }>(`${base}/next-number?type=${type}`),
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
  // Mẫu hợp đồng Word (HR)
  templates: () => http<IContractTemplate[]>(`${base}/templates`),
  templateFields: () => http<ITemplateField[]>(`${base}/templates/fields`),
  uploadTemplate: (file: File, name: string, contractType: string | null) => {
    const form = new FormData();
    form.append('file', file);
    form.append('name', name);
    if (contractType) form.append('contractType', contractType);
    return http<IContractTemplate>(`${base}/templates`, { method: 'POST', body: form });
  },
  templateFileUrl: (id: string) => http<{ url: string; name: string }>(`${base}/templates/${id}/file`),
  removeTemplate: (id: string) => del(`${base}/templates/${id}`),
  /** Link tải hợp đồng đã điền từ mẫu (.docx). */
  // Ký điện tử (ký nội bộ + OTP email)
  signRequests: () => http<ISignRequest[]>(`${base}/sign-requests`),
  createSignRequest: (contractId: string) => httpPost<ISignRequest>(`${base}/${contractId}/sign-requests`),
  cancelSignRequest: (rid: string) => del(`${base}/sign-requests/${rid}`),
  signDocumentUrl: (rid: string, signed = false) => http<{ url: string; name: string }>(`${base}/sign-requests/${rid}/document?signed=${signed}`),
  sendOtp: (rid: string) => httpPost<IOtpSent>(`${base}/sign-requests/${rid}/otp`),
  sign: (rid: string, body: { otp: string; signature: string; agree: boolean }) => httpPost<ISignRequest>(`${base}/sign-requests/${rid}/sign`, body),
  generateUrl: (contractId: string, templateId: string) => `${base}/${contractId}/generate?templateId=${templateId}`,
};
