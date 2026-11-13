# Kế hoạch: Kinh doanh, Dự án, Tài chính (dòng tiền)

> **Trạng thái: ĐÃ DUYỆT 2026-11-08** (chủ dự án trả lời mục 10). Giai đoạn 1 đang làm: **xong** quyền tài chính theo chức vụ + Finance lõi (quỹ, sổ thu chi, khoá sổ, đề nghị chi — [.agent/business/finance.md](../.agent/business/finance.md)); **xong** Sales (khách hàng, cơ hội, hợp đồng bán, lịch thu, công nợ, ghi nhận thu → sổ — [.agent/business/sales.md](../.agent/business/sales.md)); **xong** phụ lục hợp đồng (2b-2), chứng từ + Excel tài chính ([.agent/business/finance-docs.md](../.agent/business/finance-docs.md)); **xong** báo giá (mẫu Word + duyệt chiết khấu — [.agent/business/sales-quotes.md](../.agent/business/sales-quotes.md); chưa xuất PDF). **Giai đoạn 1 hoàn tất.** **Giai đoạn 3 (Affiliate) trở đi: chủ dự án quyết định chưa làm, tạm dừng (2026-11-08).** **Giai đoạn 2a xong** (module Projects — [.agent/business/projects.md](../.agent/business/projects.md)): dự án tách khỏi Documents, thành viên + phân bổ, mốc ↔ đợt thu, công việc, ngày công. **2b-1 xong** (2026-11-08 — [.agent/business/projects-finance.md](../.agent/business/projects-finance.md)): nhiều hợp đồng / dự án (một hợp đồng chỉ một dự án), chốt phân bổ hằng tháng, chi phí nhân công từ lương, thu / chi gắn dự án, lãi / lỗ (doanh thu sau thuế, VAT là chi phí, không phân bổ chi phí chung). **2b-2 xong** (2026-11-08 — [.agent/business/projects-changes.md](../.agent/business/projects-changes.md)): yêu cầu thay đổi (CR) → khách đồng ý cộng ngân sách ngày công → phụ lục hợp đồng bán (tăng / giảm giá trị, đợt thu mới). Sau khi chủ dự án duyệt, mỗi module khi làm xong sẽ có tài liệu thật trong `.agent/business/` và dòng trong bảng định tuyến `AGENTS.md`; file này chỉ là kế hoạch.

## 0. Bối cảnh và các điều chủ dự án đã chốt (2026-11-08)

Công ty đa ngành, ~100 nhân sự:

| Mảng | Cách ra tiền |
|---|---|
| Outsource web / app | Khách trả theo mốc nghiệm thu hoặc theo tháng |
| Affiliate TikTok Shop / Shopee | Hoa hồng nền tảng trả về (**đang dự định triển khai**) |
| Xây kênh mạng xã hội thuê | Phí cố định hằng tháng |
| Đầu tư tài chính | **Chưa đưa vào hệ thống** |

Đã chốt:

1. Làm theo thứ tự: (1) khách hàng + hợp đồng bán + công nợ + thu chi → (2) dự án outsource → (3) affiliate → (4) gói kênh MXH → (5) tổng quan dòng tiền.
2. **Chỉ giám đốc và kế toán xem tiền**, cấu hình được **theo chức vụ**.
3. **Không dùng phần mềm kế toán** → module Tài chính phải có sổ thu chi đầy đủ (quỹ tiền mặt, tài khoản ngân hàng).
4. Dev outsource là nhân viên công ty → chi phí nhân công tính **theo công trên hệ thống chấm công hiện có** (không bắt ghi giờ theo việc).
5. Đầu tư: chưa làm.

Không làm (giữ ranh giới):

- **Không phát hành hoá đơn điện tử VAT** (phải qua nhà cung cấp được cấp phép) — chỉ ghi số hoá đơn, thuế suất.
- **Không thay sổ sách kế toán theo luật / báo cáo thuế.** Hệ thống là **sổ quản trị nội bộ**; xuất Excel cho kế toán dịch vụ / kế toán thuế dùng.
- Không lưu mật khẩu kênh / tài khoản của khách (cùng quy tắc module Tài sản).
- Không mở tool tiền cho AI (MCP) ở các giai đoạn đầu. ✅ Cập nhật 2026-11-13 (TEST-77): Kinh doanh mở **chỉ đọc** (khách, cơ hội, báo giá, HĐ bán, công nợ — theo quyền xem của người dùng); không tool ghi Sales. TEST-78 (2026-11-13): Tài chính mở **chỉ đọc** (tổng quan, quỹ, sổ thu chi, danh mục / mảng, khoá sổ, đề nghị chi — theo quyền chức vụ); không tool ghi Finance, không Excel / chứng từ; bút toán nháp để sau.

## 1. Quyền tài chính theo chức vụ (nền tảng, làm đầu tiên)

Chức vụ hiện là **cấp bậc** (`org.positions`, nhiều chức vụ được cùng cấp, đã có cờ `SelfPublishDocuments`). Thêm bộ quyền tài chính trên chức vụ:

| Quyền | Được làm |
|---|---|
| `finance.view` — Xem tài chính | Số dư quỹ, sổ thu chi, công nợ toàn công ty, giá trị mọi hợp đồng bán, lãi / lỗ mảng + dự án, dự báo dòng tiền |
| `finance.record` — Ghi sổ | Ghi thu / chi / chuyển quỹ, lập và ghi nhận đợt thu, chi theo đề nghị đã duyệt (kế toán) |
| `finance.approve` — Duyệt chi | Là người duyệt bước "Tài chính" của đề nghị chi, báo giá giảm sâu (giám đốc) |
| `finance.admin` — Quản trị tài chính | Bật / tắt quyền tài chính trên chức vụ, tài khoản tiền, danh mục thu chi, khoá sổ tháng |

Quyền sau bao hàm quyền xem (`record` / `approve` / `admin` ⇒ `view`).

**Lưu ý quan trọng:** quyền gắn vào **chức vụ** (cấp bậc), mà chức vụ như *Trưởng phòng* đang dùng chung cho mọi trưởng phòng. Bật quyền tiền trên chức vụ đó sẽ lộ tiền cho cả trưởng phòng Kinh doanh, Công nghệ… Vì vậy HR tạo chức vụ **riêng** cho kế toán, ví dụ *Kế toán trưởng* (cấp 3) và *Kế toán viên* (cấp 6), chuyển người kế toán sang chức vụ đó rồi mới bật quyền. Hiện Trần Ngân (Kế toán trưởng) đang ở chức vụ cấp Trưởng phòng dùng chung → cần chuyển trước khi bật. Phần mềm sẽ **cảnh báo** khi bật quyền tiền trên chức vụ đang có nhân viên ở nhiều phòng ban.

Bảo mật:

- **HR không tự cấp được quyền tiền**: chỉ `admin` hoặc người có `finance.admin` sửa các cờ này (HR vẫn sửa tên / cấp chức vụ như cũ). Mọi thay đổi `[Audited]` + báo chuông cho người có `finance.admin`.
- Khởi tạo một lần: chức vụ cấp 1 (Giám đốc) có đủ 4 quyền. Ban Giám đốc đã có Giám đốc, phòng Kế toán đã có Kế toán trưởng (chủ dự án xác nhận) → không cần tạo hồ sơ mới, chỉ cần chỉnh chức vụ như lưu ý trên.
- Người có bất kỳ quyền tài chính nào **bắt buộc bật 2FA** (dùng lại cổng 403 của admin / HR — `auth-2fa.md`).
- Kiểm tra ở back-end: `Organization.Contracts` thêm `IPositionPermissions.GetAsync(userId)` (cache ngắn theo request), endpoint filter `RequireFinance(FinancePermission.View)`. Không dựa vào vai trò (role) vì quyền nằm ở chức vụ.

Quy tắc xem số tiền với người **không** có quyền tài chính:

- Nhân viên kinh doanh thấy giá trị báo giá / hợp đồng / đợt thu **của khách mình phụ trách** (cần để làm việc); không thấy sổ quỹ, công nợ người khác, lãi lỗ.
- Quản lý dự án thấy **ngày công** đã dùng so với ngân sách ngày công; **không** thấy tiền nhân công (vì suy ra được lương).
- Lương từng người vẫn theo quy tắc cũ (HR / bảng lương). Tài chính chỉ thấy **chi phí nhân công cộng dồn theo dự án / mảng**; chi tiết theo người chỉ `finance.admin`.

## 2. Mảng kinh doanh (dùng chung)

Danh mục **Mảng** (`finance.business_lines`): Outsource, Affiliate, Kênh MXH, **Chung** (back-office: BGĐ, HR, kế toán, văn phòng). `finance.admin` thêm / sửa được (sau này thêm Đầu tư).

- Mỗi **phòng ban** gắn một mảng (mặc định Chung) → lương phòng đó tính vào chi phí mảng.
- Mỗi giao dịch thu / chi, hợp đồng bán, dự án, kênh affiliate đều gắn mảng.
- Lãi / lỗ mảng = thu của mảng − chi của mảng − nhân công của mảng; chi phí **Chung** hiện riêng, tuỳ chọn phân bổ theo tỉ lệ doanh thu (chỉ khi xem báo cáo, không ghi sổ).

## 3. Giai đoạn 1 — Tài chính lõi + Khách hàng + Hợp đồng bán + Công nợ

### 3a. Module `Finance` (schema `finance`)

| Thành phần | Nội dung |
|---|---|
| Tài khoản tiền | Quỹ tiền mặt, tài khoản ngân hàng (tên, ngân hàng, 4 số cuối), số dư đầu kỳ, đang dùng / đóng |
| Danh mục thu chi | Cây mặc định (Thu: doanh thu dịch vụ, hoa hồng affiliate, khác… · Chi: lương, BH, thuê VP, quảng cáo, phần mềm, hàng mẫu, thuê ngoài, thuế…), `finance.admin` sửa |
| Giao dịch | Thu / Chi / Chuyển quỹ: ngày, số tiền **VND (số nguyên)**, tài khoản, danh mục, mảng, đối tác, tham chiếu (hợp đồng / dự án / kênh / đề nghị chi), số hoá đơn VAT (tuỳ chọn), chứng từ đính kèm (S3 `finance/`, presigned như kho tài liệu), người ghi |
| Sửa / huỷ | `[Audited]`; **không xoá** — huỷ kèm lý do (giữ dấu vết); tháng đã **khoá sổ** thì không sửa / huỷ / ghi lùi ngày |
| Đối soát | Cuối tháng nhập số dư theo sao kê → báo chênh lệch. (Nhập sao kê CSV: giai đoạn sau) |
| Đề nghị chi | **Ai cũng gửi**: số tiền, lý do, mảng, chứng từ → luồng duyệt `[Manager, Finance]` (**mọi khoản chi đều phải duyệt**, không có ngưỡng miễn) → người `finance.record` bấm "Đã chi" (chọn tài khoản) → sinh giao dịch chi |
| Lương | Chốt kỳ lương (Payroll) → sinh **đề nghị ghi chi** tổng lương + BH phần công ty, chia theo mảng của phòng ban; kế toán xác nhận khi chuyển khoản |
| Dịch vụ phần mềm | Gia hạn ở module Tài sản → gợi ý tạo đề nghị chi (không tự ghi) |
| Excel | Sổ thu chi theo kỳ, sổ quỹ từng tài khoản, tổng hợp theo danh mục / mảng |

**Approval**: thêm `ApprovalStepKind.Finance` = bất kỳ ai có `finance.approve` (giống bước `Hr`), không tự duyệt. Loại đơn mới: `expense_request`, `quote_discount`.

**Contracts cho module khác**: `IFinanceLedger` (module khác đề nghị / ghi giao dịch có tham chiếu nguồn, idempotent theo khoá nguồn), `IReceivables` (tạo / huỷ đợt thu theo nguồn).

### 3b. Module `Sales` (schema `sales`)

| Thành phần | Nội dung |
|---|---|
| Khách hàng | Doanh nghiệp / cá nhân, MST, địa chỉ, nguồn khách, **người phụ trách**, người liên hệ (nhiều), ghi chú |
| Chăm sóc | Nhật ký gọi / gặp / email / nhắn, hẹn việc tiếp theo (nhắc chuông) |
| Cơ hội bán | Mảng (Outsource / Kênh MXH), giai đoạn kanban (Tiềm năng → Đã liên hệ → Báo giá → Đàm phán → **Thắng** / **Thua** + lý do), giá trị dự kiến, xác suất theo giai đoạn, ngày dự kiến chốt |
| Báo giá | Dòng hạng mục (số lượng × đơn giá), giảm giá, VAT, hiệu lực, phiên bản; xuất **Word / PDF theo mẫu** (dùng lại engine mẫu hợp đồng lao động); giảm vượt ngưỡng (`finance.admin` đặt, mặc định 15 %) → đơn `quote_discount` |
| Hợp đồng bán | Số HĐ, khách, mảng, giá trị trước / sau thuế, ngày ký, hiệu lực, **kiểu thu**: theo mốc / định kỳ tháng / một lần; file ký đính kèm (PDF đã ký — ký điện tử với khách bên ngoài để sau); phụ lục tăng / giảm giá trị |
| Đợt thu | Sinh từ hợp đồng (Finance sở hữu qua `IReceivables`): hạn, số tiền, trạng thái *Chưa đến hạn / Đến hạn / Quá hạn / Thu một phần / Đã thu / Huỷ*. Ghi nhận thu = giao dịch thu (một đợt có thể thu nhiều lần) |
| Nhắc | Đợt thu trước hạn 7 ngày, đúng hạn, quá hạn mỗi thứ Hai → người phụ trách khách + `finance.record` |
| Màn hình | `/sales`: Khách hàng · Cơ hội (kanban) · Báo giá · Hợp đồng. `/finance`: Tổng quan · Thu chi · Công nợ (theo tuổi nợ 0–30 / 31–60 / > 60 ngày) · Đề nghị chi · Tài khoản · Cấu hình |

Quyền ở Sales: ai thuộc phòng gắn mảng Outsource / Kênh MXH (hoặc vai trò manager trở lên) tạo khách và cơ hội; nhân viên thấy khách mình phụ trách, quản lý thấy của cấp dưới, `finance.view` thấy tất cả. Khách hàng không xoá — chỉ ngừng.

## 4. Giai đoạn 2 — Dự án outsource (module `Projects`)

- **Chuyển quyền sở hữu dự án** từ module Documents sang `Projects` (giữ nguyên Id). Documents đọc dự án qua `Projects.Contracts` (`IProjectDirectory`), kho tài liệu dự án giữ như cũ. Migration chép dữ liệu một lần + kiểm tra ranh giới module.
- Dự án gắn **hợp đồng bán** (chủ dự án chốt 2026-11-08: **1 dự án → nhiều hợp đồng, 1 hợp đồng → 1 dự án**), mảng, quản lý dự án, ngày bắt đầu / kết thúc dự kiến, **ngân sách ngày công**.
- **Mốc nghiệm thu** gắn đợt thu: quản lý dự án bấm "Đã nghiệm thu" (kèm biên bản) → đợt thu tương ứng chuyển **Đến hạn** + báo kế toán.
- **Công việc**: kanban (Cần làm / Đang làm / Chờ review / Xong), người làm, hạn, ước lượng ngày, bình luận, đính kèm, nhắc quá hạn.
- **Yêu cầu thay đổi (CR)**: ghi phát sinh → nếu tính tiền thì tạo phụ lục hợp đồng + đợt thu mới.
- **Bảo trì sau bàn giao**: hợp đồng định kỳ tháng (cùng cơ chế với gói kênh MXH).

**Chi phí nhân công (theo công hệ thống):**

```
chi phí người A cho dự án P trong tháng M
  = chi phí công ty cho A trong tháng M   (lương gross + BH phần công ty, từ kỳ lương đã chốt; chưa chốt → ước từ lương hợp đồng)
  × (công thực tế của A ở dự án P)
  / (công thực tế của A trong tháng M)
công của A ở P = công thực tế tháng (bảng công từ attendance.events) × % phân bổ A vào P tháng M
```

- **% phân bổ**: quản lý dự án đặt cho từng thành viên theo tháng. Mặc định: chỉ ở 1 dự án đang chạy → 100 %; nhiều dự án chưa đặt → chia đều. Tổng < 100 % thì phần còn lại vào chi phí chung của mảng; > 100 % → chặn.
- Tính khi đọc (giống bảng công), không lưu số tiền theo người; chốt kỳ lương thì số liệu tháng đó cố định.
- **Lãi / lỗ dự án** (chỉ `finance.view`): giá trị hợp đồng (+ phụ lục) · đã thu · nhân công · chi phí gắn dự án (thuê ngoài, server, phần mềm) · biên lợi nhuận. Quản lý dự án chỉ thấy ngày công đã dùng / ngân sách.

## 5. Giai đoạn 3 — Affiliate TikTok Shop / Shopee (module `Affiliate`)

> **Trạng thái 2026-11-12: Lưu trữ** (tạm dừng từ 2026-11-08, chờ chủ dự án yêu cầu) — bảng dự án `TEST`, việc TEST-51.

Mảng đang dự định triển khai → làm **bản tối thiểu**, mở rộng khi chạy thật.

- **Kênh**: nền tảng (TikTok Shop / Shopee), tên kênh, người phụ trách, nhân sự tham gia, trạng thái.
- **Nhập đơn từ file** Excel / CSV xuất ở trang affiliate của nền tảng (cột ánh xạ cấu hình được vì định dạng hay đổi): mã đơn, sản phẩm, giá trị đơn (GMV), hoa hồng dự kiến, trạng thái (chờ / đã xác nhận / huỷ, hoàn), ngày. Chống trùng theo (nền tảng, mã đơn); nhập lại thì cập nhật trạng thái. API nền tảng: để sau (cần đăng ký đối tác).
- **Đối soát**: hoa hồng đã xác nhận theo kỳ so với **tiền nền tảng chuyển về** (giao dịch thu gắn kênh) → chênh lệch.
- **Chi phí**: quảng cáo, hàng mẫu, thuê ngoài → giao dịch chi gắn kênh; lãi / lỗ từng kênh (chỉ `finance.view`); nhân công theo phòng / % phân bổ như dự án.
- **Lịch quay / livestream**: đặt lịch Phòng quay, Livestream 1 / 2, Phòng thu âm (đã có trong văn phòng 3D, hiện **chưa** đặt lịch được) — mở rộng module Meetings cho phòng `kind: "studio"`.
- **KPI người làm**: số video, giờ live, GMV, hoa hồng theo tháng. Thưởng theo KPI → khoản cộng vào bảng lương (giai đoạn sau, cần chủ dự án chốt công thức).

## 6. Giai đoạn 4 — Gói xây kênh MXH thuê (trong `Projects`, loại "Gói dịch vụ")

> **Trạng thái 2026-11-12: KHÔNG LÀM** (chủ dự án chuyển sang cột "Không làm") — bảng dự án `TEST`, việc TEST-49. Nội dung dưới giữ để tham khảo, không triển khai.

- Hợp đồng định kỳ tháng (từ Sales) → **gói**: kênh của khách (nền tảng, link), cam kết mỗi tháng (số bài, video, live).
- **Lịch nội dung**: mục nội dung *Ý tưởng → Sản xuất → Chờ khách duyệt → Đã đăng* (+ link bài), người làm, hạn; đếm so với cam kết.
- Khách duyệt: giai đoạn này **ghi nhận nội bộ** (nhân viên đánh dấu khách đã duyệt). Cổng cho khách bên ngoài để sau (cần thiết kế bảo mật riêng).
- **Báo cáo tháng** cho khách: chỉ số kênh nhập tay (theo dõi, lượt xem, tương tác), xuất Excel / PDF.
- **Đợt thu tự sinh hằng tháng** theo hợp đồng; nghiệm thu tháng → đến hạn.
- Nhân công: % phân bổ nhân viên vào gói như dự án.

## 7. Giai đoạn 5 — Tổng quan cho giám đốc

> **Trạng thái 2026-11-12: Lưu trữ** (để sau, chưa làm) — bảng dự án `TEST`, việc TEST-50.

- Màn hình `/finance` → Tổng quan: số dư các quỹ, thu / chi / lãi theo tháng và theo mảng, công nợ quá hạn, pipeline có trọng số, dự án lỗ / sắp vượt ngân sách ngày công.
- **Dự báo dòng tiền 13 tuần**: số dư hiện tại + đợt thu sắp đến hạn + cơ hội × xác suất − lương dự kiến − gia hạn dịch vụ − đề nghị chi đã duyệt chưa chi.
- (Tuỳ chọn) bảng số trong văn phòng 3D chỉ hiện cho người có `finance.view`.

## 8. Kỹ thuật chung

- 4 module mới, mỗi module một schema, chỉ gọi nhau qua `*.Contracts` (luật ranh giới module). Tiền là `long` VND; logic tính (đợt thu, tuổi nợ, phân bổ nhân công, lãi lỗ) đặt trong `Domain` có unit test.
- FE: feature `sales`, `finance`, `projects`, `affiliate`; route + `PAGE_ROLES`; menu Tài chính chỉ hiện với người có quyền (back-end vẫn chặn).
- Thông báo: dùng `INotifier` (chuông + email + push FCM sẵn có).
- Test: unit test domain + e2e trên DB tạm (dev DB = production).
- MCP: chưa mở. Nếu mở sau → chỉ đọc việc / dự án của mình, không tool tiền; cập nhật `catalog.ts` + `mcp.md` (luật #9).

## 9. Ước lượng

> Giai đoạn 1 + 2 đã xong. Giai đoạn 3 và 5: Lưu trữ (TEST-51, TEST-50). Giai đoạn 4: Không làm (TEST-49). Phần lẻ của giai đoạn 1 (PDF báo giá, ký hợp đồng bán điện tử, đối soát sao kê, đề nghị chi từ lương, 2FA + thông báo đổi quyền tài chính): Lưu trữ (TEST-52).

| Giai đoạn | Khối lượng |
|---|---|
| 1. Quyền tài chính + Finance lõi + Sales + công nợ | ~3 tuần |
| 2. Projects (chuyển dự án, mốc, việc, phân bổ nhân công, lãi lỗ) | ~2–3 tuần |
| 3. Affiliate tối thiểu + đặt lịch studio | ~2 tuần |
| 4. Gói kênh MXH | ~1–2 tuần |
| 5. Tổng quan + dự báo dòng tiền | ~1 tuần |

## 10. Quyết định của chủ dự án (2026-11-08)

1. Chỉ admin + người có "Quản trị tài chính" bật được quyền tiền; HR **không** — đồng ý.
2. Nhân viên kinh doanh thấy số tiền báo giá / hợp đồng của khách mình phụ trách — đồng ý.
3. Quản lý dự án chỉ thấy ngày công, không thấy tiền nhân công — đồng ý.
4. **Mọi khoản chi đều cần duyệt** (không có ngưỡng nhỏ miễn duyệt).
5. **Chỉ VND**; nếu có USD thì chủ dự án tự quy đổi trước khi nhập.
6. Đã có Giám đốc và Kế toán trưởng; cần chuyển Kế toán trưởng sang chức vụ riêng (xem mục 1).
7. **"Dự án" là module riêng** (`Projects`); Documents đọc qua `Projects.Contracts`, giữ nguyên dữ liệu.
