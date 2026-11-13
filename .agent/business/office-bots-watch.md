# Xem bot đang làm gì trong văn phòng 3D — front-end (TEST-97 · bảng đầy đủ TEST-98 · tab File đã sửa TEST-100 · kéo / đổi cỡ TEST-102)

> Phần FE của [office-bots-activity.md](office-bots-activity.md) (hợp đồng sự kiện, đệm RAM, hub `WatchBot` / `UnwatchBot` / `BotActivity` / `BotWatchEnded` — TEST-92…96). Engine 3D nói chung: [office-engine.md](office-engine.md). Về [README.md](README.md).

Code: `frontend/src/features/office/` — `engine/OfficeScene.ts` (`onBotClick`, `botAt`, `botInfo`), `engine/voiceChannel.ts` (`canHear`), `api/officeHub.ts` (`watchBot` / `unwatchBot`, handler `botActivity` / `botWatchEnded`, `hubErrorMessage`), `types/office.types.ts` (`BotWatchEventDto`, `BotWatchDto`, `BotActivityDto`, `BotWatchEndReason`), `hooks/use-bot-watch.ts`, `components/bot-activity-panel/` (bảng "Màn hình của bot", TEST-98 — thay bảng tạm `bot-watch-panel` của TEST-97) + `components/bot-activity-event/` (vẽ một sự kiện), CSS `.bot-act*` trong `office-view/office.css`. E2E: `scripts/dev/bot-watch-e2e.ts` ([e2e.md](../e2e.md)).

- **Chọn bot**: bấm chuột / chạm vào avatar bot (nhãn tím) → `onBotClick(botId)`, **không** đi bộ tới đó; sàn / ghế giữ hành vi cũ. Vùng bấm = trục chân → đỉnh nhãn chiếu lên màn hình, bán kính nửa thân theo zoom nhưng ≥ 18 px (chuột) / 28 px (chạm). Rê chuột lên bot → con trỏ bàn tay. Trợ giúp HUD có dòng "Bấm vào bot AI…".
- **Phạm vi ở client chỉ để gợi ý**: `canHear(OFFICE_MAP, mình, bot)` (giống `OfficeMap.CanHear`) sai → `onHint` "Lại gần hơn để xem <tên bot> đang làm gì" (toast.info, không toast lỗi), không gọi hub. Đúng → `WatchBot`; server từ chối (HubException) → câu của server cũng qua `onHint`.
- **Hook `useBotWatch(connRef, conn, hint)`** → `{ view, watch, close, onActivity, onEnded }` (hàm ổn định, nối vào `OfficeConnection` trong effect kết nối). `view`: `botId`, `name`, `connecting`, `busy` / `task` (từ WatchBot / mỗi lô), `model` / `turns` / `costUsd` (từ `session_start` / `session_end` gần nhất, `session_start` đặt lại), `startedAt` / `endedAt` (`at` của `session_start` / `session_end`; `cleared` xoá), `events`.
  - Lô `BotActivity` xếp hàng rồi áp **một lần mỗi khung hình** (`requestAnimationFrame`; tab ẩn → áp ngay) — sự kiện dồn dập không làm React vẽ lại nhiều lần giữa các khung của cảnh 3D.
  - Gộp sự kiện: cùng `id` → thay (server đã trộn trường null = giữ cũ, giữ `seq`); lô có `session_start` → bỏ mọi sự kiện `seq` nhỏ hơn (server đã xoá đệm); xếp theo `seq`; > 200 → bỏ đầu. `cleared` → bảng trống, vẫn mở chờ phiên mới. Lô `BotActivity` tới trước kết quả `WatchBot` → gộp, không trùng dòng.
  - `BotWatchEnded(botId, reason)` → đóng bảng + gợi ý: `range` "Bạn đã đi ra xa" · `offline` "Bot đã offline" · `left` "Bạn đã rời văn phòng".
  - Hub `reconnecting` → `connecting`; nối lại (`online`) → chờ 600 ms (Welcome + vị trí kịp tới server, như `GetScreen`) rồi `WatchBot` lại, thất bại thử lại 1 lần sau 1,2 s, vẫn lỗi → đóng + lý do. `kicked` → đóng. Đóng bảng / rời trang → `UnwatchBot` (chỉ khi còn kết nối; ngắt thì server tự dọn).
  - **Không** ghi localStorage / cache (chủ dự án: không lưu lịch sử). Chỉ RAM của tab.

## Bảng "Màn hình của bot" (TEST-98)

`BotActivityPanel({ view, onClose })` — mở khi `view` khác null; đóng: nút ✕, phím `Esc` (bỏ qua khi đang có hộp thoại hoặc đang gõ trong ô nhập), server ngắt (`BotWatchEnded` → hook đặt `view = null`).

- **Đầu bảng**: avatar chữ cái + tên bot, nhãn **● Trực tiếp** (chỉ khi `busy = true`, chưa có `session_end`, không đang kết nối lại), dòng trạng thái "Đang làm · MÃ · việc" / "Đang rảnh" / "Đang kết nối…", dòng phụ `model · thời gian đã chạy · N lượt · $chi phí` (thời gian = `startedAt` → giờ máy, đếm mỗi giây; có `endedAt` thì đứng yên; lệch đồng hồ máy người xem → lệch vài giây, chấp nhận).
- **Thân** (`.bot-act-log`): đang ở cuối (cách đáy ≤ 32 px) → sự kiện mới tự cuộn xuống; người xem cuộn lên → **không** kéo xuống, hiện nút "↓ Về mới nhất". Đổi bot → bám cuối lại.
- **Từng loại sự kiện** (`BotActivityEvent`, `memo` — sự kiện không đổi không vẽ lại):

| `kind` | Vẽ |
|---|---|
| `command` | Khối terminal **luôn nền tối**, chữ mono: `title` (mờ) + `$ text`; `ok` và `output` đều chưa có + phiên còn chạy → dấu quay; `output` → dưới vạch đứt, > 12 dòng thì chỉ hiện **12 dòng cuối** (lỗi thường ở cuối) + nút "Xem cả N dòng"; `ok = false` → viền đỏ + nhãn "lỗi" |
| `file_edit` / `file_write` | Đường dẫn + diff: dòng `+` xanh, `-` đỏ, `@@` mờ; > 12 dòng → 12 dòng đầu + nút mở |
| `file_read` / `search` / `tool` (+ loại lạ) | Một dòng: biểu tượng + đường dẫn / mẫu tìm / tiêu đề tool + chữ phụ |
| `thinking` | Nhãn "💭 Suy nghĩ" + chữ nghiêng mờ, > 12 dòng thu gọn |
| `say` | Component `Markdown` chung với `noImages` |
| `session_start` / `session_end` | Vạch ngăn: tên việc · model / tiêu đề · lượt · chi phí |

- **Rỗng**: `busy = false` → "☕ <tên bot> đang nghỉ, chưa có việc nào đang chạy"; còn lại → "Đang chờ thao tác đầu tiên…".
- **Không tin nội dung**: mọi chuỗi là nút chữ của React — không `dangerouslySetInnerHTML`, không tự biến chuỗi thành link / ảnh; `say` qua `Markdown` (không HTML thô, không tải ảnh, link chỉ mở khi người xem bấm). Thẻ `<script>` / `<img onerror>` hiện nguyên văn.
- **Vị trí** (máy tính > 640 px — TEST-102): bảng nổi dùng chung hook `use-floating-panel` với chat nổi TEST-90 (không có hook thứ hai). Kéo bằng **thanh đầu bảng** (`.bot-act-head`, `office-bot-drag`; hook bỏ qua nhấn trên `button / input / a` → nút Đóng không khởi động kéo; hàng tab, dòng phụ, thân ngoài vùng kéo → bấm / cuộn / chọn chữ bình thường). Đổi cỡ bằng tay nắm góc dưới phải (`office-bot-resize`): nhỏ nhất 320 × 220, to nhất = vùng nhìn trừ lề 8 px; thân `flex: 1` cuộn, `pre` / diff xuống dòng → không tràn; đổi cỡ giữ "ở cuối → bám cuối, đã cuộn lên → đứng yên". Luôn trong vùng nhìn: đổi cỡ cửa sổ / xoay / bàn phím ảo → `fit` của hook (giá trị đã lưu không còn vừa → tạm về mặc định, màn hình rộng lại → về chỗ đã lưu). Cảm ứng: pointer events + `touch-action: none` ở thanh kéo và tay nắm; pointer capture giữ sự kiện trên bảng → kéo không làm nhân vật đi / camera xoay. Mặc định: cột bên phải sát trái bản đồ nhỏ, không lấn quá tâm màn hình + 40 px. Nhớ **chỉ vị trí / kích thước** theo trình duyệt ở localStorage `officehub.office.agent-screen-panel` (mở bot khác / tải lại vẫn dùng; không chứa sự kiện). Điện thoại (≤ 640 px): rộng hết màn hình dưới hàng thẻ trên cùng như `ScreenDocPanel`, không kéo / đổi cỡ.
- **Màu**: token theme app (`--background`, `--foreground`, `--muted`, `--border`, `--destructive`, `--success`, `--info`) → theo sáng / tối như `.screen-doc-md`; không dùng `color-mix()` (Safari cũ — [pitfalls.md](../pitfalls.md)).
- `data-testid`: `office-bot-watch` (+ `data-bot`, `data-live`), `office-bot-drag`, `office-bot-watch-state`, `office-bot-watch-close`, `office-bot-live`, `office-bot-elapsed`, `office-bot-log`, `office-bot-empty`, `office-bot-latest`, `office-bot-fold`, `office-bot-running`, `office-bot-resize`; dòng `.bot-watch-line[data-id][data-kind]` (+ `.err`), dòng phụ `.bot-watch-meta`.
- Tab "File đã sửa" (TEST-100, `components/bot-file-list/`): [office-bots-watch-files.md](office-bots-watch-files.md).
