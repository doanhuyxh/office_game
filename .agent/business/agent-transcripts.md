# Transcript phiên agent trên cloud (TEST-144)

> Về [README.md](README.md) · runner: [agent-runner.md](agent-runner.md), quy tắc nối phiên: [agent-runner-workspace.md](agent-runner-workspace.md#nối-phiên-test-142) · mức dùng AI (cùng đường Mcp → Api): [ai-usage.md](ai-usage.md)

Chủ dự án chốt 2026-11-17: lưu **cả transcript**, giữ **90 ngày**, **mã hoá như lương**, **admin + HR** xem để tra soát. Khôi phục **lười theo từng phiên** (không có lệnh khôi phục toàn bộ). Bộ nhớ chính của việc vẫn là OfficeHub (bình luận + mục Bàn giao, chat, kênh phòng) — transcript chỉ dùng khi nối phiên trong ≤ 10 phút mà máy đã mất file, và để tra soát.

```
runner ─POST/GET /mcp/transcripts (token AI bot)─▶ Mcp (chỉ bot, gắn userId) ─/api/audit/internal/agent-transcripts (X-Internal-Key)─▶ Api
  Api: audit.agent_transcripts (metadata, bản bàn giao mã hoá) + S3 {S3__KeyPrefix}files/agent-transcripts/{userId}/{id}.enc (nội dung mã hoá)
```

## Runner (`agent-runner/src/hub/transcript.ts`)

- Chỉ adapter có transcript (`claude`: `<HOME>/.claude/projects/<cwd mã hoá>/<session>.jsonl`). Adapter `custom` không gửi.
- Sau mỗi phiên (việc / chat / họp): `task_sessions.transcript_pending = 1` + `kind` + `summary` (câu cuối của agent) → `TranscriptReporter.flush()` ở nền; nhịp 5 phút gửi lại hàng chờ (chung nhịp mức dùng AI); `run` chờ gửi trước khi thoát.
- **Che bí mật trước khi rời máy** (`redactTranscript`): mỗi dòng JSON → che TỪNG CHUỖI bằng `mask` (token đăng ký, `ohk_…`, PEM, `Bearer`, `password=` / `api_key: …`, `user:pass@`) rồi ghi lại — che thẳng trên dòng sẽ phá JSON. Đã thử CLI 2.1.311 thật: transcript đã che vẫn `--resume` được, mô hình nhớ ngữ cảnh, bí mật mất. Thà che nhầm còn hơn lộ.
- gzip; ≤ 6 MB sau nén (lớn hơn → bỏ, ghi `transcript_error`); sha256 trùng lần gửi trước → không gửi lại.
- Phản hồi: 200 → `transcript_sha`; 400 / 413 → bỏ (ghi lỗi); 401 / 403 → ngừng cho agent; 404 / 405 / mạng → giữ hàng chờ.
- **Khôi phục lười** (`Runner.resumeFor` → `TranscriptReporter.restore`): chỉ khi sắp nối phiên mà file không còn ở máy (hoặc mất `runner.db`) → GET đúng khoá job; bản cloud cập nhật ≤ 10 phút trước (`RESUME_MAX_GAP_MIN`) + đúng sha256 → ghi `<session>.jsonl` vào thư mục của cwd hiện tại → `--resume`. Không có / quá ngưỡng / lỗi → phiên mới (không chặn job).

## Máy chủ

- Hợp đồng chung `BuildingBlocks/Ai/AgentTranscript.cs` (`AgentTranscriptRoute`, `AgentTranscriptUpload`, `AgentTranscriptBatch`, `AgentTranscriptDto`). Kiểm tra: `key` ≤ 200, `kind` ∈ task·chat·meeting, `sessionId` ≤ 100, `summary` ≤ 4000, `contentBase64` phải là gzip ≤ 6 MB; body ≤ 9 MB (Mcp + Api), nginx `location = /mcp/transcripts` 10 MB.
- **Mcp** `POST /mcp/transcripts` (ghi), `GET /mcp/transcripts?key=` (bot đọc lại bản của mình) — sau `BearerGate`; người thật 403; `AgentTranscriptRelay` gắn `userId` theo token → bot khác cùng key = 404.
- **Api** (module Audit, `AgentTranscriptStore`): upsert theo (`UserId`, `Key`) — gửi lại thay file S3 + metadata, `ExpiresAt` = lần gửi cuối + 90 ngày. Nội dung: gzip → base64 → `IFieldEncryptor.Encrypt` (AES-256-GCM, `Encryption__Key`, định dạng `v2:<keyId>:`) → S3. Bản bàn giao mã hoá cùng cách. **Xoay khoá**: `FieldReEncryptionJob` không chạm file S3 → giữ khoá cũ trong `Encryption__PreviousKeys` ≥ 90 ngày.
- **Tra soát** (cookie, chỉ admin / HR; token AI kể cả của admin → 403): `GET /api/agent-transcripts?userId&kind&page&pageSize` (mới nhất trước, tên bot, key, loại, nhánh, bản bàn giao đã giải mã, kích thước, hạn) · `GET /api/agent-transcripts/{id}/download` → `transcript-<kind>-<key>.jsonl.gz` đã giải mã. Bản hết hạn không còn trong danh sách / 404.
- **Job** `audit.agent-transcripts` (6 giờ, Hệ thống → Vận hành): xoá bản hết hạn (file S3 rồi dòng), ≤ 500 / lượt.

## Kiểm tra

Unit: `tests/OfficeHub.Modules.Audit.Tests/AgentTranscriptTests.cs` (validate, mã hoá ↔ giải mã, sai khoá, tên file), `agent-runner/tests/transcript.test.ts` (che giữ JSON, gửi / không gửi lại / thay, lỗi theo mã, khôi phục lười: máy mới, quá 10 phút, lệch sha). E2E xuyên khâu (DB tạm, khoá mã hoá tạm, `S3__KeyPrefix` riêng): `scripts/dev/agent-transcripts-e2e.ts` 29/29 — `TranscriptReporter` thật → Mcp → Api → S3 → tải về khớp sha, đã che → khôi phục vào HOME mới; quyền; hết hạn.

## Chưa làm

Giao diện tra soát trên web (danh sách + tải về cho admin / HR) — hiện chỉ có API; việc ở bảng TEST (Lưu trữ).
