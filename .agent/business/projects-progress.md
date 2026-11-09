# Dự án: tổng quan tiến độ

Hàm thuần `Domain/ProgressRules.cs` (test `ProgressRulesTests`), tính trong `ProjectEndpoints.ToDtosAsync` → `ProjectDto.progress` (`GET /api/projects`, `/{id}`; tool MCP `list_projects` / `get_project` cũng trả).


% hoàn thành = việc Xong / tổng việc; % thời gian = (hôm nay − bắt đầu) / (kết thúc − bắt đầu). Chỉ dự án đang chạy có `health`: **Trễ** = quá ngày kết thúc còn việc mở · mốc mở quá hạn · việc quá hạn ≥ max(3, 20% việc mở); **Có rủi ro** = có việc quá hạn · % thời gian − % xong ≥ 25 · còn ≤ 14 ngày đến kết thúc mà xong < 80%. `healthReasons` = câu giải thích.

FE: `/projects?tab=overview` (`ProjectsOverview`: ô đếm theo tình trạng — bấm để lọc, bảng sắp Trễ → Rủi ro → Đúng tiến độ, rồi theo số việc quá hạn); thẻ dự án hiện `ProgressBar` (xếp chồng Xong / Chờ review / Đang làm, vạch = % thời gian) + tình trạng + mốc tiếp. Ngưỡng là quy ước tạm, đổi thì sửa cả test.
