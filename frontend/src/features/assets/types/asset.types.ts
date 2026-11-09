// Khớp DTO back-end `OfficeHub.Modules.Assets/Features/Dtos.cs` (camelCase; enum = chuỗi; DateOnly = yyyy-MM-dd).
export type DeviceStatus = 'InStock' | 'InUse' | 'Repair' | 'Retired' | 'Lost';
export type BillingCycle = 'None' | 'Monthly' | 'Yearly';
export type ServiceStatus = 'Active' | 'Cancelled';
export type ReviewStatus = 'Open' | 'Closed';
export type ReviewDecision = 'Pending' | 'Keep' | 'Revoke';
export type StocktakeResult = 'Pending' | 'Found' | 'Missing';
export type AttachmentKind = 'Photo' | 'Invoice' | 'Other';
export type HandoverKind = 'Assign' | 'Return';

/** `depreciationMonths`: số tháng khấu hao đường thẳng mặc định của loại (null = không khấu hao). */
export interface ICategory { id: string; code: string; name: string; sortOrder: number; isActive: boolean; depreciationMonths: number | null }
export interface ICategoryRequest { code: string; name: string; sortOrder: number; isActive: boolean; depreciationMonths: number | null }

export interface IDevice {
  id: string; code: string; categoryId: string; categoryName: string; name: string; brand: string | null; model: string | null;
  serialNumber: string | null; purchaseDate: string | null; purchasePrice: number | null; warrantyUntil: string | null;
  status: DeviceStatus; statusReason: string | null; holderEmployeeId: string | null; holderName: string | null; holderCode: string | null;
  note: string | null; createdAt: string;
  /** Số tháng khấu hao riêng (null = theo loại, 0 = không khấu hao). */
  depreciationMonths: number | null;
  /** Số tháng áp dụng (riêng hoặc theo loại); giá trị còn lại = null khi thiếu giá / ngày mua. */
  effectiveDepreciationMonths: number | null; monthsUsed: number | null; accumulatedDepreciation: number | null; bookValue: number | null;
}
export interface IAssignment {
  id: string; employeeId: string; employeeName: string; employeeCode: string; assignedAt: string; assignedByName: string | null;
  assignNote: string | null; returnedAt: string | null; returnedByName: string | null; returnNote: string | null;
}
export interface IHandover {
  id: string; number: string; kind: HandoverKind; deviceId: string; deviceCode: string; deviceName: string; serialNumber: string | null;
  employeeId: string; employeeCode: string; employeeName: string; note: string | null; createdAt: string; createdByName: string;
  requiresConfirmation: boolean; confirmedAt: string | null; confirmedIp: string | null;
}
export interface IDeviceDetail { device: IDevice; history: IAssignment[]; handovers: IHandover[]; attachmentCount: number }
export interface IDeviceAttachment {
  id: string; deviceId: string; kind: AttachmentKind; fileName: string; contentType: string; size: number; createdAt: string; createdByName: string;
}
export interface IAssetSettings { handoverTemplateName: string | null; updatedAt: string | null; updatedByName: string | null }
export interface ITemplateField { name: string; description: string; example: string }
export interface IDeviceRequest {
  categoryId: string | null; name: string; brand: string | null; model: string | null; serialNumber: string | null;
  purchaseDate: string | null; purchasePrice: number | null; warrantyUntil: string | null; note: string | null; depreciationMonths: number | null;
}
export interface IDeviceFilter { search?: string; categoryId?: string | null; status?: DeviceStatus | null; holderId?: string | null }

export interface IService {
  id: string; name: string; vendor: string | null; plan: string | null; url: string | null; seatLimit: number | null; seatsUsed: number;
  billingCycle: BillingCycle; cost: number | null; renewalDate: string | null; ownerDepartmentId: string | null; ownerDepartmentName: string | null;
  adminEmployeeId: string | null; adminName: string | null; status: ServiceStatus; note: string | null;
}
export interface IServiceRequest {
  name: string; vendor: string | null; plan: string | null; url: string | null; seatLimit: number | null; billingCycle: BillingCycle;
  cost: number | null; renewalDate: string | null; ownerDepartmentId: string | null; adminEmployeeId: string | null; note: string | null;
}
export interface ISeat {
  id: string; serviceId: string; serviceName: string; employeeId: string; employeeName: string; employeeCode: string; accountLogin: string;
  role: string | null; note: string | null; grantedAt: string; grantedByName: string | null; revokedAt: string | null; revokedByName: string | null;
}
export interface IGrantSeatRequest { employeeId: string; accountLogin: string; role: string | null; note: string | null }

export interface IHeldDevice { id: string; code: string; name: string; categoryName: string; serialNumber: string | null; assignedAt: string }
export interface IHeldSeat { id: string; serviceId: string; serviceName: string; accountLogin: string; role: string | null; url: string | null; grantedAt: string }
export interface IHoldings { devices: IHeldDevice[]; seats: IHeldSeat[] }

export interface IWarrantyDue { id: string; code: string; name: string; warrantyUntil: string; holderName: string | null }
export interface IRenewalDue { id: string; name: string; renewalDate: string }
export interface IResignedHolding { employeeId: string; code: string; fullName: string; leftAt: string | null; devices: number; seats: number }
export interface IOverview {
  deviceCounts: Record<string, number>; deviceTotal: number; totalPurchaseValue: number; activeServices: number; monthlyServiceCost: number;
  seatsInUse: number; warrantiesDue: IWarrantyDue[]; renewalsDue: IRenewalDue[]; resignedHolding: IResignedHolding[];
  /** Tổng giá trị còn lại (sau khấu hao) của thiết bị chưa thanh lý / mất. */
  totalBookValue: number; unconfirmedHandovers: number;
}

export interface IReview {
  id: string; title: string; status: ReviewStatus; dueDate: string; startedAt: string; startedByName: string | null; closedAt: string | null;
  total: number; decided: number; toRevoke: number;
}
export interface IReviewItem {
  id: string; reviewId: string; reviewTitle: string; seatId: string; serviceName: string; accountLogin: string; employeeId: string;
  employeeName: string; employeeCode: string; reviewerEmployeeId: string | null; reviewerName: string | null; decision: ReviewDecision;
  note: string | null; decidedAt: string | null; decidedByName: string | null;
}
export interface IReviewDetail { review: IReview; items: IReviewItem[] }

export interface IStocktake {
  id: string; title: string; status: ReviewStatus; startedAt: string; startedByName: string | null; closedAt: string | null;
  total: number; checked: number; missing: number;
}
export interface IStocktakeItem {
  id: string; deviceId: string; deviceCode: string; deviceName: string; serialNumber: string | null; expectedHolderName: string | null;
  result: StocktakeResult; note: string | null; checkedAt: string | null; checkedByName: string | null;
}
export interface IStocktakeDetail { stocktake: IStocktake; items: IStocktakeItem[] }
