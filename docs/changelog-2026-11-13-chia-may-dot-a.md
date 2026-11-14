# 13/11/2026 - Chia sắt cho máy cắt, đợt A (nền)

Theo file "Quy tắc chia sắt cho máy cắt" (Sếp tổng hợp 07/11). Sếp đã chốt hệ thống tự động chia; đợt A làm phần nền, đợt B (bảng chia
tự động) chờ Sếp trả lời các câu còn mở. FE đi kèm: xem changelog cùng tên ở repo FE.

## Thay đổi

1. **Máy cắt theo xưởng** (`floor`):
   - `Workstation` thêm `workshopId` (xưởng đặt máy) và `cutMachineType` (`laser` | `tu_dong`).
   - Máy loại CUT bắt buộc có loại máy; loại khác không được có (CHECK `workstations_cut_type_chk`). Máy CUT có từ trước được gán `laser`.
   - `POST /floor/workstations`: nhận `workshopId?`, `cutMachineType?` (máy CUT thiếu loại thì mặc định `laser` để FE cũ / e2e không vỡ).
   - `PATCH /floor/workstations/:id`: nhận thêm `workshopId` (null = bỏ xưởng) và `cutMachineType` (chỉ máy CUT).
   - Xưởng sai hoặc đã ngừng thì báo 400.
   - Danh sách máy và brief máy ở màn quét trả thêm `workshopId`, `workshopName`, `cutMachineType`.
2. **Số lỗ ô van: đã làm rồi GỠ trong ngày** (Sếp chốt 13/11, câu 7: cây có lỗ ô van là không cắt máy tự động, bỏ luật "1 đoạn × 1 lỗ" -
   số lỗ không còn tác dụng). Không còn cột `PieceBom.ovalHoleCount`, không đổi khoá duy nhất, không đổi màn Định mức mảnh.
3. **Nhãn máy cho kiểu cắt** (`cutting-proposals`, chỉ `GET /cutting-proposals/:id`):
   - Mỗi kiểu cắt có `machineGroups`: các nhóm cây với lớp máy theo câu 7 Sếp chốt 13/11 (khoan = Đục lỗ, ô van = Dập):
     - `TU_DONG`: cây không có lỗ, hoặc chỉ có khoan (tán) -> máy tự động.
     - `LASER`: cây có ≥ 1 đoạn dập (lỗ ô van) -> không cắt máy tự động.
   - Bộ giải gộp đoạn theo chiều dài nên kiểu cắt không biết đoạn nào phải dập. Hệ thống gom đoạn dập vào ít cây nhất
     (`pattern-machine-class.util.ts`), nên 1 kiểu cắt có thể tách thành nhiều nhóm cây - ít cây phải cắt laze nhất.
   - Cấp phương án có `machineContext` (`workshopId`, `workshopName`, `laserAllowed`). Xưởng bị khoá máy tự động (Phước An) có `laserAllowed = false`:
     cây có đoạn dập vẫn cắt máy tự động, lỗ công nhân làm tay (quy tắc 07/11 mục 3, Sếp xác nhận Phước An chỉ có máy tự động).
   - Nhu cầu dập = số mảnh/bộ × số đoạn/mảnh × số bộ, theo đúng định mức và số lượng phương án đã giải (ảnh chụp đầu vào, hoặc lệnh SX).
     Thêm 2–3 truy vấn gộp vào `findOne`.
   - Lỗi khi phân loại chỉ ghi log, không làm hỏng màn chi tiết. Danh sách lượt tính của KHSX không có các trường này.

## DB

Migration `20261113120000_cut_machines_by_workshop`:
- `workstations`: thêm `workshopId` (FK `workshops`, ON DELETE SET NULL, có chỉ mục) và `cutMachineType`; CHECK như trên; gán `laser` cho máy CUT có sẵn.


## Deploy

`prisma migrate deploy` như thường lệ, không cần seed. Sau khi deploy: QLSX khai xưởng và loại máy cho từng máy cắt ở "Sản lượng xưởng → Máy & tem QR".

## Kiểm tra

- jest các module liên quan (cutting-proposals, production-invoices, system-config, floor, skus, bom-revisions, steel-issues, purchase-proposals,
  stock, notifications, common/utils): 82 bộ, 1939 test pass. `nest build` được. tsc chỉ còn 2 lỗi cũ ở `prisma/seed-*.ts`.
- Thử trên BE local với dữ liệu thật:
  - Phương án Phước An trả `laserAllowed = false`.
  - Phương án Phú An tách đúng nhóm MC Laser / MC Tự động.

## Chưa làm / lưu ý

- Bảng chia sắt cho máy: đã làm ở đợt B1 (`changelog-2026-11-13-chia-may-dot-b1.md`). Theo dõi máy rảnh (đợt C) và chia đoạn dư cho
  lệnh sau (câu 9) chưa làm.
- Màn quét QR và hàng đợi tổ chưa lọc theo xưởng (giai đoạn 2 QLSX theo xưởng).
- Phương án tính trước khi khoá máy theo xưởng có thể ghi "Máy cắt: MC Laser" nhưng nhãn kiểu cắt là "MC Tự động · lỗ làm tay" (xưởng Phước An).
  Nhãn theo máy thật của xưởng.
