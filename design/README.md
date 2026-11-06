# design/

Tài liệu thiết kế văn phòng 3D. Mặt bằng hiện hành: **68 × 30 m (2 040 m²)** = lõi 50 × 30 m duyệt 2026-11-06 + cánh đông "Nội dung số" x 50–68 (Studio, phòng quay, 2 phòng livestream, phòng thu âm; cùng ngày) — bản đồ chính thức `shared/office-map.json` **được sinh** từ `tools/gen-map-1500.ts` (không sửa tay JSON).

| File | Nội dung |
|---|---|
| [office-1500m2-proposal.md](office-1500m2-proposal.md) | **Mặt bằng hiện hành** (đã duyệt + áp dụng 2026-11-06): 50 × 30 m, 14 phòng, 100 chỗ, lý do bố trí, các chỗ code đã đổi |
| [tools/gen-map-1500.ts](tools/gen-map-1500.ts) | **Nguồn sinh bản đồ**: cụm bàn, phòng, đồ vật → `drafts/office-map-1500.json` (bản nháp để duyệt trước khi chép sang `shared/`) |
| [drafts/](drafts/) | Bản nháp JSON + SVG (`floor-plan-1500.svg`) — xem trước khi áp dụng |
| [office-3d-proposal.md](office-3d-proposal.md) | Đề xuất gốc (24 × 16 m, 2026-11-05): giả định, kiểu hình, kỹ thuật, lộ trình — phần mặt bằng đã được thay |
| [../shared/office-map.json](../shared/office-map.json) | **Nguồn sự thật** của mặt bằng (phòng, khu phòng ban, chỗ ngồi, đồ vật) — FE + server cùng đọc |
| [floor-plan.svg](floor-plan.svg) | Sơ đồ vẽ tự động từ JSON — không sửa tay |
| [tools/render-plan.ts](tools/render-plan.ts) | Vẽ SVG + kiểm tra bản đồ + ghi lưới va chạm `shared/office-map.grid.txt` (test server so sánh). Có tham số: `bun design/tools/render-plan.ts <map.json> <out.svg> [grid.txt]` để vẽ bản nháp |

Sửa mặt bằng (từ gốc repo):

```bash
# 1. sửa design/tools/gen-map-1500.ts (toạ độ cụm, phòng, đồ vật) rồi xem trước:
bun design/tools/gen-map-1500.ts
bun design/tools/render-plan.ts design/drafts/office-map-1500.json design/drafts/floor-plan-1500.svg   # kiểm tra + vẽ nháp
# 2. duyệt xong → chép sang bản chính (giữ name/notes của bản chính) và sinh lại SVG + lưới:
#    copy drafts/office-map-1500.json → shared/office-map.json, đổi $schema thành ./schemas/office-map.schema.json
bun design/tools/render-plan.ts      # floor-plan.svg + shared/office-map.grid.txt; lỗi (ghế bị chắn, cửa bị chặn, không đi tới được…) → exit 1
# 3. khởi động lại Realtime (đọc bản đồ lúc khởi động); test NavGridTests + e2e office/voice/chat có toạ độ cụ thể → sửa theo
```
