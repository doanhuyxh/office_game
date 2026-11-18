# agent-runner — MCP thêm ngoài OfficeHub

Tách từ [agent-runner-workspace.md](agent-runner-workspace.md).

## Mẫu agent thiết kế: Stitch

Runner chỉ ghi server `officehub` vào `mcp.json` của job và chạy `--strict-mcp-config`. Muốn agent có thêm MCP khác (chưa có khoá cấu hình riêng) → nạp file thứ hai qua `executor.extra_args` (adapter `claude`; CLI nhận nhiều `--mcp-config`). Mẫu: agent `NV140` trong `agent-runner/agents.example.yaml` + `agent-runner/design-mcp.example.json`.

1. Chép `design-mcp.example.json` ra ngoài repo (vd `/etc/officehub-runner/design-mcp.json`). File không chứa khoá: `${STITCH_API_KEY}` lấy từ `env_file` của agent (runner nạp vào env của CLI).
2. **Stitch** (`https://stitch.googleapis.com/mcp`, header `X-Goog-Api-Key`): tạo khoá trong Stitch → Settings, ghi `STITCH_API_KEY=…` vào `env_file` (chmod 600).
3. Figma đã bỏ (2026-11-17: MCP giới hạn theo gói / ghế, bản desktop cần app GUI). Bàn giao thiết kế bằng ảnh + đặc tả + file .html Stitch đính kèm bình luận việc.
4. Thử: `bun src/cli.ts run --agent NV140 --task <mã việc thử>` rồi xem `{data_dir}/jobs/{id}/activity.log` có lời gọi `mcp__stitch__*`.
5. Quy trình thiết kế (dựng trên Stitch → chụp ảnh + đặc tả → `create_upload` → bình luận "BÀN GIAO THIẾT KẾ" → Review; việc code `dependsOn` việc thiết kế, dev đọc bằng `view_attachment`, code bằng shadcn + token, không chép code Stitch) viết vào hướng dẫn dự án / chức vụ, không viết vào prompt của runner.

Lưu ý: `doctor` không kiểm tra các MCP thêm này; phiên chat / họp của agent cũng có các tool đó (dùng chung `executor`) nhưng vẫn chỉ MCP; NV140 cần `builtin_tools: true` để tải ảnh lên.
