# design/

Tài liệu thiết kế văn phòng 3D. Đề xuất đã được duyệt 2026-11-05; **giai đoạn 1 (thế giới 3D) đã làm** — bản đồ chính thức nằm ở `shared/office-map.json`.

| File | Nội dung |
|---|---|
| [office-3d-proposal.md](office-3d-proposal.md) | Đề xuất văn phòng 3D: mặt bằng, gán chỗ ngồi, dữ liệu bản đồ v2, hình ảnh, kỹ thuật, lộ trình, câu hỏi cần duyệt |
| [../shared/office-map.json](../shared/office-map.json) | **Nguồn sự thật** của mặt bằng (phòng, khu phòng ban, chỗ ngồi, đồ vật) — FE + server cùng đọc |
| [floor-plan.svg](floor-plan.svg) | Sơ đồ vẽ tự động từ JSON — không sửa tay |
| [tools/render-plan.ts](tools/render-plan.ts) | Vẽ SVG + kiểm tra bản đồ + ghi lưới va chạm `shared/office-map.grid.txt` (test server so sánh) |

Sửa mặt bằng:

```bash
# sửa shared/office-map.json rồi (từ gốc repo):
bun design/tools/render-plan.ts      # vẽ lại floor-plan.svg + office-map.grid.txt, báo lỗi (ghế bị chắn, cửa bị chặn, không đi tới được…) → exit 1
```
