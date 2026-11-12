# agent-runner: model thực sự agent dùng (TEST-64)

> Về [agent-runner.md](agent-runner.md) · [README](README.md)

`executor.model` trong `agents.yaml` chỉ là **yêu cầu** (`--model` cho CLI). Runner đọc lại model CLI thật sự dùng để thấy model trống (CLI tự chọn), tên sai, alias, CLI tự hạ model (fallback / hết quota).

## Claude Code đọc model ở đâu

- `{"type":"system","subtype":"init","model":…}`: chỉ là model **được yêu cầu** (alias đã đổi sang tên đầy đủ, nhưng tên sai vẫn lặp lại nguyên) → dùng làm dòng log đầu job, không dùng để kết luận.
- `modelUsage` trong sự kiện `result`: `{ "<model>": { costUSD, inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, … } }` — **model thật**, có thể nhiều model (model phụ cho tác vụ nhỏ). Model chính = model init nếu có trong `modelUsage`, không thì model tốn nhiều nhất (`executor/model.ts`).
- Model sai (2.1.x): `result` có `is_error: true`, `terminal_reason: "api_error"`, `api_error_status: 404`, `modelUsage: {}`, chữ "There's an issue with the selected model …" (subtype vẫn `success`) → job `failed`, lý do `CLI báo lỗi (api_error 404)`.

Adapter `custom`: dòng JSON output có `model` thì đọc; không có → ghi model cấu hình kèm "(cấu hình)" (không có cả cấu hình → "không rõ (mặc định của CLI)").

## Khởi động (`start`) và `doctor`

- Mỗi agent một dòng: `CLI <kind> <bin> — <version> · model cấu hình X` (hoặc "mặc định của CLI").
- Adapter `claude` có **chạy thử** (sau khi mọi kiểm tra khác đã qua): `claude -p ok --output-format stream-json --verbose --max-turns 1 --strict-mcp-config --setting-sources user --tools "" --system-prompt "Reply with: ok" [--model X]`, cwd = `data_dir`, env của agent, tối đa 120 giây → vài trăm token.
  - Model không hợp lệ (404 / "selected model") → `✘`, **agent tắt** (cả `start` lẫn `doctor`).
  - Lỗi khác (mạng, hết quota, đăng nhập) → `⚠`, agent vẫn bật.
  - Model thật khác cấu hình → `⚠ model thật Y KHÁC cấu hình X`. So khớp: không phân biệt hoa thường, bỏ hậu tố `[…]`, tên thật chứa tên cấu hình là khớp (alias `opus` ↔ `claude-opus-5-5`).
- `--no-model-check` (`start`, `doctor`, `run`): bỏ chạy thử (tốn token) — dòng ghi "chưa kiểm tra".

## Mỗi job

- Log `agent đang làm` dòng đầu = model (`10:21:07 NV018 TEST-45 #3  ▶ claude-opus-5-5`; adapter không có `activity` → model cấu hình). `xong job` có `model=`; model thật lệch cấu hình → `warn model thật khác cấu hình`.
- `runner.db` bảng `jobs`: cột `model` (model chính; từ cấu hình thì kèm " (cấu hình)") + `model_usage` (JSON `{ model: { costUsd, inputTokens, outputTokens } }`, token vào gồm cache). DB cũ thiếu cột → `ALTER TABLE … ADD COLUMN` lúc mở `Store`; job trước TEST-64 có `model` null.
- Bình luận chi phí: dòng `- Model: claude-opus-5-5 · phụ: claude-haiku-5-5 ($0.01)` (lệch cấu hình → `⚠ khác cấu hình (X)`).
- `report`: sau bảng theo agent có mục **Theo model** (agent + model chính: số việc, chi phí, token; null → "không rõ").
