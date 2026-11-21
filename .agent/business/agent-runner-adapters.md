# agent-runner — thêm adapter cho một CLI mới

Tách từ [agent-runner-code.md](agent-runner-code.md). Adapter đang có: `claude` ([agent-runner.md](agent-runner.md)), `codex` ([agent-runner-codex.md](agent-runner-codex.md)), `antigravity` ([agent-runner-antigravity.md](agent-runner-antigravity.md)), `custom` (CLI tự khai tham số trong `agents.yaml`, không cần code).

## Cấu trúc

```
agent-runner/src/executor/
  types.ts            Adapter, ExecContext, ExecResult
  run.ts              chạy tiến trình, đọc stdout từng dòng, gọi adapter
  adapters/
    index.ts          registry: kind → adapter (executor.kind hợp lệ lấy từ đây)
    shared.ts         jsonLine, readMcpServers, sharedHomeWarning
    claude/           index.ts · events.ts · home.ts
    codex/            index.ts · events.ts · session.ts
    antigravity/      index.ts · events.ts · session.ts
    custom/           index.ts
```

## Các bước (opencode, cursor, gemini…)

1. **Chạy thử CLI thật trước**: `<cli> --help`, chạy không giao diện một lần, lưu output mẫu. Cần biết: cờ chạy không hỏi, cách nhận prompt (runner không cấp stdin — prompt phải là tham số hoặc file `ctx.promptFile`), cách khai MCP, định dạng output, cách nối phiên, nơi lưu phiên.
2. Tạo `executor/adapters/<tên>/index.ts` xuất `<tên>Adapter: Adapter`; file dài thì tách `events.ts` (sự kiện xem trực tiếp), `session.ts` / `home.ts` cùng thư mục. Thứ dùng lại được cho CLI khác → `adapters/shared.ts`.
3. Thêm một dòng vào registry `adapters/index.ts` — `executor.kind` trong `agents.yaml` tự hợp lệ.
4. Bắt buộc: `command` (dựng lệnh từ `ExecContext`), `parseLine` (điền `sessionId`, `summary`, token, `isError`), `caps` khai THẬT (`toolRestriction: true` chỉ khi CLI tắt hẳn được công cụ có sẵn — đã thử, không phải đoán).
5. MCP: CLI không nhận file `mcpServers` của Claude Code → `readMcpServers(ctx.mcpConfigFile)` rồi đổi sang cách khai của CLI đó (mẫu: `codexMcpArgs`). Token chỉ đi qua biến môi trường, không vào tham số / file. CLI không thay được biến môi trường trong header HTTP (Antigravity) → khai máy chủ kiểu stdio trỏ vào cầu nối của runner: `bridgeCommand(url, bearerEnv)` ở `hub/mcp-bridge.ts` (lệnh `mcp-bridge`).
6. Tuỳ chọn, có thì người dùng được thêm tính năng: `activity` (log tiến độ), `events` (xem trực tiếp trong 3D — mọi sự kiện qua `sanitize`), `hasSession` (chỉ nối phiên khi còn file), `finish` (đọc thêm sau khi CLI thoát, vd model thật), `probe` / `parseProbe` (chạy thử model), `transcriptFile` (gửi transcript lên cloud), `configProblems` (chặn cấu hình sai từ lúc khởi động), `homeWarnings` (cảnh báo `doctor`: chưa đăng nhập, trường cấu hình không có tác dụng).
7. Test trong `tests/executor.test.ts` bằng output mẫu ở bước 1; thêm agent mẫu vào `agents.example.yaml`; viết `.agent/business/agent-runner-<tên>.md` (lệnh chạy, khác gì `claude`, phần nào chưa kiểm với tài khoản thật) + dòng định tuyến trong `AGENTS.md` và `business/README.md`.

Không sửa `run.ts`, `config.ts`, `jobs/` khi thêm CLI; nếu thấy cần thì `Adapter` đang thiếu một điểm mở rộng — thêm vào `types.ts` dạng tuỳ chọn.
