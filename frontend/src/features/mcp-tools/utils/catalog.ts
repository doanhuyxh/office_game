/**
 * Danh mục công cụ (tool) của máy chủ MCP OfficeHub — bảo trì THỦ CÔNG.
 *
 * ⚠️ Khi thêm / sửa / xoá tool trong `backend/src/OfficeHub.Mcp/Tools/*.cs`
 *    PHẢI cập nhật file này cho khớp (tên, tiêu đề, mô tả, tham số, loại, endpoint).
 *    Đây là màn hình tham chiếu cho quản trị viên nên không được để lệch với code.
 *    Xem thêm: .agent/business/mcp.md.
 */

export type McpToolKind = 'read' | 'write' | 'destructive';

export interface McpToolParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
  /** Giá trị mặc định khi không truyền (hiển thị). */
  default?: string;
}

export interface McpTool {
  /** Tên tool (client AI gọi bằng tên này). */
  name: string;
  /** Tiêu đề tiếng Việt (Title). */
  title: string;
  /** Mô tả (Description) — AI đọc để biết khi nào dùng. */
  description: string;
  kind: McpToolKind;
  /** Gọi nhiều lần cho cùng kết quả (annotation Idempotent). */
  idempotent?: boolean;
  /** REST của Api mà tool gọi lại (bằng token của người dùng). */
  endpoint: string;
  params: McpToolParam[];
}

export interface McpToolGroup {
  name: string;
  tools: McpTool[];
}

/** Thông tin máy chủ MCP (một máy chủ duy nhất: OfficeHub.Mcp). */
export const MCP_SERVER = {
  name: 'OfficeHub.Mcp',
  endpoint: '/mcp',
  transport: 'Streamable HTTP (stateless)',
  auth: 'Bearer ohk_… (token cá nhân) hoặc đăng nhập OAuth 2.1',
  note: 'Máy chủ không đọc DB — mỗi tool gọi lại REST của Api bằng token của người dùng, nên phân quyền và validate đều do Api làm. Tool ghi yêu cầu AI hỏi xác nhận trước.',
} as const;

/** Những việc KHÔNG mở cho AI (token bị Api chặn → 403). */
export const MCP_EXCLUDED = [
  'Hợp đồng lao động & mẫu hợp đồng (/api/contracts/*)',
  'Bảng lương, phiếu lương, báo cáo tiền (/api/payroll/*, /api/reports/*)',
  'Thông tin cá nhân nhạy cảm: CCCD, ngân hàng, địa chỉ (/api/org/profile/*)',
  'Đổi mật khẩu, tạo / quản lý token, OAuth (trừ /api/auth/me)',
  'Thêm / sửa nhân viên, tài khoản, vai trò, ca, lịch, ngày lễ; điều chỉnh quỹ phép',
  'Tin nhắn (chat) — kênh toàn văn phòng, kênh phòng và tin 1-1 (/api/chat/*)',
  'Bảng tin: đăng / sửa / xoá bài, bình luận, cảm xúc, kiểm duyệt (chỉ đọc qua list_news_feed / get_news_post)',
  'Dự án: tạo / sửa / đóng dự án, thành viên, phân bổ %, mốc nghiệm thu, sửa / xoá việc, tài chính / lãi lỗ, hợp đồng bán & đợt thu, yêu cầu thay đổi (CR) (chỉ đọc dự án + tạo / chuyển / bình luận việc)',
  'Kho tài liệu: tải lên, sửa, ban hành, lưu trữ, xoá, thùng rác, nhật ký truy cập, quản trị (chỉ đọc + lấy link xem / tải)',
  'Kinh doanh: khách hàng, cơ hội, hợp đồng bán, công nợ (/api/sales/*)',
  'Tài chính: sổ thu chi, quỹ, đề nghị chi (/api/finance/*); đơn duyệt có bước Tài chính bị ẩn và không duyệt / huỷ được qua AI',
  'Tài sản: đăng ký / sửa thiết bị và dịch vụ, cấp phát, thu hồi, rà soát quyền, kiểm kê, xuất Excel (chỉ đọc qua get_my_assets / get_employee_assets)',
] as const;

const P = {
  month: { name: 'month', type: 'string', required: false, description: 'Tháng dạng yyyy-MM', default: 'tháng hiện tại' },
  year: { name: 'year', type: 'int', required: false, description: 'Năm', default: 'năm hiện tại' },
} satisfies Record<string, McpToolParam>;

export const MCP_TOOL_GROUPS: McpToolGroup[] = [
  {
    name: 'Chung',
    tools: [
      { name: 'get_my_profile', title: 'Thông tin của tôi', kind: 'read', endpoint: 'GET /api/auth/me, /api/org/employees/me',
        description: 'Thông tin người đang kết nối: tài khoản, vai trò (employee / manager / hr / admin), hồ sơ nhân viên (mã, phòng ban, chức vụ, quản lý trực tiếp) và ngày giờ hiện tại theo giờ Việt Nam. Gọi đầu tiên khi cần biết "hôm nay" là ngày nào hoặc người dùng có quyền gì.',
        params: [] },
      { name: 'list_notifications', title: 'Thông báo của tôi', kind: 'read', endpoint: 'GET /api/notifications',
        description: 'Thông báo trong chuông OfficeHub (mới nhất trước) kèm số chưa đọc.',
        params: [{ name: 'take', type: 'int', required: false, description: 'Số thông báo lấy về (1–100)', default: '20' }] },
      { name: 'mark_notifications_read', title: 'Đánh dấu đã đọc', kind: 'write', idempotent: true, endpoint: 'POST /api/notifications/{id}/read · /read-all',
        description: 'Đánh dấu một thông báo (truyền notificationId) hoặc TẤT CẢ thông báo (bỏ trống) là đã đọc.',
        params: [{ name: 'notificationId', type: 'Guid', required: false, description: 'Id thông báo; bỏ trống = đánh dấu tất cả' }] },
      { name: 'search_colleagues', title: 'Tìm đồng nghiệp', kind: 'read', endpoint: 'GET /api/org/employees',
        description: 'Danh bạ công ty: tìm nhân viên theo tên, mã hoặc email; lọc theo phòng ban. Trả về id, mã, họ tên, email, điện thoại, phòng ban, chức vụ (positionLevel 1 = cao nhất), chức danh (jobTitle), quản lý trực tiếp. status (thử việc / chính thức) chỉ có với chính người dùng và cấp dưới của họ (HR: mọi người).',
        params: [
          { name: 'search', type: 'string', required: false, description: 'Từ khoá: tên, mã nhân viên hoặc email', default: 'tất cả' },
          { name: 'departmentId', type: 'Guid', required: false, description: 'Id phòng ban (từ list_departments)' },
        ] },
      { name: 'list_departments', title: 'Phòng ban', kind: 'read', endpoint: 'GET /api/org/departments',
        description: 'Danh sách phòng ban: id, tên, phòng cha (parentId — cây nhiều cấp), trưởng phòng, số nhân viên, mô tả chức năng ngắn. hasGuide = có hướng dẫn chi tiết → gọi get_department.',
        params: [] },
      { name: 'list_positions', title: 'Chức vụ (cấp bậc)', kind: 'read', endpoint: 'GET /api/org/positions',
        description: 'Thang cấp bậc của công ty: id, tên chức vụ, level (1 = cao nhất), số nhân viên, mô tả vai trò ngắn; hasGuide = có hướng dẫn chi tiết → gọi get_position.',
        params: [] },
      { name: 'get_my_role', title: 'Vai trò của tôi', kind: 'read', endpoint: 'GET /api/org/employees/me/role',
        description: 'Vai trò và trách nhiệm của người dùng: chức danh, chức vụ (cấp bậc) kèm mô tả + hướng dẫn, phòng ban và các phòng cấp trên, quản lý trực tiếp, các phòng họ làm trưởng. GỌI TRƯỚC khi trả lời câu hỏi về công việc, trách nhiệm, quyền hạn, quy trình hay nên liên hệ ai.',
        params: [] },
      { name: 'get_department', title: 'Chi tiết phòng ban', kind: 'read', endpoint: 'GET /api/org/departments/{id}',
        description: 'Mô tả + hướng dẫn đầy đủ của một phòng ban (trách nhiệm, quy trình, đầu mối liên hệ, quy định riêng), phòng cha, trưởng phòng.',
        params: [{ name: 'departmentId', type: 'Guid', required: true, description: 'Id phòng ban (từ list_departments hoặc get_my_role)' }] },
      { name: 'get_position', title: 'Chi tiết chức vụ', kind: 'read', endpoint: 'GET /api/org/positions/{id}',
        description: 'Mô tả + hướng dẫn đầy đủ của một chức vụ / cấp bậc (trách nhiệm, quyền hạn, KPI, kỹ năng).',
        params: [{ name: 'positionId', type: 'Guid', required: true, description: 'Id chức vụ (từ list_positions hoặc get_my_role)' }] },
    ],
  },
  {
    name: 'Chấm công',
    tools: [
      { name: 'get_today_attendance', title: 'Chấm công hôm nay', kind: 'read', endpoint: 'GET /api/attendance/today',
        description: 'Trạng thái chấm công hôm nay của tôi: đã vào chưa (checkedIn), hành động kế tiếp (in / out), các phiên vào–ra, số phút đã làm / đi muộn, ca làm hôm nay và giờ server.',
        params: [] },
      { name: 'check_in_out', title: 'Chấm công vào / ra', kind: 'write', endpoint: 'POST /api/attendance/check',
        description: 'Chấm công: đang "ra" thì chấm VÀO, đang "vào" thì chấm RA. Qua trợ lý AI LUÔN ghi là làm việc TỪ XA (Remote), giờ do máy chủ ghi. Chỉ gọi khi người dùng yêu cầu rõ ràng.',
        params: [] },
      { name: 'get_my_timesheet', title: 'Bảng công tháng', kind: 'read', endpoint: 'GET /api/attendance/my',
        description: 'Bảng công một tháng của tôi: từng ngày (trạng thái, giờ vào / ra, phút làm, đi muộn, về sớm, nghỉ phép, ngày lễ, tăng ca) và phần tổng hợp tháng.',
        params: [P.month] },
      { name: 'list_holidays', title: 'Ngày lễ', kind: 'read', endpoint: 'GET /api/attendance/holidays',
        description: 'Danh sách ngày lễ của công ty trong một năm.', params: [P.year] },
      { name: 'list_shifts', title: 'Ca làm việc', kind: 'read', endpoint: 'GET /api/attendance/shifts',
        description: 'Các ca làm việc đang có (giờ bắt đầu / kết thúc, nghỉ trưa, ca cố định hay linh hoạt).', params: [] },
      { name: 'list_my_corrections', title: 'Giải trình của tôi', kind: 'read', endpoint: 'GET /api/attendance/corrections/my',
        description: 'Các đơn giải trình chấm công (quên chấm vào / ra) của tôi và trạng thái duyệt.', params: [P.month] },
      { name: 'submit_attendance_correction', title: 'Gửi giải trình chấm công', kind: 'write', endpoint: 'POST /api/attendance/corrections',
        description: 'Gửi đơn giải trình khi quên chấm công (đi qua luồng duyệt quản lý → HR). Chỉ trong 31 ngày gần nhất, không cho ngày tương lai. XÁC NHẬN ngày, giờ, loại và lý do với người dùng trước khi gửi.',
        params: [
          { name: 'workDate', type: 'string', required: true, description: 'Ngày cần giải trình, yyyy-MM-dd' },
          { name: 'type', type: 'string', required: true, description: '"In" = giờ vào, "Out" = giờ ra' },
          { name: 'time', type: 'string', required: true, description: 'Giờ thực tế, HH:mm (24h)' },
          { name: 'workMode', type: 'string', required: true, description: '"Onsite" = tại văn phòng, "Remote" = từ xa' },
          { name: 'reason', type: 'string', required: true, description: 'Lý do (≤ 500 ký tự)' },
        ] },
      { name: 'list_my_overtime', title: 'Tăng ca của tôi', kind: 'read', endpoint: 'GET /api/attendance/overtime/my',
        description: 'Các đơn tăng ca của tôi (số phút, loại ngày & hệ số 150/200/300%, trạng thái duyệt).', params: [P.month] },
      { name: 'preview_overtime', title: 'Xem trước tăng ca', kind: 'read', endpoint: 'GET /api/attendance/overtime/preview',
        description: 'Tính trước một đơn tăng ca (chưa gửi): số phút, loại ngày, hệ số, tổng tháng / năm và cảnh báo vượt 40 giờ/tháng, 200 giờ/năm.',
        params: [
          { name: 'workDate', type: 'string', required: true, description: 'Ngày tăng ca, yyyy-MM-dd' },
          { name: 'startTime', type: 'string', required: true, description: 'Giờ bắt đầu HH:mm' },
          { name: 'endTime', type: 'string', required: true, description: 'Giờ kết thúc HH:mm (cùng ngày)' },
        ] },
      { name: 'register_overtime', title: 'Đăng ký tăng ca', kind: 'write', endpoint: 'POST /api/attendance/overtime',
        description: 'Gửi đơn tăng ca (đăng ký trước hoặc khai bù trong 7 ngày; đi qua luồng duyệt). Chưa hỗ trợ qua đêm. Nên gọi preview_overtime trước và XÁC NHẬN với người dùng.',
        params: [
          { name: 'workDate', type: 'string', required: true, description: 'Ngày tăng ca, yyyy-MM-dd' },
          { name: 'startTime', type: 'string', required: true, description: 'Giờ bắt đầu HH:mm' },
          { name: 'endTime', type: 'string', required: true, description: 'Giờ kết thúc HH:mm (cùng ngày)' },
          { name: 'reason', type: 'string', required: true, description: 'Lý do / công việc (≤ 500 ký tự)' },
        ] },
    ],
  },
  {
    name: 'Nghỉ phép',
    tools: [
      { name: 'list_leave_types', title: 'Loại nghỉ phép', kind: 'read', endpoint: 'GET /api/leave/types',
        description: 'Các loại nghỉ (mã, tên, có lương không, có trừ quỹ phép năm không). Dùng mã hoặc tên khi gửi đơn.', params: [] },
      { name: 'get_leave_balance', title: 'Quỹ phép của tôi', kind: 'read', endpoint: 'GET /api/leave/balance',
        description: 'Quỹ phép năm của tôi: được hưởng năm nay, đã tích luỹ, chuyển từ năm trước, đã dùng, đang chờ duyệt, còn lại (available).', params: [] },
      { name: 'list_my_leave_requests', title: 'Đơn nghỉ của tôi', kind: 'read', endpoint: 'GET /api/leave/requests/my',
        description: 'Các đơn nghỉ phép của tôi trong một năm và trạng thái duyệt.', params: [P.year] },
      { name: 'preview_leave', title: 'Xem trước số ngày nghỉ', kind: 'read', endpoint: 'GET /api/leave/preview',
        description: 'Tính số ngày công sẽ bị trừ cho khoảng nghỉ (bỏ cuối tuần, ngày lễ theo lịch làm việc của tôi).',
        params: [
          { name: 'startDate', type: 'string', required: true, description: 'Ngày bắt đầu yyyy-MM-dd' },
          { name: 'endDate', type: 'string', required: true, description: 'Ngày kết thúc yyyy-MM-dd' },
          { name: 'period', type: 'string', required: false, description: '"Morning" / "Afternoon" — nửa ngày chỉ khi bắt đầu = kết thúc', default: 'FullDay' },
        ] },
      { name: 'submit_leave_request', title: 'Gửi đơn nghỉ phép', kind: 'write', endpoint: 'POST /api/leave/requests',
        description: 'Gửi đơn nghỉ phép (đi qua luồng duyệt quản lý → HR). Nên gọi preview_leave và get_leave_balance trước, rồi XÁC NHẬN loại nghỉ, ngày, buổi và lý do với người dùng.',
        params: [
          { name: 'leaveType', type: 'string', required: true, description: 'Loại nghỉ: mã (vd annual), tên hoặc id (từ list_leave_types)' },
          { name: 'startDate', type: 'string', required: true, description: 'Ngày bắt đầu yyyy-MM-dd' },
          { name: 'endDate', type: 'string', required: true, description: 'Ngày kết thúc yyyy-MM-dd' },
          { name: 'period', type: 'string', required: false, description: '"Morning" / "Afternoon" — nửa ngày chỉ khi bắt đầu = kết thúc', default: 'FullDay' },
          { name: 'reason', type: 'string', required: false, description: 'Lý do' },
        ] },
    ],
  },
  {
    name: 'Phê duyệt',
    tools: [
      { name: 'list_approval_inbox', title: 'Đơn chờ tôi duyệt', kind: 'read', endpoint: 'GET /api/approval/inbox',
        description: 'Các đơn đang chờ TÔI duyệt (quản lý: đơn của cấp dưới; người được uỷ quyền: đơn duyệt thay — decideOnBehalfOfName; HR: bước HR). Mỗi đơn có id, loại, tiêu đề, tóm tắt, người gửi, các bước.', params: [] },
      { name: 'list_my_approval_requests', title: 'Đơn tôi đã gửi', kind: 'read', endpoint: 'GET /api/approval/mine',
        description: 'Tất cả đơn tôi đã gửi (nghỉ phép, giải trình, tăng ca) và tiến độ duyệt từng bước.', params: [] },
      { name: 'get_approval_request', title: 'Chi tiết đơn', kind: 'read', endpoint: 'GET /api/approval/{id}',
        description: 'Chi tiết một đơn trong luồng duyệt (các bước, người duyệt, ghi chú, tôi có được duyệt / huỷ không).',
        params: [{ name: 'requestId', type: 'Guid', required: true, description: 'Id đơn duyệt' }] },
      { name: 'approve_request', title: 'Duyệt đơn', kind: 'destructive', endpoint: 'POST /api/approval/{id}/approve',
        description: 'DUYỆT một đơn đang chờ tôi. Có hiệu lực ngay và gửi thông báo cho người gửi. Luôn đọc lại tên người gửi, loại đơn, ngày và hỏi xác nhận rõ ràng trước khi gọi. Không duyệt hàng loạt khi chưa được yêu cầu.',
        params: [
          { name: 'requestId', type: 'Guid', required: true, description: 'Id đơn duyệt' },
          { name: 'comment', type: 'string', required: false, description: 'Ghi chú' },
        ] },
      { name: 'reject_request', title: 'Từ chối đơn', kind: 'destructive', endpoint: 'POST /api/approval/{id}/reject',
        description: 'TỪ CHỐI một đơn đang chờ tôi (bắt buộc lý do). Có hiệu lực ngay và gửi thông báo cho người gửi. Hỏi người dùng xác nhận trước khi gọi.',
        params: [
          { name: 'requestId', type: 'Guid', required: true, description: 'Id đơn duyệt' },
          { name: 'comment', type: 'string', required: true, description: 'Lý do từ chối (bắt buộc)' },
        ] },
      { name: 'cancel_my_request', title: 'Huỷ đơn của tôi', kind: 'destructive', idempotent: true, endpoint: 'POST /api/approval/{id}/cancel',
        description: 'Huỷ một đơn TÔI đã gửi khi đơn còn đang chờ duyệt. Hỏi người dùng xác nhận trước khi gọi.',
        params: [{ name: 'requestId', type: 'Guid', required: true, description: 'Id đơn duyệt' }] },
    ],
  },
  {
    name: 'Phòng họp',
    tools: [
      { name: 'list_meeting_rooms', title: 'Phòng họp & tình trạng', kind: 'read', endpoint: 'GET /api/meetings/bookings/now',
        description: 'Các phòng họp (id, tên, sức chứa) kèm lịch đang diễn ra và lịch kế tiếp trong hôm nay.', params: [] },
      { name: 'list_meetings', title: 'Lịch họp', kind: 'read', endpoint: 'GET /api/meetings/bookings',
        description: 'Lịch đặt phòng họp trong một ngày (mặc định hôm nay). Thời điểm trả về là UTC — đổi sang giờ Việt Nam khi trả lời.',
        params: [
          { name: 'date', type: 'string', required: false, description: 'Ngày yyyy-MM-dd (giờ Việt Nam)', default: 'hôm nay' },
          { name: 'mine', type: 'bool', required: false, description: 'true = chỉ lịch tôi tổ chức hoặc được mời', default: 'false' },
        ] },
      { name: 'book_meeting_room', title: 'Đặt phòng họp', kind: 'write', endpoint: 'POST /api/meetings/bookings',
        description: 'Đặt phòng họp và gửi lời mời (chuông + email) cho người tham gia. Hệ thống chặn trùng giờ. Gọi list_meeting_rooms / list_meetings trước để chọn phòng trống, rồi XÁC NHẬN với người dùng.',
        params: [
          { name: 'room', type: 'string', required: true, description: 'Phòng: id (vd meeting-large) hoặc tên' },
          { name: 'title', type: 'string', required: true, description: 'Tiêu đề cuộc họp' },
          { name: 'date', type: 'string', required: true, description: 'Ngày yyyy-MM-dd (giờ Việt Nam)' },
          { name: 'startTime', type: 'string', required: true, description: 'Giờ bắt đầu HH:mm (giờ Việt Nam)' },
          { name: 'endTime', type: 'string', required: true, description: 'Giờ kết thúc HH:mm (giờ Việt Nam)' },
          { name: 'attendees', type: 'string', required: false, description: 'Người mời: mã nhân viên, email hoặc họ tên, cách nhau dấu phẩy' },
          { name: 'note', type: 'string', required: false, description: 'Ghi chú' },
        ] },
      { name: 'cancel_meeting', title: 'Huỷ lịch họp', kind: 'destructive', idempotent: true, endpoint: 'DELETE /api/meetings/bookings/{id}',
        description: 'Huỷ lịch họp (chỉ người đặt hoặc HR). Người được mời nhận thông báo huỷ. Hỏi người dùng xác nhận trước khi gọi.',
        params: [{ name: 'bookingId', type: 'Guid', required: true, description: 'Id lịch họp (từ list_meetings)' }] },
    ],
  },
  {
    name: 'Bảng tin',
    tools: [
      { name: 'list_news_feed', title: 'Bảng tin công ty', kind: 'read', endpoint: 'GET /api/news/feed',
        description: 'Bài mới nhất trên Bảng tin mà tôi được xem (toàn công ty, phòng ban của tôi, bài gửi riêng cho tôi): tác giả, nội dung chữ thuần, phạm vi, số cảm xúc / bình luận, tên tệp đính kèm. Bài ghim ở mảng pinned (chỉ trang đầu). Còn bài cũ hơn thì nextCursor khác null.',
        params: [
          { name: 'take', type: 'int', required: false, description: 'Số bài mỗi trang 1–30', default: '10' },
          { name: 'cursor', type: 'long', required: false, description: 'nextCursor của trang trước (bỏ trống = trang đầu)' },
          { name: 'authorId', type: 'Guid', required: false, description: 'Chỉ bài của một người: id tài khoản (author.userId)' },
        ] },
      { name: 'get_news_post', title: 'Chi tiết bài trên Bảng tin', kind: 'read', endpoint: 'GET /api/news/posts/{id} + /comments',
        description: 'Một bài trên Bảng tin kèm bình luận (chữ thuần). Bài ngoài phạm vi của tôi trả 404 như không tồn tại.',
        params: [{ name: 'postId', type: 'Guid', required: true, description: 'Id bài (từ list_news_feed)' }] },
    ],
  },
  {
    name: 'Tài sản',
    tools: [
      { name: 'get_my_assets', title: 'Tài sản của tôi', kind: 'read', endpoint: 'GET /api/assets/my',
        description: 'Tài sản công ty đang giao cho tôi: thiết bị (mã, tên, loại, serial, ngày nhận) và tài khoản dịch vụ như Figma, Google Workspace… (dịch vụ, tên đăng nhập, vai trò, ngày cấp). Không có giá và không có mật khẩu.',
        params: [] },
      { name: 'get_employee_assets', title: 'Tài sản của một nhân viên', kind: 'read', endpoint: 'GET /api/assets/employees/{id}/holdings',
        description: '(Quản lý / HR) Thiết bị và tài khoản dịch vụ một nhân viên đang giữ. Quản lý chỉ xem được bản thân và cấp dưới; không đủ quyền trả 404.',
        params: [{ name: 'employeeId', type: 'Guid', required: true, description: 'Id nhân viên (từ search_colleagues)' }] },
    ],
  },
  {
    name: 'Dự án',
    tools: [
      { name: 'list_projects', title: 'Dự án', kind: 'read', endpoint: 'GET /api/projects',
        description: 'Dự án tôi xem được (thành viên; HR / Ban giám đốc thấy tất cả trừ khi mine=true): mã, tên, loại, trạng thái, phòng ban, hợp đồng bán gắn kèm (không tiền), ngày bắt đầu / kết thúc, ngân sách ngày công, vai trò của tôi, canWork, số thành viên, đếm việc, mốc.',
        params: [
          { name: 'mine', type: 'bool', required: false, description: 'Chỉ dự án tôi là thành viên', default: 'false' },
          { name: 'includeClosed', type: 'bool', required: false, description: 'Gồm cả dự án đã đóng', default: 'false' },
        ] },
      { name: 'get_project', title: 'Chi tiết dự án', kind: 'read', endpoint: 'GET /api/projects/{id}',
        description: 'Một dự án: thông tin chung, thành viên (mã, họ tên, vai trò Manager / Member), mốc nghiệm thu (tên, hạn, trạng thái).',
        params: [{ name: 'project', type: 'string', required: true, description: 'Id hoặc mã dự án (vd WEB-2026)' }] },
      { name: 'list_project_tasks', title: 'Công việc của dự án', kind: 'read', endpoint: 'GET /api/projects/{id}/tasks',
        description: 'Việc trên kanban của dự án: mã việc, tên, mô tả, trạng thái (Todo / Doing / Review / Done), người làm, hạn, ước lượng, overdue, số bình luận. Mặc định bỏ việc đã Xong.',
        params: [
          { name: 'project', type: 'string', required: true, description: 'Id hoặc mã dự án' },
          { name: 'state', type: 'string', required: false, description: 'Todo / Doing / Review / Done (hoặc Cần làm / Đang làm / Chờ review / Xong)', default: 'mọi việc chưa xong' },
          { name: 'assignee', type: 'string', required: false, description: 'Người làm: mã nhân viên hoặc họ tên (khớp một phần)' },
        ] },
      { name: 'list_my_tasks', title: 'Việc của tôi', kind: 'read', endpoint: 'GET /api/projects/tasks/mine',
        description: 'Việc chưa xong được giao cho tôi ở mọi dự án (tối đa 200), sắp theo hạn.', params: [] },
      { name: 'create_task', title: 'Tạo việc trong dự án', kind: 'write', endpoint: 'POST /api/projects/{id}/tasks',
        description: 'Tạo việc trên kanban (chỉ thành viên, dự án đang chạy). Người được giao nhận chuông. Hạn không trước hôm nay. AI xác nhận dự án, tên việc, người làm, hạn trước khi gọi.',
        params: [
          { name: 'project', type: 'string', required: true, description: 'Id hoặc mã dự án' },
          { name: 'title', type: 'string', required: true, description: 'Tên việc (≤ 300 ký tự)' },
          { name: 'description', type: 'string', required: false, description: 'Mô tả (≤ 5000 ký tự)' },
          { name: 'assignee', type: 'string', required: false, description: 'Người làm: mã nhân viên, email hoặc họ tên — phải là thành viên dự án' },
          { name: 'dueDate', type: 'string', required: false, description: 'Hạn yyyy-MM-dd (không trước hôm nay)' },
          { name: 'estimateDays', type: 'decimal', required: false, description: 'Ước lượng số ngày công' },
          { name: 'state', type: 'string', required: false, description: 'Todo / Doing / Review / Done', default: 'Todo' },
        ] },
      { name: 'update_task_status', title: 'Chuyển trạng thái việc', kind: 'write', idempotent: true, endpoint: 'POST /api/projects/tasks/{id}/move',
        description: 'Chuyển việc sang Todo / Doing / Review / Done (như kéo thả trên kanban). Chỉ thành viên dự án đang chạy. AI hỏi xác nhận trước khi gọi.',
        params: [
          { name: 'task', type: 'string', required: true, description: 'Id hoặc mã việc (vd WEB-12)' },
          { name: 'state', type: 'string', required: true, description: 'Todo / Doing / Review / Done (hoặc Cần làm / Đang làm / Chờ review / Xong)' },
        ] },
      { name: 'list_task_comments', title: 'Bình luận của việc', kind: 'read', endpoint: 'GET /api/projects/tasks/{id}/comments',
        description: 'Bình luận của một việc theo thứ tự thời gian (người viết, nội dung, thời điểm).',
        params: [{ name: 'task', type: 'string', required: true, description: 'Id hoặc mã việc (vd WEB-12)' }] },
      { name: 'comment_task', title: 'Bình luận việc', kind: 'write', endpoint: 'POST /api/projects/tasks/{id}/comments',
        description: 'Thêm bình luận vào việc (chỉ thành viên dự án); người làm việc nhận chuông. AI đọc lại nội dung cho người dùng xác nhận trước khi gửi.',
        params: [
          { name: 'task', type: 'string', required: true, description: 'Id hoặc mã việc (vd WEB-12)' },
          { name: 'content', type: 'string', required: true, description: 'Nội dung (≤ 3000 ký tự)' },
        ] },
      { name: 'get_project_effort', title: 'Ngày công dự án', kind: 'read', endpoint: 'GET /api/projects/{id}/effort',
        description: '(Quản lý dự án / HR / Ban giám đốc) Ngày công theo chấm công: mỗi người × tháng = ngày có mặt × % phân bổ, tổng, ngân sách ngày công, tháng đã chốt. Không có số tiền.',
        params: [{ name: 'project', type: 'string', required: true, description: 'Id hoặc mã dự án' }] },
    ],
  },
  {
    name: 'Tài liệu',
    tools: [
      { name: 'list_document_spaces', title: 'Kho tài liệu', kind: 'read', endpoint: 'GET /api/documents/spaces',
        description: 'Các kho tôi vào được: Công ty (Company), phòng ban (Department), dự án (Project) — kind, id, tên, mã kho, canWrite, canManage, closed.', params: [] },
      { name: 'list_document_folders', title: 'Thư mục trong kho', kind: 'read', endpoint: 'GET /api/documents/folders',
        description: 'Cây thư mục của một kho (id, parentId, tên, số tài liệu).',
        params: [
          { name: 'spaceKind', type: 'string', required: true, description: 'Company / Department / Project' },
          { name: 'spaceId', type: 'Guid', required: false, description: 'Id phòng ban / dự án (bỏ trống với kho Công ty)' },
        ] },
      { name: 'search_documents', title: 'Tìm tài liệu', kind: 'read', endpoint: 'GET /api/documents/assets',
        description: 'Tìm theo tiêu đề, mã TL-…, số hiệu, mô tả, thẻ, tên file. Không chọn kho → bắt buộc có từ khoá, tìm mọi kho tôi vào được; chọn kho không từ khoá → liệt kê thư mục. Trả trang { items, total, page, pageSize }.',
        params: [
          { name: 'search', type: 'string', required: false, description: 'Từ khoá' },
          { name: 'spaceKind', type: 'string', required: false, description: 'Company / Department / Project' },
          { name: 'spaceId', type: 'Guid', required: false, description: 'Id kho (phòng ban / dự án)' },
          { name: 'folderId', type: 'Guid', required: false, description: 'Id thư mục' },
          { name: 'status', type: 'string', required: false, description: 'Draft / PendingApproval / Published / Archived' },
          { name: 'kind', type: 'string', required: false, description: 'Document / Image / Video / Audio / Archive / Other' },
          { name: 'page', type: 'int', required: false, description: 'Trang (từ 1)', default: '1' },
          { name: 'pageSize', type: 'int', required: false, description: 'Số dòng mỗi trang 1–50', default: '20' },
        ] },
      { name: 'list_recent_documents', title: 'Tài liệu mới ban hành', kind: 'read', endpoint: 'GET /api/documents/recent',
        description: 'Tài liệu mới được ban hành gần đây ở các kho tôi vào được (mới nhất trước).',
        params: [
          { name: 'days', type: 'int', required: false, description: 'Trong bao nhiêu ngày (1–365)', default: '60' },
          { name: 'take', type: 'int', required: false, description: 'Số tài liệu tối đa (1–50)', default: '20' },
        ] },
      { name: 'get_document', title: 'Chi tiết tài liệu', kind: 'read', endpoint: 'GET /api/documents/assets/{id}',
        description: 'Thông tin chung, mô tả, kho + thư mục, người phụ trách, ngày ban hành, lý do từ chối, các phiên bản. Mở / tải file → get_document_link.',
        params: [{ name: 'document', type: 'string', required: true, description: 'Id, mã (TL-…) hoặc số hiệu ban hành' }] },
      { name: 'get_document_link', title: 'Link xem / tải tài liệu', kind: 'read', endpoint: 'GET /api/documents/assets/{id}/file',
        description: 'Link tạm (presigned S3) để xem / tải file: 15 phút (video / âm thanh 3 giờ). Mỗi lần gọi được ghi vào nhật ký xem / tải của tài liệu.',
        params: [
          { name: 'document', type: 'string', required: true, description: 'Id, mã (TL-…) hoặc số hiệu ban hành' },
          { name: 'version', type: 'int', required: false, description: 'Số phiên bản', default: 'bản hiện tại' },
          { name: 'download', type: 'bool', required: false, description: 'true = link tải về; false = xem trực tiếp nếu được', default: 'false' },
        ] },
    ],
  },
  {
    name: 'Quản lý / HR',
    tools: [
      { name: 'get_team_attendance', title: 'Chấm công của nhóm', kind: 'read', endpoint: 'GET /api/attendance/board',
        description: '(Quản lý / HR) Chấm công trong một ngày của các nhân viên tôi được xem (quản lý: cấp dưới; HR: tất cả). Api trả 403 nếu không đủ quyền.',
        params: [{ name: 'date', type: 'string', required: false, description: 'Ngày yyyy-MM-dd', default: 'hôm nay' }] },
      { name: 'get_team_attendance_report', title: 'Tổng hợp công tháng của nhóm', kind: 'read', endpoint: 'GET /api/attendance/report',
        description: '(Quản lý / HR) Tổng hợp công một tháng theo từng nhân viên tôi được xem.', params: [P.month] },
      { name: 'get_employee_timesheet', title: 'Bảng công của một nhân viên', kind: 'read', endpoint: 'GET /api/attendance/employees/{id}',
        description: '(Quản lý / HR) Bảng công tháng của một nhân viên (employeeId lấy từ search_colleagues). Quản lý chỉ xem được cấp dưới.',
        params: [
          { name: 'employeeId', type: 'Guid', required: true, description: 'Id nhân viên' },
          P.month,
        ] },
      { name: 'list_team_leave', title: 'Lịch nghỉ của nhóm', kind: 'read', endpoint: 'GET /api/leave/requests',
        description: '(Quản lý / HR) Các đơn nghỉ giao với khoảng ngày, của những người tôi được xem (quản lý: bản thân + cấp dưới; HR: tất cả).',
        params: [
          { name: 'from', type: 'string', required: true, description: 'Từ ngày yyyy-MM-dd' },
          { name: 'to', type: 'string', required: true, description: 'Đến ngày yyyy-MM-dd' },
        ] },
    ],
  },
];

export const MCP_TOOL_COUNT = MCP_TOOL_GROUPS.reduce((n, g) => n + g.tools.length, 0);
