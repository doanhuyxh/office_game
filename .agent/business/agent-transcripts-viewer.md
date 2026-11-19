# Xem nhanh transcript trên web (TEST-197)

> Thuộc [agent-transcripts.md](agent-transcripts.md) (lưu trữ, API, tab tra soát TEST-145). Chỉ front-end — không đổi back-end / `agent-runner/`.

Kết nối AI → tab **"Transcript agent"** (chỉ admin / HR) → mỗi dòng có nút **"Xem"** cạnh "Tải về" → hộp thoại lớn (90dvh, `sm:max-w-5xl`) hiện nội dung phiên theo thứ tự.

## Luồng dữ liệu

- Nguồn: endpoint có sẵn `GET /api/agent-transcripts/{id}/download` (đã giải mã, `application/gzip`, không `Content-Encoding`; quyền ở BE — người khác / token AI 403). `agentTranscriptApi.open` → `httpStream` (`services/api-client.ts`: fetch cookie, trả `Response` còn luồng, lỗi HTTP → `ApiError`).
- `hooks/useTranscriptContent.ts`: đọc theo luồng → byte đầu `1f 8b` thì `DecompressionStream('gzip')` (không thêm thư viện; proxy đã giải nén thì đọc thẳng) → `TextDecoderStream` → tách dòng → `TranscriptParser`. Thanh tiến độ theo byte nén đã nhận / `Content-Length` (cập nhật ~120 ms). Không React Query, không localStorage: dữ liệu sống trong component; đóng hộp thoại (unmount) là bỏ, request bị huỷ.
- Ngưỡng `TRANSCRIPT_VIEW_MAX_BYTES` = **3 MB nén** (`utils/agentTranscript.ts`, so với `sizeBytes` của danh sách): lớn hơn → không tự tải, báo + "Tải về" + "Vẫn mở trên web". Số đo (Chrome máy tính, 2026-11-19): bản thật 4,9 MB nén / 8,7 MB chữ / 921 dòng → 0,3 giây; bản dễ nén 5,7 MB nén / 45 MB chữ → 0,36 giây, heap ~176 MB; 24k lượt (0,85 MB nén) → 0,18 giây, cuộn liên tục ~54 khung/giây.

## Phân tích dòng (`utils/transcriptParse.ts`)

- Adapter `claude` (Claude Code `.jsonl`): `type: user|assistant` + `message.content` (chuỗi hoặc mảng khối) → lượt **Người dùng** (`text`, `image`; `isMeta` → Hệ thống) · **Assistant** (`text`, Markdown) · **Suy nghĩ** (`thinking` / `redacted_thinking`; rỗng = chỉ chữ ký → báo "Không lưu nội dung") · **Gọi tool** (`tool_use`, nhớ `id → tên`) · **Kết quả tool** (`tool_result`, tên tool tra theo `tool_use_id`, `is_error` → nhãn lỗi đỏ). `isSidechain` → nhãn "agent con".
- Bản ghi nội bộ của CLI (`api-request*`, `attachment`, `queue-operation`, `session-owner`, `last-prompt`, `cost-state`, `summary`, `system`…) → **Hệ thống** (ẩn sẵn trong bộ lọc).
- Còn lại (adapter khác như `codex`, loại sự kiện lạ, JSON hỏng, khối lạ) → **Khác (JSON thô)**, thu gọn — không bao giờ ném lỗi.

## Trình bày (`components/agent-transcript-viewer`, `components/transcript-turn`)

- Mỗi lượt: nhãn + màu token (info / primary / muted / warning / success / destructive), giờ, `#dòng` trong file. Người dùng / assistant mở sẵn; suy nghĩ / tool / hệ thống / JSON thô thu gọn (đầu lượt có dòng xem trước: lệnh, đường dẫn, mẫu tìm…), bấm để mở.
- Gọi tool: `Bash` → mô tả + khung `$ lệnh`; `Edit` / `MultiEdit` → đường dẫn + diff đỏ / xanh từ `old_string` / `new_string`; `Write` / `Read` → đường dẫn (+ nội dung / dòng); khác → JSON. Tên MCP `mcp__officehub__get_task` hiện `officehub · get_task`.
- Chữ dài > 4000 ký tự (kết quả tool, JSON) cắt + "Xem đủ (N ký tự)"; prompt > 12 dòng → "Xem cả N dòng". Trạng thái mở / xem đủ giữ ở hộp thoại (cuộn ảo bỏ mục khuất khỏi DOM).
- An toàn: nội dung do agent sinh → chữ thuần; assistant qua `Markdown` chung `noImages` (như "Màn hình của bot"). Không tự "bỏ che" bí mật runner đã che.
- Không import code từ `features/office` (`bot-activity-event` dùng CSS riêng `.office-root` và chunk 3D) — chỉ làm cùng kiểu trình bày.
- Cuộn ảo `hooks/useVirtualList.ts` (không thư viện): chiều cao đo bằng `ResizeObserver`, khoá theo số lượt, bù `scrollTop` khi mục phía trên đổi cao; ≤ ~80 lượt trong DOM.
- Công cụ: tìm (không phân biệt hoa thường, cả tên tool, giãn 250 ms) → chỉ hiện lượt khớp; lọc loại lượt (nút bật / tắt kèm số đếm); "Về đầu" / "Xuống cuối"; "N lượt" / "Đang hiện M / N lượt".
- Trạng thái: đang tải (thanh tiến độ + MB + số lượt), lỗi: 404 → "đã hết hạn hoặc không còn" (không nút tải), gzip hỏng / đứt giữa chừng → "Không giải nén / đọc được…"; cả hai có Thử lại.

## Kiểm tra

`scripts/dev/agent-transcript-viewer-e2e.ts` 63/63 (DB + S3 tạm, như `agent-transcripts-ui-e2e.ts`; `MEASURE_FILE=<.jsonl>` đo thêm một bản thật).
