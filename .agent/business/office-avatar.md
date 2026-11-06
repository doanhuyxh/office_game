# Nhân vật văn phòng 3D (tuỳ chỉnh ngoại hình)

> Nguồn sự thật là code. Về [README.md](README.md) · văn phòng / hub: [office.md](office.md) · engine: [office-engine.md](office-engine.md).

Mỗi tài khoản chọn **dáng người (nam / nữ), màu da, tóc + màu tóc, màu mắt, áo, quần / váy, giày (+ màu)**. Chưa chọn → **một nhân vật mặc định chung** cho mọi người (`default` trong danh mục, chủ dự án chốt 2026-11-06). Không khoá trang phục theo vai trò; ai cũng tự sửa của mình, kể cả admin không có hồ sơ nhân viên.

## Model + danh mục

- Model: Quaternius **Ultimate Modular Men / Women** (CC0, glTF trên Google Drive của quaternius.com). Đã nhập sẵn vào `frontend/public/models/characters/{male,female}.glb` (+ `LICENSE.txt`).
- `bun scripts/dev/import-characters.ts <dir>` (`<dir>/men/*.gltf`, `<dir>/women/*.gltf`): mỗi giới **1 GLB** = 1 bộ xương + mọi phần (node `part-<slot>-<id>`) + clip `Idle` / `Walk` / `Run` / `Wave`; bỏ UV, normal → int8 (`KHR_mesh_quantization`), weights → uint8 (~2–3 MB / file, gzip ~0,8 MB). Ghi luôn **`shared/avatar-catalog.json`** (bảng màu, `default`, các phần + vật liệu tô màu) — **không sửa tay**, sửa bảng `BODIES` / `PALETTES` / `DEFAULT` trong script.
- Cùng giới dùng chung bind pose → ghép chéo đầu / áo / quần / giày được; **nam ↔ nữ không ghép chéo** (BE từ chối).
- Đổi `id` một phần = nhân vật đã lưu dùng id đó không còn hợp lệ (FE hiện mặc định, lưu lại sẽ 400) → tránh đổi id sau khi đã deploy.

## Dữ liệu (Identity)

`identity.user_avatars` (`UserId` PK + FK `users` cascade, `Look` jsonb, `UpdatedAt`). Không có dòng = mặc định. `Look`:

```json
{ "v":1, "body":"male|female", "head":"…", "top":"…", "bottom":"…", "shoes":"…",
  "skin":0, "hair":null, "eyes":null, "topColor":4, "bottomColor":null, "shoesColor":null }
```

Màu = chỉ số trong bảng (`skin`, `hair`, `eyes`, `cloth`), `null` = màu gốc của model. `Domain/AvatarRules.cs` kiểm tra theo danh mục **nhúng vào assembly** (`EmbeddedResource` trỏ `shared/avatar-catalog.json`; Docker build chép `shared/` vào `/shared`), bỏ trường lạ, ghi JSON gọn theo thứ tự cố định.

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/auth/me` | đăng nhập | thêm `avatar` (object hoặc null) |
| PUT | `/api/auth/avatar` | đăng nhập (chính mình) | body = Look → 200 bản chuẩn hoá; sai → 400 ValidationProblem (key = field) |
| DELETE | `/api/auth/avatar` | đăng nhập | 204, về mặc định |

Token AI: bị chặn (không có trong allowlist `AccessTokenAuth`); MCP `get_my_profile` bỏ trường `avatar`.

## Realtime

- Khi vào hub, `SessionValidator.CheckWithLookAsync` đọc `avatar` từ chính lần gọi `/api/auth/me` kiểm tra phiên → `Player.Look` (chuỗi JSON ≤ 1 KB). `PlayerDto` thêm `Look` (null = mặc định).
- Đổi nhân vật khi đang trong văn phòng: FE lưu REST → gọi hub **`RefreshLook()`** → server tự hỏi lại Api bằng cookie của người chơi (không nhận ngoại hình từ client), tối đa 1 lần / 2 s → phát **`LookChanged(id, look)`** cho cả văn phòng.
- HttpClient gọi Api phải `UseCookies = false` (xem [pitfalls.md](../pitfalls.md)).

## Front-end (`features/office/`)

| File | Vai trò |
|---|---|
| `engine/avatarLook.ts` | Kiểu `AvatarLook`, `AVATAR_CATALOG`, `DEFAULT_LOOK`, `validLook` (giống BE), `parseLook` (lỗi → mặc định), `withBody`, `randomLook` — không phụ thuộc Three.js |
| `engine/character.ts` | `loadBody` (cache 1 GLB / giới), `buildCharacter` (SkeletonUtils.clone, giữ 4 phần, tô màu theo tên vật liệu; vật liệu dùng chung theo (vật liệu, màu) → **không dispose**), `applySitPose` (bộ model không có clip ngồi: hạ hông 0,56 m, đùi ra trước, cẳng chân xuống sàn, xương bàn chân IK `FootL/R` dời theo, tay ra trước) |
| `engine/avatar.ts` | `Avatar(id, name, isMe, look)`: hiện khối low-poly tô theo màu đã chọn ngay, tải GLB xong thì thay; `setLook`; đi = clip `Run` (tốc độ 4,2 m/s), đứng = `Idle`, ngồi = `Idle` + `applySitPose`; `wave()` cho xem trước |
| `components/AvatarEditorDialog.tsx` | Dialog shadcn: tab Dáng & da · Tóc & mặt · Áo · Quần / váy · Giày; Ngẫu nhiên / Về mặc định / Lưu (`useSaveAvatar` cập nhật cache `/me`) |
| `components/AvatarPreview.tsx` | Three.js riêng: kéo để xoay, Đứng / Đi / Ngồi (có ghế) / Vẫy tay |
| `hooks/useAvatar.ts`, `api/avatar.api.ts` | `useMyLook`, `useSaveAvatar`; PUT / DELETE |

Mở editor: nút **"👤 Nhân vật"** trên thẻ tên HUD `/office`, gợi ý "Tạo nhân vật" khi chưa có (bấm "Để sau" → nhớ trong `localStorage` của trình duyệt), thẻ **"Nhân vật văn phòng 3D"** ở `/profile` (dialog `lazy` từ `@/features/office` → Three.js chỉ tải khi mở). Nginx container `web`: `location /models/` gzip + `Cache-Control: no-cache` (ETag).

Hiệu năng đo được: 60 nhân vật GLB ≈ 1 ms CPU / frame cho animation; mỗi nhân vật ~4 phần × 1–4 vật liệu draw call.

E2E: `scripts/dev/avatar-e2e.ts` ([e2e.md](../e2e.md)).
