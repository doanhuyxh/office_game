/** Liên hệ — nhân viên tự sửa, có hiệu lực ngay. */
export interface IContact {
  phone: string | null;
  currentAddress: string | null;
  permanentAddress: string | null;
  emergencyContactName: string | null;
  emergencyContactRelation: string | null;
  emergencyContactPhone: string | null;
}
/** Cần HR duyệt khi nhân viên tự đổi. */
export interface ISensitive {
  dateOfBirth: string | null;
  idNumber: string | null;
  idIssuedOn: string | null;
  idIssuedPlace: string | null;
  bankName: string | null;
  bankAccount: string | null;
  bankAccountHolder: string | null;
}
export interface IFieldDiff { field: string; label: string; old: string | null; new: string | null }
export type ProfileRequestStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
export interface IProfileRequest {
  id: string; employeeId: string; employeeCode: string; employeeName: string; status: ProfileRequestStatus; createdAt: string;
  decidedAt: string | null; decidedByName: string | null; rejectReason: string | null; note: string | null; changes: IFieldDiff[];
}
export interface IMyProfile {
  employeeId: string; code: string; fullName: string; email: string | null; departmentName: string | null; positionName: string | null;
  jobTitle: string | null; managerName: string | null; joinedAt: string; status: string; avatarUrl: string | null;
  contact: IContact; sensitive: ISensitive; pending: IProfileRequest | null; lastDecided: IProfileRequest | null;
}
/** null = không đổi; '' = xoá. */
export interface ISensitiveChange {
  dateOfBirth?: string | null; clearDateOfBirth?: boolean; idNumber?: string | null; idIssuedOn?: string | null; idIssuedPlace?: string | null;
  bankName?: string | null; bankAccount?: string | null; bankAccountHolder?: string | null;
}
