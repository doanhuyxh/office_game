# Mức dùng AI theo phiên agent (chi phí / token)

> Tách từ [ai-monitoring.md](ai-monitoring.md) (mục C). Code BE: `BuildingBlocks/Ai/AiUsage.cs`, `Modules/Audit/…/Domain/AiSessionLedger.cs`, `Features/AiSessionUsageEndpoints.cs`, `Features/AiSessionUsageExport.cs`; FE `features/ai-access/components/ai-usage-*`, `ai-month-card`. Về [README.md](README.md).

## Ghi + API (TEST-134)


Mcp / Api không biết số token → bên chạy agent (agent-runner, việc riêng) gửi sau mỗi phiên. Chủ dự án chốt 2026-11-17: mỗi người xem phần của mình, admin / HR xem tất cả; chi phí / token **được phép trống** (nhà cung cấp khác Claude); **không** nối Anthropic Admin API. Giao diện: TEST-136 (mục "Giao diện" bên dưới).

```
runner ─POST /mcp/usage (token AI của bot)─▶ Mcp (chỉ bot, gắn userId của token) ─POST /api/audit/internal/ai-usage (X-Internal-Key)─▶ Api → audit.ai_usage_sessions / ai_usage_models
```

- Hợp đồng chung `BuildingBlocks/Ai/AiUsage.cs` (`AiUsageRoute`, `AiUsageUpload`, `AiUsageSession`, `AiUsageModel`, `AiUsageBatch`, `AiUsageAccepted`).
- **`POST /mcp/usage`** (sau `BearerGate`): body `{ sessions: [{ sourceId, kind?, taskId?, projectId?, taskCode?, executor?, status, startedAt, finishedAt, turns?, costUsd?, models?: [{ model?, inputTokens?, outputTokens?, cacheReadTokens?, cacheWriteTokens?, costUsd? }] }] }`. Không token 401; người thật 403; ≤ 50 phiên, ≤ 256 KB, ≤ 20 model / phiên. 400: `sourceId` trống / > 100 / trùng trong lô, `kind` ∉ task·chat·meeting·other, `status` ∉ done·failed·skipped, thời điểm thiếu múi giờ, `finishedAt` < `startedAt` hoặc > hiện tại + 1 ngày, số âm, chi phí > 999 999. OK `{ accepted, created, updated }`. Mcp không lưu; Api kiểm tra lại (`AiUsageRoute.Validate`).
- **`POST /api/audit/internal/ai-usage`**: khoá `Chat__McpToApiKey` (trống = `Chat__InternalKey`), sai 401; nginx trả 404 từ ngoài; body ≤ 272 KB. Không ghi nhật ký AI (không phải request bằng token).
- **Lưu** (`AiSessionUsageStore`): upsert theo (`UserId`, `SourceId`) — gửi lại = cập nhật, không xoá phiên; model cập nhật tại chỗ theo tên. Chuẩn hoá (`AiSessionLedger.Normalize`): kind / executor trống → `other`; gộp model trùng tên; không model → một dòng `"không rõ"`; một model không có chi phí → lấy chi phí phiên; phiên không có chi phí mà mọi model có → tổng model. Hai lô cùng `sourceId` đồng thời → trùng khoá → thử lại một lần.
- **Đọc** `/api/ai-usage/*` (cookie; token AI 403). Cả 3 route nhận `kind=task|chat|meeting|other` (lọc loại phiên, TEST-136; trống = mọi loại, sai → 400 — `AiSessionLedger.TryKind`). Cả 3 route cũng nhận `status=done|failed|skipped` (lọc trạng thái phiên, TEST-195; trống = mọi trạng thái, sai → 400 — `AiSessionLedger.TryStatus`), kết hợp AND với các bộ lọc khác. Quyền `AiSessionLedger.ResolveScope`: không `userId` = của mình; `userId` người khác hoặc `all` → chỉ admin / HR (khác 403); sai định dạng 400. `from` / `to` yyyy-MM-dd lịch VN; mặc định theo `group`: day 30 ngày · month 12 tháng · year 5 năm; tối đa 10 năm.
  - `GET /summary?from&to&group=day|month|year&userId` → `{ from, to, group, userId, groups: [{ bucket, model, sessions, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd, costMissing }], buckets: [tổng từng kỳ], total }`. Gộp theo `FinishedAt` **giờ văn phòng** (23:30 UTC → ngày hôm sau ở VN). `costUsd` = tổng giá trị có; `costMissing` = số phiên thiếu chi phí (FE hiện "chưa đủ"). Một phiên nhiều model: đếm ở từng model, nhưng `buckets` / `total` đếm một lần với chi phí phiên. Đọc dòng (phiên × model) rồi gộp trong bộ nhớ (`AiSessionLedger.Summarize`, vài nghìn dòng / năm).
  - `GET /sessions?from&to&userId&page&pageSize` → phiên mới nhất trước (tên tài khoản, loại, mã việc, model, token, chi phí, `durationSeconds`, trạng thái); không `page` → mảng ≤ 200.
  - `GET /export?from&to&group&userId` → Excel (sheet "Tổng hợp" kỳ × model + cộng kỳ, sheet "Phiên" ≤ 20 000 dòng, giờ VN).
- Không nhầm với `/api/audit/ai-usage` (báo cáo **số request** của token AI).

## Giao diện (TEST-136)

- **Kết nối AI (`/ai-access`) → tab "Mức dùng AI"** (`?tab=usage`, mọi người; tab "Toàn công ty" vẫn chỉ HR). Tab tải riêng (`React.lazy` → chunk `ai-usage-tab`). Bộ lọc trên URL: `usage=day|month|year` (mặc định day), `from` / `to` (yyyy-MM-dd; trống = mặc định BE: 30 ngày / 12 tháng; Năm gửi `from` = 1/1 chín năm trước = "tất cả" trong trần 10 năm), `kind` (ô "Loại phiên"), `status` (ô "Trạng thái" ngay sau ô Loại phiên: Mọi trạng thái · Xong · Lỗi · Bỏ qua; giá trị lạ trên URL = không lọc — TEST-195; lọc cả thẻ tổng / biểu đồ / bảng model / danh sách phiên / Excel, đổi → bảng phiên về trang 1), `user` (chỉ admin / HR — trống = `all`; người thường bỏ qua tham số, BE vẫn chặn).
  - Thẻ tổng: Token vào · Token ra · Token cache (đọc + ghi, tooltip tách) · Chi phí (USD) + "N phiên không có chi phí" · Số phiên. Điện thoại 2 cột.
  - Biểu đồ cột chồng theo model (`ai-usage-chart`): vẽ bằng CSS như Báo cáo → Trợ lý AI, **không thêm thư viện**; trục X đủ mọi kỳ trong khoảng (Năm: từ năm đầu có dữ liệu), Token (vào + ra + cache) ↔ Chi phí, màu model cố định (băm tên → bảng màu Tailwind), chú thích bấm ẩn / hiện, cột ≥ 14 px → cuộn ngang trên điện thoại. Trỏ / chạm / focus cột → thẻ nổi `ChartHoverCard` (TEST-224, [frontend-charts.md](../frontend-charts.md)): kỳ có thứ, tổng chỉ số đang xem + chỉ số còn lại, từng model (số rút gọn, %, giảm dần, bỏ model đang ẩn), dòng ⚠ phiên thiếu chi phí.
  - Bảng theo model (gộp các kỳ): số phiên, token, chi phí, % tổng chi phí; `*` = có phiên thiếu chi phí; model không phiên nào có chi phí → "—".
  - Danh sách phiên (`ai-usage-sessions`, BE phân trang, nút "Cột"): thời điểm, người / bot (chỉ khi admin xem "Tất cả"), loại, mã việc (link `/projects/{pid}?task={tid}` khi có id), model, token (rút gọn + tooltip đầy đủ), chi phí ("—" khi trống, không bao giờ $0), thời lượng, trạng thái (lỗi tô đỏ).
  - Nút **"Làm mới"** (`data-testid="ai-access-reload"`, TEST-149) trên thanh tab, hiện ở cả 3 tab (Của tôi / Toàn công ty: đứng trước "Tạo token"): `invalidateQueries` theo tab đang mở — "Mức dùng AI" → `aiUsageKeys.all`, hai tab kia → `accessTokenKeys.all` (token, ứng dụng, webhook, nhật ký, kết nối toàn công ty); giữ bộ lọc / trang; đang tải → icon xoay + nút khoá (`useIsFetching`).
  - "Xuất Excel" = `/api/ai-usage/export` cùng bộ lọc. Không có phiên → trạng thái trống: "Số liệu do agent-runner gửi sau mỗi phiên; người dùng Claude cá nhân qua MCP không có số token".
  - Định dạng: số vi-VN (1.234.567), tiền `$1,23` (dưới 1 xu tới 4 chữ số), token ≥ 1 triệu → "1,2 tr" / "tỷ" (`utils/aiUsage.ts`).
- **Hồ sơ (`/profile`) → thẻ "AI tháng này"** (`AiMonthCard`, export từ `@/features/ai-access`): `summary?group=month&from=<đầu tháng>&to=<hôm nay>` của chính mình; chỉ hiện khi có phiên. Tổng token, chi phí, model nhiều token nhất, số phiên, link "Xem chi tiết" → `/ai-access?tab=usage&usage=month`.

## Kiểm tra

Unit: `tests/OfficeHub.Modules.Audit.Tests/AiSessionLedgerTests.cs` (lô, chuẩn hoá, giờ VN, chi phí trống, quyền, `TryKind`, `TryStatus`). E2E (DB tạm): `scripts/dev/ai-session-usage-e2e.ts` (Api + Mcp, không FE); `scripts/dev/ai-usage-ui-e2e.ts` (giao diện, Chrome máy tính + điện thoại 390); `scripts/dev/ai-usage-flow-e2e.ts` (TEST-137, **xuyên khâu**: giả runner gửi `/mcp/usage` qua đúng `frontend/nginx.conf` → Mcp → Api → API đọc + Excel giải nén → Chrome tab "Mức dùng AI" + thẻ Hồ sơ; HR xem người khác / tất cả).

Runner gửi từ TEST-135 ([agent-runner-usage.md](agent-runner-usage.md)); các e2e trên vẫn thay runner bằng `fetch` cùng hợp đồng `AiUsageUpload`. Chưa có: bước chạy runner với CLI giả trong script xuyên khâu.

Ghi chú: Excel sheet "Phiên" có thêm một dòng trống cuối chỉ có định dạng (vùng định dạng tới `r` thay vì `r - 1`) — vô hại, đếm dòng phải bỏ dòng không có giá trị.
