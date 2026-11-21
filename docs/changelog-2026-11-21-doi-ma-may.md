# 21/11/2026 - Đổi mã máy, bỏ tên gọi, Admin vào Máy & tem QR (BE)

## Vì sao
- Quản lý xưởng thấy tên gọi máy (vd "Máy dập oval") thừa so với mã ngắn in trên tem (vd DAP-OVAL-PA); cần đổi được mã.
  Chốt: bỏ tên gọi, chỉ giữ mã; QLSX và Admin đều đổi được mã.

## Thay đổi
- `floor/dto/workstation.dto.ts`:
  - `CreateWorkstationDto.name` không bắt buộc (không gửi thì tên = mã);
  - `UpdateWorkstationDto.code` mới, cùng luật với lúc tạo (2-32 ký tự, chữ / số / . _ -).
- `floor/floor-admin.service.ts`:
  - `createWorkstation`: tên = mã khi không gửi tên.
  - `updateWorkstation`: đổi mã thì viết hoa và tên đổi theo mã. `qrToken` giữ nguyên, nên tem đã dán vẫn quét được. Mã trùng
    máy khác -> 409 "Mã điểm làm việc X đã có".
  - Phần cập nhật tách sang `applyWorkstationUpdate`, logic tắt / đổi xưởng máy cắt giữ nguyên.
- `floor/floor.controller.ts`: 5 route Máy & tem QR mở thêm cho ADMIN: `GET settings`, `GET / POST workstations`,
  `PATCH workstations/:id`, `POST workstations/:id/regenerate-token`. Admin vốn có đủ quyền FLOOR_REPORT. Các route ghi khác của
  floor vẫn chỉ QLSX.

## Kiểm
- `floor-admin.service.spec.ts` thêm 4 ca:
  - tạo không tên -> tên = mã;
  - đổi mã -> viết hoa, tên = mã, không đổi qrToken;
  - mã trùng -> 409;
  - đổi mã máy cắt không xoá dòng chia.
- `floor.controller.spec.ts`: bảng phân quyền cập nhật 5 route; luật "Admin chỉ đọc" nay ngoại lệ đúng 3 route ghi Máy & tem QR.
- tsc build sạch; eslint 5 file sạch; jest module floor 26 bộ, 788 test đạt.

## Deploy
- Không migration. Deploy BE TRƯỚC FE: FE mới không gửi `name` khi thêm máy, BE cũ còn bắt buộc `name`.
