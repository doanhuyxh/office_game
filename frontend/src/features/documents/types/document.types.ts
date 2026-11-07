// Khớp DTO ở backend/src/Modules/Documents/OfficeHub.Modules.Documents/Features/Dtos.cs

export type SpaceKind = 'Company' | 'Department' | 'Project';
export type AssetKind = 'Document' | 'Image' | 'Video' | 'Audio' | 'Archive' | 'Other';
export type AssetStatus = 'Draft' | 'PendingApproval' | 'Published' | 'Archived' | 'Destroyed';
export type Classification = 'Internal' | 'Restricted' | 'Confidential';
export type ProjectStatus = 'Active' | 'Closed';
export type ProjectRole = 'Member' | 'Manager';

/** Kho: công ty (id null), phòng ban (id phòng), dự án (id dự án). */
export interface ISpace {
  kind: SpaceKind;
  id: string | null;
  name: string;
  code: string;
  parentId: string | null;
  canWrite: boolean;
  canManage: boolean;
  closed: boolean;
}

export interface ISpaceRef {
  kind: SpaceKind;
  id: string | null;
}

export interface IProjectMember {
  employeeId: string;
  code: string | null;
  fullName: string;
  role: ProjectRole;
  isActive: boolean;
}

export interface IProject {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  departmentId: string | null;
  departmentName: string | null;
  members: IProjectMember[];
  myRole: ProjectRole | null;
  canManage: boolean;
  assetCount: number;
  createdAt: string;
}

export interface IFolder {
  id: string;
  parentId: string | null;
  name: string;
  assetCount: number;
}

export interface IDocType {
  id: string;
  code: string;
  name: string;
  /** null = vĩnh viễn */
  retentionYears: number | null;
  sortOrder: number;
  isActive: boolean;
}

export interface IAssetRow {
  id: string;
  code: string;
  title: string;
  kind: AssetKind;
  status: AssetStatus;
  classification: Classification;
  spaceKind: SpaceKind;
  spaceId: string | null;
  folderId: string | null;
  docTypeId: string;
  docTypeName: string;
  currentVersion: number;
  fileName: string;
  contentType: string;
  size: number;
  totalSize: number;
  tags: string[];
  custodianName: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string | null;
  documentNumber: string | null;
  retentionUntil: string | null; // yyyy-MM-dd
  deletedAt: string | null;
}

export interface IVersion {
  number: number;
  fileName: string;
  contentType: string;
  size: number;
  note: string | null;
  uploadedByName: string | null;
  uploadedAt: string;
  available: boolean;
}

/** Quyền của người gọi — chỉ dựa vào đây để hiện nút. */
export interface IAssetPermissions {
  edit: boolean;
  changeFile: boolean;
  delete: boolean;
  restore: boolean;
  purge: boolean;
  submit: boolean;
  archive: boolean;
  manage: boolean;
  hrAdmin: boolean;
}

export interface IAssetDetail {
  asset: IAssetRow;
  description: string | null;
  spaceName: string;
  folderPath: string | null;
  custodianEmployeeId: string | null;
  publishedAt: string | null;
  approvalRequestId: string | null;
  rejectReason: string | null;
  destroyedAt: string | null;
  destroyReason: string | null;
  destroyedByName: string | null;
  deletedByName: string | null;
  versions: IVersion[];
  can: IAssetPermissions;
}

/** Người duyệt ban hành (GET /assets/{id}/approvers). step: Manager | Hr | None (không gửi được — xem note). */
export interface IApprovers {
  step: 'Self' | 'Manager' | 'Hr' | 'None';
  pending: boolean;
  requesterName: string | null;
  note: string;
  people: { name: string; email: string | null; detail: string }[];
}

export interface IFileUrl {
  url: string;
  fileName: string;
  contentType: string;
  kind: AssetKind;
  version: number;
  inline: boolean;
}

export interface IAccessLog {
  at: string;
  userName: string | null;
  action: 'View' | 'Download';
  versionNumber: number;
  ip: string | null;
}

export interface IUploadTicket {
  ticketId: string;
  url: string;
  contentType: string;
  expiresAt: string;
}

export interface IAssetFilter {
  space?: ISpaceRef | null;
  folderId?: string | null;
  search?: string;
  docTypeId?: string | null;
  kind?: AssetKind | null;
  status?: AssetStatus | null;
}

export interface ICountSize {
  key: string;
  label: string;
  count: number;
  size: number;
}

export interface IStats {
  totalAssets: number;
  totalSize: number;
  published: number;
  drafts: number;
  pending: number;
  trashCount: number;
  orphanCount: number;
  retentionDueCount: number;
  bySpace: ICountSize[];
  byKind: ICountSize[];
  byType: ICountSize[];
  monthly: ICountSize[];
}

export interface IOrphan {
  employeeId: string;
  code: string | null;
  fullName: string;
  leftAt: string | null;
  assetCount: number;
  size: number;
}

export interface IUpdateAsset {
  title: string;
  description: string | null;
  tags: string[];
  docTypeId: string;
  folderId: string | null;
}
