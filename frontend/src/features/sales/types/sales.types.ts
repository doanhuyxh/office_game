/** Khớp DTO module Sales (back-end). Tiền: VND số nguyên. Ngày: yyyy-MM-dd (giờ VN). */
export type CustomerKind = 'Company' | 'Individual';
export type ActivityKind = 'Call' | 'Meeting' | 'Email' | 'Message' | 'Note';
export type OpportunityStage = 'Lead' | 'Contacted' | 'Quoted' | 'Negotiating' | 'Won' | 'Lost';
export type BillingKind = 'Milestone' | 'Monthly' | 'OneTime';
export type ContractStatus = 'Active' | 'Completed' | 'Cancelled';
export type InstallmentState = 'Upcoming' | 'DueSoon' | 'Overdue' | 'Partial' | 'Paid' | 'Cancelled';

export interface ICustomer {
  id: string; code: string; name: string; kind: CustomerKind; taxCode: string | null; phone: string | null; email: string | null; source: string | null;
  ownerEmployeeId: string; ownerName: string; isActive: boolean; createdAt: string; openOpportunities: number; activeContracts: number;
}
export interface IContact { id: string; name: string; title: string | null; phone: string | null; email: string | null; isPrimary: boolean }
export interface IActivity {
  id: string; customerId: string; customerName: string | null; opportunityId: string | null; kind: ActivityKind; at: string; content: string;
  nextAction: string | null; nextActionOn: string | null; createdByName: string;
}
export interface IOpportunity {
  id: string; customerId: string; customerName: string; title: string; businessLineId: string | null; stage: OpportunityStage; value: number; probability: number;
  weighted: number; expectedCloseOn: string | null; lostReason: string | null; ownerEmployeeId: string; ownerName: string; createdAt: string; closedAt: string | null;
}
export interface IContract {
  id: string; code: string; customerId: string; customerName: string; title: string; businessLineId: string | null; totalValue: number; billing: BillingKind;
  status: ContractStatus; signedOn: string; endOn: string | null; ownerEmployeeId: string; ownerName: string; scheduled: number; collected: number; outstanding: number; overdue: number;
}
export interface ICustomerDetail {
  customer: ICustomer; address: string | null; note: string | null; contacts: IContact[]; activities: IActivity[]; opportunities: IOpportunity[]; contracts: IContract[]; canEdit: boolean;
}
export interface ICollection { id: string; date: string; amount: number; active: boolean; createdByName: string; createdAt: string }
export interface IInstallment {
  id: string; order: number; title: string; dueOn: string; amount: number; collected: number; remaining: number; state: InstallmentState; agingBucket: string | null;
  cancelReason: string | null; collections: ICollection[]; appendixId: string | null;
}
/** Yêu cầu thay đổi (CR) của dự án — không có tiền. */
export interface IChangeRequestRef { id: string; projectId: string; code: string; title: string; status: string; billable: boolean; estimateManDays: number | null }
export interface IAppendix {
  id: string; code: string; title: string; signedOn: string; valueBeforeTaxDelta: number; totalDelta: number; changeRequestId: string | null; changeRequestCode: string | null;
  note: string | null; cancelled: boolean; cancelReason: string | null; createdByName: string; createdAt: string;
}
export interface IAppendixRequest {
  code: string; title: string; signedOn: string; valueBeforeTaxDelta: number; installments: IInstallmentInput[]; changeRequestId?: string | null; note?: string | null;
}
/** valueBeforeTax / contract.totalValue = hiện tại (đã gồm phụ lục); original* = gốc. */
export interface IContractDetail {
  contract: IContract; valueBeforeTax: number; vatRate: number; note: string | null; opportunityId: string | null; installments: IInstallment[]; canEdit: boolean; canCollect: boolean;
  originalValueBeforeTax: number; originalTotalValue: number; appendices: IAppendix[]; pendingChangeRequests: IChangeRequestRef[];
}
export interface IReceivableItem {
  installmentId: string; contractId: string; contractCode: string; customerId: string; customerName: string; ownerName: string; title: string; dueOn: string;
  amount: number; collected: number; remaining: number; state: InstallmentState; agingBucket: string | null;
}
export interface IReceivables { outstanding: number; overdue: number; dueSoon: number; buckets: Record<string, number>; items: IReceivableItem[] }

export interface ICustomerRequest {
  name: string; kind: CustomerKind; taxCode?: string | null; address?: string | null; phone?: string | null; email?: string | null; source?: string | null; note?: string | null;
  ownerEmployeeId?: string | null; isActive?: boolean;
}
export interface IContactRequest { name: string; title?: string | null; phone?: string | null; email?: string | null; isPrimary?: boolean }
export interface IActivityRequest { kind: ActivityKind; content: string; opportunityId?: string | null; nextAction?: string | null; nextActionOn?: string | null }
export interface IOpportunityRequest {
  customerId: string; title: string; stage: OpportunityStage; value: number; probability?: number | null; businessLineId?: string | null; expectedCloseOn?: string | null;
  lostReason?: string | null; ownerEmployeeId?: string | null;
}
export interface IInstallmentInput { title: string; dueOn: string; amount: number }
export interface IContractRequest {
  code: string; customerId: string; title: string; valueBeforeTax: number; vatRate: number; signedOn: string; billing: BillingKind; installments: IInstallmentInput[];
  endOn?: string | null; opportunityId?: string | null; businessLineId?: string | null; note?: string | null;
}
export interface IContractUpdate { title: string; status: ContractStatus; endOn?: string | null; note?: string | null }
export interface ICollectRequest { amount: number; date: string; accountId: string; categoryId?: string | null; invoiceNumber?: string | null }
