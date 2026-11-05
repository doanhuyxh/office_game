// Khớp DTO ở backend/src/Modules/LaborContracts/.../Features/ContractEndpoints.cs

export type ContractType = 'Indefinite' | 'Fixed' | 'Probation';
export type ContractStatus = 'Upcoming' | 'Active' | 'Expired' | 'Terminated';

export interface IContractEmployee {
  id: string;
  code: string;
  fullName: string;
  departmentName: string | null;
  isActive: boolean;
}

export interface IStoredFile {
  name: string;
  contentType: string | null;
  size: number | null;
}

export interface IAmendment {
  id: string;
  number: string;
  effectiveDate: string;
  content: string;
  /** null = phụ lục không đổi lương */
  salary: number | null;
  allowance: number | null;
  file: IStoredFile | null;
  createdAt: string;
}

export interface IContract {
  id: string;
  employee: IContractEmployee;
  number: string;
  type: ContractType;
  status: ContractStatus;
  signedDate: string | null;
  startDate: string;
  endDate: string | null;
  terminatedOn: string | null;
  terminationReason: string | null;
  jobTitle: string | null;
  salary: number | null;
  allowance: number | null;
  /** Hiệu lực hôm nay (tính cả phụ lục) */
  currentSalary: number | null;
  currentAllowance: number | null;
  note: string | null;
  /** Chỉ có khi đang hiệu lực và có ngày kết thúc */
  daysLeft: number | null;
  file: IStoredFile | null;
  amendments: IAmendment[];
  createdAt: string;
}

export interface IUpsertContract {
  employeeId: string;
  number: string;
  type: ContractType;
  signedDate: string | null;
  startDate: string;
  endDate: string | null;
  jobTitle: string | null;
  salary: number | null;
  allowance: number | null;
  note: string | null;
}

export interface ICreateAmendment {
  number: string;
  effectiveDate: string;
  content: string;
  salary: number | null;
  allowance: number | null;
}
