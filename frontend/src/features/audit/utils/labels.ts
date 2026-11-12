import type { StatusTone } from '@/components/common/StatusBadge';
import { formatDate, formatDateTime } from '@/utils/date';

/** Loại dữ liệu được ghi lịch sử (entity [Audited] ở back-end). */
export const ENTITY_LABEL: Record<string, string> = {
  Employee: 'Nhân viên', Department: 'Phòng ban', Position: 'Chức vụ', AppUser: 'Tài khoản',
  LaborContract: 'Hợp đồng', ContractAmendment: 'Phụ lục HĐ', ContractTemplate: 'Mẫu hợp đồng',
  Shift: 'Ca làm', ScheduleEntry: 'Lịch tuần', Holiday: 'Ngày lễ', LeaveType: 'Loại phép', LeaveAdjustment: 'Điều chỉnh phép',
  Asset: 'Tài liệu', Project: 'Dự án', DocType: 'Loại tài liệu',
  Category: 'Loại thiết bị', Device: 'Thiết bị', Service: 'Dịch vụ', ServiceSeat: 'Tài khoản dịch vụ',
  SystemSetting: 'Cấu hình hệ thống',
};

export const ACTION: Record<string, { label: string; tone: StatusTone }> = {
  Added: { label: 'Thêm', tone: 'success' },
  Modified: { label: 'Sửa', tone: 'info' },
  Deleted: { label: 'Xoá', tone: 'danger' },
};

export const SOURCE_LABEL: Record<string, string> = { web: '', ai: 'qua trợ lý AI', system: 'Hệ thống' };

const FIELD_LABEL: Record<string, string> = {
  FullName: 'Họ tên', Code: 'Mã', Email: 'Email', Phone: 'Điện thoại', DateOfBirth: 'Ngày sinh', DepartmentId: 'Phòng ban',
  PositionId: 'Chức vụ', ManagerId: 'Quản lý', Status: 'Trạng thái', JoinedAt: 'Ngày vào làm', LeftAt: 'Ngày nghỉ việc', UserId: 'Tài khoản',
  Note: 'Ghi chú', DeletedAt: 'Xoá', Name: 'Tên', ParentId: 'Phòng ban cha', HeadEmployeeId: 'Trưởng phòng', MapZone: 'Khu vực 3D',
  SortOrder: 'Thứ tự', Level: 'Cấp bậc', Number: 'Số', Type: 'Loại', SignedDate: 'Ngày ký', StartDate: 'Bắt đầu', EndDate: 'Kết thúc', JobTitle: 'Chức danh',
  SalaryEncrypted: 'Lương', AllowanceEncrypted: 'Phụ cấp', TerminatedOn: 'Ngày chấm dứt', TerminationReason: 'Lý do chấm dứt',
  EffectiveDate: 'Hiệu lực', Content: 'Nội dung', ContractType: 'Loại HĐ', Fields: 'Trường mẫu', IsActive: 'Đang hoạt động',
  MustChangePassword: 'Buộc đổi mật khẩu', PasswordHash: 'Mật khẩu', UserName: 'Tên đăng nhập', Roles: 'Vai trò', EmailConfirmed: 'Đã xác nhận email', TwoFactorEnabled: 'Xác thực 2 lớp',
  StartTime: 'Giờ vào', EndTime: 'Giờ ra', GraceMinutes: 'Phút cho phép trễ', RequiredMinutes: 'Phút phải đủ', EarliestIn: 'Vào sớm nhất',
  LatestIn: 'Vào muộn nhất', BreakStart: 'Nghỉ trưa từ', BreakEnd: 'Nghỉ trưa đến', DayOfWeek: 'Thứ', ShiftId: 'Ca', EmployeeId: 'Nhân viên',
  EffectiveFrom: 'Áp dụng từ', Date: 'Ngày', Days: 'Số ngày', Reason: 'Lý do', CreatedByName: 'Người tạo', IsPaid: 'Có lương',
  UsesAnnualBalance: 'Trừ phép năm',
  CategoryId: 'Loại', Brand: 'Hãng', Model: 'Model', SerialNumber: 'Số serial', PurchaseDate: 'Ngày mua', PurchasePrice: 'Giá mua',
  WarrantyUntil: 'Bảo hành đến', HolderEmployeeId: 'Người giữ', StatusReason: 'Lý do trạng thái', Vendor: 'Nhà cung cấp', Plan: 'Gói',
  Url: 'Đường dẫn', SeatLimit: 'Số ghế tối đa', BillingCycle: 'Chu kỳ thanh toán', Cost: 'Chi phí mỗi kỳ', RenewalDate: 'Ngày gia hạn',
  OwnerDepartmentId: 'Phòng ban sở hữu', AdminEmployeeId: 'Người quản trị', ServiceId: 'Dịch vụ', AccountLogin: 'Tên đăng nhập',
  GrantedAt: 'Ngày cấp', RevokedAt: 'Ngày thu hồi',
  ValuesJson: 'Giá trị cấu hình', SecretsEncrypted: 'Giá trị bí mật', UpdatedById: 'Người sửa', UpdatedByName: 'Tên người sửa',
};
export const fieldLabel = (f: string) => FIELD_LABEL[f] ?? f;

const VALUE_LABEL: Record<string, string> = {
  Probation: 'Thử việc', Active: 'Chính thức', Resigned: 'Đã nghỉ việc', Indefinite: 'Không xác định thời hạn', Fixed: 'Có thời hạn / cố định',
  Flexible: 'Linh hoạt', InStock: 'Trong kho', InUse: 'Đang dùng', Repair: 'Bảo trì', Retired: 'Thanh lý', Lost: 'Mất',
  Monthly: 'Hàng tháng', Yearly: 'Hàng năm', Cancelled: 'Đã huỷ', true: 'Có', false: 'Không',
  Sunday: 'Chủ nhật', Monday: 'Thứ 2', Tuesday: 'Thứ 3', Wednesday: 'Thứ 4', Thursday: 'Thứ 5', Friday: 'Thứ 6', Saturday: 'Thứ 7',
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WEEKDAY = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

/** Giá trị hiển thị: ngày dd/MM/yyyy, thời điểm giờ VN, enum tiếng Việt, Id → tên (nếu tra được). */
export function formatValue(field: string, v: string | null, names: Map<string, string>): string {
  if (v == null || v === '') return '—';
  if (field === 'DayOfWeek' && /^\d$/.test(v)) return WEEKDAY[Number(v)];
  if (GUID.test(v)) return names.get(v.toLowerCase()) ?? `#${v.slice(0, 8)}`;
  if (DATE.test(v)) return formatDate(v);
  if (INSTANT.test(v)) return formatDateTime(v);
  return VALUE_LABEL[v] ?? v;
}
