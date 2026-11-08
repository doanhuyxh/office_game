import { http, httpPost, pageQs } from '@/services/api-client';
import type { IPaged, IPageQuery } from '@/types/api';
import type {
  IAccessLog, IApprovers, IAssetDetail, IAssetFilter, IAssetRow, IDocType, IFileUrl, IFolder, IOrphan, ISpace, ISpaceRef, IStats,
  IUpdateAsset, IUploadTicket,
} from '../types/document.types';

const base = '/api/documents';
const json = (method: string, body?: unknown) => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });
const spaceQs = (s: ISpaceRef) => `spaceKind=${s.kind}${s.id ? `&spaceId=${s.id}` : ''}`;

export const documentKeys = {
  all: ['documents'] as const,
  spaces: ['documents', 'spaces'] as const,
  folders: (s: ISpaceRef) => ['documents', 'folders', s.kind, s.id] as const,
  docTypes: ['documents', 'doc-types'] as const,
  assets: (f: IAssetFilter, q: IPageQuery) => ['documents', 'assets', f, q] as const,
  asset: (id: string) => ['documents', 'asset', id] as const,
  approvers: (id: string, status: string) => ['documents', 'approvers', id, status] as const,
  accessLog: (id: string, q: IPageQuery) => ['documents', 'access-log', id, q] as const,
  trash: (q: IPageQuery) => ['documents', 'trash', q] as const,
  recent: ['documents', 'recent'] as const,
  stats: ['documents', 'stats'] as const,
  retention: (q: IPageQuery) => ['documents', 'retention', q] as const,
  orphans: ['documents', 'orphans'] as const,
};

export const documentApi = {
  spaces: () => http<ISpace[]>(`${base}/spaces`),


  folders: (s: ISpaceRef) => http<IFolder[]>(`${base}/folders?${spaceQs(s)}`),
  createFolder: (s: ISpaceRef, parentId: string | null, name: string) =>
    httpPost<IFolder>(`${base}/folders`, { spaceKind: s.kind, spaceId: s.id, parentId, name }),
  ensureFolder: (s: ISpaceRef, parentId: string | null, path: string) =>
    httpPost<IFolder>(`${base}/folders/ensure`, { spaceKind: s.kind, spaceId: s.id, parentId, path }),
  renameFolder: (id: string, name: string) => http<void>(`${base}/folders/${id}`, json('PUT', { name })),
  deleteFolder: (id: string) => http<void>(`${base}/folders/${id}`, { method: 'DELETE' }),

  docTypes: () => http<IDocType[]>(`${base}/doc-types`),
  saveDocType: (t: Omit<IDocType, 'id'> & { id?: string }) =>
    t.id ? http<IDocType>(`${base}/doc-types/${t.id}`, json('PUT', t)) : httpPost<IDocType>(`${base}/doc-types`, t),

  assets: (f: IAssetFilter, q: IPageQuery) => {
    const qs = new URLSearchParams();
    if (f.space) { qs.set('spaceKind', f.space.kind); if (f.space.id) qs.set('spaceId', f.space.id); }
    if (f.folderId) qs.set('folderId', f.folderId);
    if (f.search?.trim()) qs.set('search', f.search.trim());
    if (f.docTypeId) qs.set('docTypeId', f.docTypeId);
    if (f.kind) qs.set('kind', f.kind);
    if (f.status) qs.set('status', f.status);
    return http<IPaged<IAssetRow>>(`${base}/assets?${qs}&${pageQs(q)}`);
  },
  asset: (id: string) => http<IAssetDetail>(`${base}/assets/${id}`),
  approvers: (id: string) => http<IApprovers>(`${base}/assets/${id}/approvers`),
  upload: (file: File) => httpPost<IUploadTicket>(`${base}/uploads`, { fileName: file.name, contentType: file.type || null, size: file.size }),
  create: (body: { ticketId: string; spaceKind: string; spaceId: string | null; folderId: string | null; docTypeId: string | null; title: string | null; description: string | null; tags: string[] }) =>
    httpPost<IAssetDetail>(`${base}/assets`, body),
  update: (id: string, body: IUpdateAsset) => http<IAssetDetail>(`${base}/assets/${id}`, json('PUT', body)),
  addVersion: (id: string, ticketId: string, note: string | null) => httpPost<IAssetDetail>(`${base}/assets/${id}/versions`, { ticketId, note }),
  fileUrl: (id: string, version?: number, download = false) =>
    http<IFileUrl>(`${base}/assets/${id}/file?${version ? `version=${version}&` : ''}download=${download}`),
  accessLog: (id: string, q: IPageQuery) => http<IPaged<IAccessLog>>(`${base}/assets/${id}/access-log?${pageQs(q)}`),
  trashAsset: (id: string) => http<void>(`${base}/assets/${id}`, { method: 'DELETE' }),
  restore: (id: string) => httpPost<void>(`${base}/assets/${id}/restore`),
  purge: (id: string) => http<void>(`${base}/assets/${id}/purge`, { method: 'DELETE' }),
  submit: (id: string) => httpPost<IAssetDetail>(`${base}/assets/${id}/submit`),
  archive: (id: string) => httpPost<IAssetDetail>(`${base}/assets/${id}/archive`),
  custodian: (id: string, employeeId: string) => http<IAssetDetail>(`${base}/assets/${id}/custodian`, json('PUT', { employeeId })),
  trash: (q: IPageQuery) => http<IPaged<IAssetRow>>(`${base}/trash?${pageQs(q)}`),
  /** Mới ban hành (60 ngày) trong các kho mình vào được — bảng tin văn phòng 3D. */
  recent: () => http<IAssetRow[]>(`${base}/recent?take=20`),

  stats: () => http<IStats>(`${base}/admin/stats`),
  retention: (q: IPageQuery) => http<IPaged<IAssetRow>>(`${base}/admin/retention?${pageQs(q)}`),
  setRetention: (id: string, until: string | null) => http<void>(`${base}/admin/assets/${id}/retention`, json('PUT', { until })),
  destroy: (id: string, reason: string) => httpPost<void>(`${base}/admin/assets/${id}/destroy`, { reason }),
  orphans: () => http<IOrphan[]>(`${base}/admin/orphans`),
  handover: (fromEmployeeId: string, toEmployeeId: string) => httpPost<number>(`${base}/admin/handover`, { fromEmployeeId, toEmployeeId }),
};
