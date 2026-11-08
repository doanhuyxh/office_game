# Tiến độ & bàn giao phiên

> Cập nhật **2026-11-08**: thêm **push FCM** cho Thông báo + Chat (Direct/Room) + Bảng tin (xem bảng dưới) — **chưa commit**. Kiểm tra production bằng `prod-smoke.ts` + gọi trực tiếp API mới (chat/news/assets/avatar đều trả 401 chứ không phải 404): production **đã** có các module Chat/News/Assets/Documents/Avatar dù doc trước đó ghi vẫn ở `ab8fac0` — có vẻ đã deploy mà chưa cập nhật tài liệu, không khẳng định chắc commit chính xác (không có SSH vào VPS). Trước đó: thêm **module Chat** + âm báo thông báo + màn hình quản trị "Công cụ AI (MCP)". **CORS bucket S3 đã bật** (chủ dự án xác nhận) — trình duyệt PUT tài liệu lên kho được. Đầu phiên khởi động lại theo [commands.md](commands.md). Chi tiết: bảng định tuyến [AGENTS.md](../AGENTS.md); kế hoạch tổng `docs/ARCHITECTURE_V2.md`.

## Đã xong

| Hạng mục | Tài liệu (`business/`) |
|---|---|
| Identity, Organization, chấm công + giải trình + tăng ca, phê duyệt, nghỉ phép, thông báo, hợp đồng (+ mẫu Word) | `auth`, `organization`, `attendance*`, `approval`, `leave`, `notifications`, `contracts` |
| Báo cáo + Excel, quy ra tiền tăng ca / phép (khi nghỉ việc) · đặt phòng họp (+ "Đang họp" trong 3D) | `reports`, `meetings` |
| Nhắc quên chấm ra (chuông) · nhập nhân viên từ Excel · lịch sử sửa dữ liệu nhân sự (`[Audited]`, che lương) | `attendance-corrections`, `employee-import`, `audit` |
| Văn phòng 3D giai đoạn 1 (bản đồ v2, engine low-poly, A*, ngồi, minimap) + voice LiveKit (khoảng cách, phòng riêng, chia sẻ màn hình) | `office`, `office-engine`, `design/` |
| **Nhân vật 3D tuỳ chỉnh** (2026-11-06, chưa deploy; migration `UserAvatars`): model Quaternius CC0, editor ở HUD + `/profile`, đồng bộ `LookChanged`; sửa lỗi cookie jar của Realtime (kiểm tra phiên nhầm người) | `office-avatar` |
| **Tin nhắn (module Chat)** (2026-11-07, migration `InitialChat`, biến mới `Chat__InternalKey` — **phải đặt trước khi deploy**): kênh Office / kênh nhóm theo phòng có tường / chat 1-1, ảnh + tệp (S3 `chat/`), thu hồi = xoá mềm, lưu vĩnh viễn, chưa đọc + badge + âm báo; `/chat` + nút ở header; **đồng bộ với chat HUD 3D** (3D giờ lưu qua Api, giao diện 3D không đổi); admin / HR không đọc tin 1-1; không mở cho AI. E2E: REST 60/60, trình duyệt 32/32 (DB tạm). `office-chat-e2e.ts` (chat 3D theo phòng) chạy lại 16/16 | `chat` |
| **Bảng tin (module News)** (2026-11-08, migration `InitialNews`, không cần biến `.env` mới; gói mới: NuGet `HtmlSanitizer`, FE `@tiptap/*`): bài viết kiểu Facebook — **ai cũng đăng**, chọn phạm vi người xem (toàn công ty / phòng ban + phòng con / danh sách riêng / chỉ mình), trình soạn thảo rich-text (lazy load), ảnh + **video** + tệp (S3 `feed/`), bình luận (trả lời một cấp, ảnh), 6 cảm xúc, **@nhắc tên**, email **tuỳ chọn khi đăng** (hạn 3 bài/ngày, HR không giới hạn), kiểm duyệt HR (ẩn kèm lý do / ghim), badge bài mới; `/news` + `/news/{id}`, thẻ ở Tổng quan, tab Tin tức ở 📌 Bảng tin trong 3D; MCP **chỉ đọc** (`list_news_feed`, `get_news_post` — chữ thuần, không link tệp). E2E 112/112 trên DB tạm | `news` |
| Âm báo thông báo (chuông): `public/sounds/notification.mp3`, bật / tắt ở dropdown chuông + `/profile`, mặc định bật, lưu localStorage | `notifications` |
| **Push FCM** (2026-11-08, migration `AddPushTokens`, biến mới `Firebase__CredentialsPath` — tuỳ chọn, trống = tắt push; **chưa commit**): đẩy qua `IPushSender` cho mọi category `INotifier` hiện có (Thông báo + Bảng tin tự động có, không cần sửa module gọi) + Chat Direct/Room (không Office — quá ồn); công tắc "Bật thông báo đẩy" ở dropdown chuông + `/profile`; có push → giảm poll chuông 30s → 2 phút. **Thiếu VAPID key** (Firebase Console → Cloud Messaging → Web configuration) nên FE tự ẩn công tắc tới khi điền `VITE_FIREBASE_VAPID_KEY`; backend `dotnet build -warnaserror` + `dotnet test` ✔, FE `bun run build` ✔ — **chưa chạy e2e / thử tay** (cần VAPID key + trình duyệt thật) | `notifications`, `chat` |
| Kết nối AI: MCP 40 tool (không hợp đồng / lương, chấm công AI = Remote), token cá nhân + OAuth 2.1, nhật ký AI, HR thu hồi · màn hình quản trị "Công cụ AI (MCP)" `/mcp-tools` (chỉ admin, catalog bảo trì thủ công — luật #9) | `mcp`, `mcp-oauth` |
| Giao diện shadcn-admin (sidebar, ⌘K, sáng / tối) · PWA cài được + giao diện mobile · push FCM qua `public/sw.js` (xem dòng Push FCM ở trên) | `../frontend.md` |
| Chat theo phòng, model GLB (chờ bộ Kenney), joystick + zoom cảm ứng | `office`, `office-engine` |
| **Tài sản công ty** (2026-11-08, chưa commit; migration `InitialAssets`): thiết bị (mã `TB-…`, cấp / thu hồi, bảo trì / thanh lý / mất, lịch sử), dịch vụ + ghế (Figma…, không lưu mật khẩu), nhắc bảo hành / gia hạn 30 / 7 ngày, báo HR khi nhân viên nghỉ còn giữ tài sản, rà soát quyền định kỳ (quản lý chọn giữ / thu hồi, HR đóng đợt), kiểm kê, Excel, tool MCP `get_my_assets` / `get_employee_assets` (42 tool). `AssetRules` 35 test, E2E 97 + 2 (pha b) trên DB tạm. Còn: khấu hao (chủ dự án: chỉ ghi giá mua), biên bản ký (chỉ thông báo), tải lên ảnh / hoá đơn thiết bị | `assets`, `assets-review` |
| **Mặt bằng 3D 50 × 30 m (1 500 m²)** duyệt + áp dụng 2026-11-06: 14 phòng (hội trường 20, họp lớn 10, họp nhỏ 6, 4 phòng gọi, phòng yên tĩnh), 100 chỗ, dải tiện ích (cà phê phụ, bàn trao đổi nhanh, thư viện mini…); JSON sinh từ `design/tools/gen-map-1500.ts`; nắng đi theo người chơi, zoom tới 40 | `office`, `../../design/README.md` |
| Bảng lương theo luật VN (thông số HR sửa được; tháng nghỉ không lương ≥ 14 ngày không đóng BH) · ký hợp đồng nội bộ + OTP email | `payroll`, `contracts-esign` |
| Chức vụ = cấp bậc (`Level`, thang 8 bậc, HR quản lý) + chức danh tự do · phòng ban dạng cây, gợi ý quản lý = trưởng phòng · sơ đồ tổ chức (HR) | `organization` |
| Mô tả + hướng dẫn phòng ban / chức vụ (trưởng phòng sửa phòng mình) → MCP `get_my_role`, `list_positions`, `get_department`, `get_position`; thẻ "Vai trò của tôi" | `org-guides`, `mcp` |
| Phân quyền UI: `PAGE_ROLES` (menu + chặn route → "Không có quyền"), 403 → toast · danh bạ theo vai trò (trạng thái / ngày vào làm chỉ HR, chính chủ, quản lý; người đã nghỉ chỉ HR) | `../routes.md`, `organization` |
| Hồ sơ cá nhân `/profile`: liên hệ + ảnh tự sửa; ngày sinh / CCCD / ngân hàng qua HR duyệt (mã hoá, không ra MCP); sheet "Chuyển khoản" trong Excel lương; trường CCCD cho mẫu hợp đồng | `profile` |
| UI: bỏ tiêu đề / mô tả trang (nút hành động ngang hàng tab — `PageToolbar`) · nút "Cột" cho bảng nhiều cột · trang 404 tiếng Việt | `../frontend.md` |
| **Kho tài liệu / tài sản số** (2026-11-07, đã commit `66a7fa4` + `f8a0377`; migration `InitialDocuments`; CORS bucket đã bật): kho công ty / phòng ban / dự án, tải thẳng S3, phiên bản, nhật ký xem / tải, ban hành qua duyệt + số hiệu, tự ban hành (chức danh chuyên viên, `b5a522e`), hạn lưu trữ + huỷ, thùng rác, bàn giao, báo cáo dung lượng S3. E2E 65/65 trên DB tạm. Văn phòng 3D: nút HUD, tủ hồ sơ / thư viện / bảng tin (E), kéo thả tải lên, chiếu lên màn hình phòng (`PinScreen`) — E2E 25/25. Còn: OCR / tìm toàn văn, MCP, mức Mật | `documents`, `office-documents` |
| **7/11, đã commit**: 2FA TOTP bắt buộc admin / HR · uỷ quyền duyệt · nhắc hết thử việc · chặn CSRF / chiếm WebSocket · model Kenney Furniture Kit · sửa thẻ phép "−0" · phân trang (nhân viên, phép, lương, báo cáo, lịch sử sửa, thông báo) · sơ đồ tổ chức toàn màn hình · bộ chọn ngày tiếng Việt · bố cục màn hình lớn · Seq · nhúng iframe trang Hệ thống · đổi mật khẩu thiếu trường trả 400 · phòng "Kỹ thuật" đổi tên "Công nghệ" | `auth-2fa`, `approval-delegation`, `contracts-reminders`, `../architecture.md` |

Kiểm tra ghi lần trước (trước 34 commit sau `6cea7c6`): `dotnet build -warnaserror` ✔, `dotnet test` ✔ (12 project; Organization 36, Mcp 58, Payroll 15), `bun run build` ✔. E2E trên DB tạm: lương + ký 48/48, quyền tổ chức + hướng dẫn + danh bạ 37/37, hồ sơ cá nhân 34/34; trên bản dev: phân quyền trang 8/8, nút cột 13/13; quét responsive 12 trang × 4 độ rộng sạch. Phiên 7/11 tối **không chạy lại** build / test. **Phiên 8/11 (module News)**: `dotnet build -warnaserror` ✔ 0 cảnh báo, `dotnet test` ✔ (17 project, News 39 test), `bun run build` ✔; `news-e2e.ts` 112/112 trên DB tạm.

## Quyết định đã chốt gần đây (đừng hỏi / đề xuất lại)

- Nhân vật 3D: chưa chọn = **một mẫu chung**; model miễn phí (Quaternius CC0); HR **không** khoá trang phục.
- Văn phòng 3D: mặt bằng **50 × 30 m** đã duyệt 2026-11-06 (Giám đốc 2 bàn, Kỹ thuật 1 cụm 6 xoay dọc cạnh Kinh doanh sát tường tây, phòng gọi 2 ghế đối diện, dải tiện ích z 20–22); giả định cũ vẫn giữ (camera chéo low-poly, laptop trước, voice ở giai đoạn 3). **Giai đoạn 2 bị bỏ**: không làm gán chỗ ngồi, trạng thái (chấm công / nghỉ phép / vắng) trên avatar, "tìm đồng nghiệp", người offline hiện mờ.
- Hợp đồng: HR quản lý tất cả, nhân viên xem của mình, quản lý **không** xem của cấp dưới; lương mã hoá; nhắc HR + quản lý trực tiếp.
- Thông báo: email + chuông. Tăng ca / nghỉ phép: xem §11 `ARCHITECTURE_V2.md`.
- Lương: đầy đủ luật VN, HR sửa thông số; ký điện tử = nội bộ + OTP email (không CA); **chưa làm** máy chấm công; PWA **không** push.
- Tổ chức: phòng ban mở rộng tự do, chức vụ = cấp bậc bắt buộc có cấp (HR thêm / sửa / xoá); "Lễ tân" là chức danh. Danh bạ: nhân viên thấy liên lạc, không thấy trạng thái / ngày vào làm / người đã nghỉ.
- Hồ sơ cá nhân: liên hệ + ảnh hiệu lực ngay; ngày sinh / CCCD / ngân hàng cần HR duyệt; **email chỉ HR đổi**.
- Giao diện: **không** hiện tiêu đề / mô tả đầu trang; nút hành động ngang hàng thanh tab.
- Thông báo realtime: dùng **FCM** thay thế (chủ dự án chốt 2026-11-08); xem mục "Việc tiếp theo".

## Việc tiếp theo

1. **Deploy** `3f1b310` (migration tự chạy khi Api khởi động, gồm các migration đã có từ `6cea7c6` và migration mới của kho tài liệu, 2FA, uỷ quyền duyệt, nhắc thử việc; image Realtime copy `shared/` nên bản đồ + model mới tự theo) rồi chạy `prod-smoke.ts`. Thêm `api-dev.log` vào `.gitignore` nếu chưa.
2. **Kế toán đối chiếu thông số lương** tại `/payroll` → Thông số trước khi chốt kỳ thật. **HR / trưởng phòng soạn mô tả + hướng dẫn** phòng ban / chức vụ (AI mới có nội dung). Kiểm tra lại cấp của từng chức vụ ở tab Chức vụ.
3. Kho tài liệu giai đoạn sau (hỏi trước): OCR / tìm toàn văn, tool MCP, mở mức Mật.
4. **Giai đoạn sau — tính năng mới (chưa bắt đầu, hỏi trước)**:
   - Chat: sửa tin, tìm trong tin nhắn, dọn tệp S3 mồ côi (xem "Chưa làm" ở [chat.md](business/chat.md))
   - Bảng tin: tìm toàn văn, thống kê đã đọc, bài hẹn giờ, realtime (xem "Chưa làm" ở [news.md](business/news.md))
5. **Push FCM đã code xong** (xem dòng "Push FCM" ở bảng trên) nhưng **chưa dùng được**: cần chủ dự án tạo VAPID key (Firebase Console → Project settings → Cloud Messaging → Web configuration → Web Push certificates → Generate key pair) rồi điền `VITE_FIREBASE_VAPID_KEY` vào `frontend/.env`. Sau đó thử tay (bật công tắc ở `/profile`, gửi đơn / tin nhắn 1-1 từ tài khoản khác, đóng tab xem có báo không) rồi mới commit + deploy (nhớ chép `sdks/*.json` lên VPS + set `Firebase__CredentialsPath` trong `.env.pro` — xem [env.md](env.md)).
6. Đề xuất chưa làm (hỏi trước): chốt công tháng, ca qua đêm, API loại phép, tắt email theo người, xuất sơ đồ tổ chức ra ảnh / PDF.
7. Đã hoãn: vận hành (giám sát, diễn tập khôi phục backup), webhook máy chấm công, HR bật / tắt AI theo người.

## Chạy & dữ liệu dev

- Lệnh: [commands.md](commands.md). Dev chạy 3 tiến trình: Api :5080, Realtime :5090, FE :5173 (Vite proxy). Postgres / S3 / SMTP trong `.env` là **dịch vụ thật** (DB công ty ở xa → mỗi API ~1 s).
- **`Encryption__Key`** đã được tạo trong `.env` (lương hợp đồng mã hoá bằng khoá này) — mất khoá = mất lương đã lưu; nhắc chủ dự án sao lưu.
- **Dữ liệu thật / thử (2026-11-06)**: DB `office` (`100.103.27.5`) **dùng chung cho dev và production** — ghi từ máy dev là ghi vào production. Chủ dự án yêu cầu xoá hẳn mọi nhân sự trừ NV009 (doanhuyxh@gmail.com): đã xoá NV001 + 12 tài khoản thử NV010–NV021 cùng tài khoản đăng nhập và mọi dữ liệu liên quan (giữ phòng ban, chức vụ, ca, mẫu hợp đồng, loại phép, admin seed `Seed__*`). Bản sao lưu trước khi xoá: `../office_game_backups/office-20261106-220422-truoc-xoa-nhan-su.dump` (ngoài repo). **2026-11-06 tối: nhập 93 hồ sơ NV010–NV102** từ danh sách Google của chủ dự án (file `nhap-nhan-su-20261106.xlsx` ở gốc repo, không commit): 5 phòng BGD-trừ, trưởng phòng đã gán, mọi người đã có tài khoản + lời mời qua email (TP / PP / trưởng nhóm có vai trò `manager`; ~40 tên tạm đặt theo email, ghi chú trên hồ sơ; 40 tài khoản alias của chủ dự án). Không ai ở Ban Giám đốc. `account.txt` (gitignore) liệt kê 93 tài khoản này, mật khẩu chung đã đặt 2026-11-07 (xem file), lời mời đã nhận; không chạy `seed-org.ts` / `seed-contracts.ts` vào DB này nếu chủ dự án không yêu cầu — test luồng bằng script e2e trên DB tạm ([e2e.md](e2e.md)). **NV009 là dữ liệu thật — không sửa.**
- Dọn dữ liệu do test tạo (đơn, thông báo…): không có `psql` cục bộ → `docker run --rm --env-file <pg.env> postgres:18-alpine psql …` với thông tin từ `ConnectionStrings__Default`.

Script e2e + cách test trên DB tạm: [e2e.md](e2e.md).

## Bẫy đã gặp

Xem [pitfalls.md](pitfalls.md) — đọc trước khi debug lỗi lạ (Api cũ chưa khởi động lại, route lazy, SMTP / S3 thật, migration…).
