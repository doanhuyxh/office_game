# Giám sát trợ lý AI / bot: nội dung lệnh ghi + cảnh báo bất thường

> Phần tiếp của [mcp-oauth.md](mcp-oauth.md#nhật-ký-ai-module-audit-schema-audit). Code: `Modules/Audit/…/Domain/AiRequestSummary.cs`, `Domain/AiAlert.cs`, `Infrastructure/AiAuditPipeline.cs`, `Infrastructure/AiAlertMonitor.cs`, `Features/AiAlertEndpoints.cs`, `Features/AiAlertSettingsEndpoints.cs`; FE `features/ai-access/components/request-summary/`, `features/reports/components/ai-alerts-panel/`. Về [README.md](README.md).

## Quyết định đã chốt (2026-11-11, đừng đề xuất lại)

- Nội dung lệnh ghi lưu **7 ngày** (dòng nhật ký vẫn 180 ngày).
- **Không** có luật "IP mới".
- Người nhận cảnh báo = **mọi tài khoản vai trò `admin`** đang hoạt động (không gửi quản lý / HR / chủ tài khoản).
- Chỉ báo, **không tự thu hồi** token.

## A. Nội dung lệnh ghi (`ai_requests.RequestSummary`, jsonb)

- Lấy ở **Api** (`AiAuditStartupFilter`), không ở Mcp → bắt cả agent gọi REST thẳng bằng token, và không tin header client.
- Chỉ đệm body khi: method ghi (khác GET / HEAD / OPTIONS) + `Authorization: Bearer ohk_…` + content-type JSON + `Content-Length` ≤ 8 KB (`EnableBuffering`, đọc lại sau khi endpoint chạy xong). Request cookie không tốn gì thêm.
- Lưu khi `AuditRules.KeepsSummary`: lệnh ghi và status **khác 403 / 429** (route bị chặn không lưu dữ liệu gửi vào — vd hợp đồng). Lỗi 400 / 404 vẫn lưu (biết agent định làm gì).
- `AiRequestSummary.FromJson`: chuỗi ≤ 500 ký tự (không tách emoji), mảng ≤ 20 phần tử (`"… +N"`), sâu ≤ 5, tổng ≤ 4 KB (vượt → thu chuỗi còn 100, vẫn vượt → `{"_type":"truncated","bytes":N}`). Khoá chứa `password`, `token`, `secret`, `otp`, `salary`, `bank`, `idNumber`, `nationalId`, `cccd`, `apiKey`, `code_verifier` (bỏ qua `_` / `-`, hoa thường) → `"•••"`.
- Không phải JSON: `{"_type":"form|binary|too_large|invalid_json","bytes":N}`. Không có body → null. Không bao giờ ném lỗi (lỗi → null).
- Hạn 7 ngày: `AiAuditWriter` mỗi giờ đặt `RequestSummary = null` cho dòng > 7 ngày; `GET /api/audit/ai-requests` cũng lọc theo mốc này (job trễ vẫn không lộ). Trả trong `AiRequestDto.requestSummary`, cùng phạm vi xem với nhật ký.
- FE `/ai-access` (Của tôi + Toàn công ty): dòng lệnh ghi có nút ▸ mở nội dung (key → value, nhãn tiếng Việt cho trường hay gặp); path `/api/projects/{id}/…` → link "Mở dự án".

## B. Cảnh báo bất thường (`audit.ai_alerts`)

Job `AiAlertMonitor` (Api, `JobMonitor` key `audit.ai-alerts`): chạy 50 s sau khi khởi động rồi **5 phút / lần** (cố định), GROUP BY theo người trên cửa sổ gần nhất (mặc định 15 phút) (`WindowStats`, `COUNT … FILTER`). Ngưỡng / cửa sổ / chống lặp: mặc định trong bảng dưới, **admin chỉnh trên web** (mục B1, TEST-232).

| Luật (`AiAlertRules`) | Điều kiện trong cửa sổ (giá trị mặc định) | Email |
|---|---|---|
| `blocked` | ≥ 10 lệnh 403 / 429 | không |
| `errors` | ≥ 20 lệnh lỗi (≥ 400, trừ 403 / 429) **và** > 50 % tổng | không |
| `burst_writes` | ≥ 60 lệnh ghi | không |
| `bot_approval` | tài khoản **bot** (`IsBot`) POST `/api/approval/{id}/approve|reject` (kể cả thất bại) | **có** |
| `chat_spam` | ≥ 20 tin chat (POST `/api/chat/conversations/{id}/messages`) — thêm 2026-11-11 cùng [chat của bot](office-bots.md#tin-nhắn-của-bot) | không |

- Chống lặp: cùng (người, luật) tối đa 1 cảnh báo / **1 giờ** (mặc định, đọc `ai_alerts`). Lưu cảnh báo **trước** khi gửi → gửi lỗi cũng không báo lặp.
- Gửi `INotifier` category `ai_alert` (chuông + push; email chỉ `bot_approval`) cho mọi admin `IsActive`; không có admin → chỉ log. Link `/reports?tab=ai`.
- Bảng `ai_alerts`: `CreatedAt`, `UserId`, `Rule`, `WindowStart/End`, `Count`, `Total`; xoá > 180 ngày (mỗi lần job chạy). Tiêu đề / nội dung tiếng Việt sinh lúc đọc (`AiAlertRules.Title/Body`; độ dài cửa sổ trong nội dung lấy từ `WindowEnd − WindowStart` của chính cảnh báo).
- `GET /api/audit/ai-alerts?page=&pageSize=&userId=` (policy Manager, phạm vi `AiUsageScope`: HR / admin mọi người, quản lý bản thân + cấp dưới, `userId` ngoài phạm vi → 403; token AI → 403).
- FE: Báo cáo → tab "Trợ lý AI" → khung **Cảnh báo** (trên cùng, tự hỏi lại 60 s): nhãn luật, người (+ BOT), nội dung, "Chi tiết" (sheet hoạt động của người đó), HR / admin có "Thu hồi kết nối" → `/ai-access?tab=company`.

## B1. Ngưỡng cảnh báo chỉnh trên web (`audit.ai_alert_settings`, TEST-232)

- Bảng một dòng `Id = 1` (`AiAlertSettings`, `[Audited]` → lịch sử sửa): `BlockedThreshold`, `ErrorsThreshold`, `ErrorsPercent` (lỗi phải **hơn** % này; 0 = chỉ xét số lệnh), `BurstWritesThreshold`, `ChatSpamThreshold`, `WindowMinutes`, `CooldownMinutes`, `UpdatedAt`, `UpdatedByName`. Chưa có dòng → `AiAlertThresholds.Default` (10 / 20 / 50 % / 60 / 20 / 15 phút / 60 phút = giá trị gốc).
- Khoảng cho phép (kiểm ở back-end, lỗi 400 ghi số): bị chặn 1–1000, lỗi 1–1000, tỉ lệ 0–99 %, ghi 1–10000, chat 1–1000, cửa sổ 5–1440 phút (≥ chu kỳ job để không sót lệnh), chống lặp 5–10080 phút.
- `GET / PUT / DELETE /api/audit/ai-alert-settings` — `AuthPolicies.Admin`, **token AI 403** (ngoài allowlist `AccessTokenAuth` + endpoint tự chặn): bot không tự nới ngưỡng. `DELETE` = khôi phục mặc định (xoá dòng). DTO kèm `defaults`, `ranges`, `intervalMinutes`.
- `AiAlertMonitor.RunOnceAsync` đọc dòng này **mỗi lần chạy** (không cache) → đổi xong áp dụng ở lần quét kế tiếp. `bot_approval` luôn bật, không có ngưỡng.
- **Chỉ cảnh báo**, không tự chặn bot; hạn mức cứng ở "Giới hạn trợ lý AI" (`projects.agent_settings`) và 60 tin chat / giờ giữ nguyên.
- FE: thẻ "Ngưỡng cảnh báo trợ lý AI" ở `/system?tab=config` (dưới thẻ giới hạn bot), `features/reports/components/ai-alert-settings-card/`: 7 ô số (min / max / gợi ý mặc định từ DTO), Lưu (`loading`), "Khôi phục mặc định" (hộp xác nhận `onConfirm`).

## C. Mức dùng AI theo phiên agent (chi phí / token)

Tách sang [ai-usage.md](ai-usage.md) (ghi từ runner, API đọc, giao diện tab "Mức dùng AI" + thẻ Hồ sơ).

## Kiểm tra

Unit: `tests/OfficeHub.Modules.Audit.Tests` (`AiRequestSummaryTests`, `AiAuditPipelineTests` — middleware thật, endpoint đọc hết body trước; `AiAlertRulesTests` gồm SQL + ngưỡng tuỳ chỉnh / kiểm tra khoảng; `AiSessionLedgerTests` — mục C). E2E: `scripts/dev/ai-monitor-e2e.ts` (DB tạm, ~12 phút vì chờ job); `scripts/dev/ai-alert-settings-e2e.ts` (B1: quyền, 400, job dùng ngưỡng mới, khôi phục — DB tạm); mục C xem [ai-usage.md](ai-usage.md#kiểm-tra).
