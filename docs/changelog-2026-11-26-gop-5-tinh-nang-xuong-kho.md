# Gộp 5 tính năng xưởng / kho, mọi công tắc TẮT (26/11/2026)

Gộp code quản lý gửi 24-25/11 (đã review 25/11, câu hỏi nghiệp vụ chốt 25-26/11) vào `main`. **Mọi tính năng mới có công tắc và để
TẮT**: tắt thì hệ thống chạy như trước. Phần sửa theo các câu đã chốt (đợt 2) chưa làm ở đây. Không gộp: ghi nhận tiền về (chưa có
công tắc, phải sửa trước), nâng cấp thư viện FE.

**Có 5 migration** (chỉ thêm bảng / cột / giá trị enum, không đổi dữ liệu cũ). Đã đổi tên cho chạy SAU 3 migration huỷ lệnh đợt 2
(`20261125090000..110000`):

- `20261126100000_stage_handover`
- `20261126100100_pallet_son`
- `20261126100200_chuyen_kiem_dong_goi_qr`
- `20261126100300_vi_tri_kho_load_cont`
- `20261126100400_dieu_phoi_dan`

## 1. Tính năng và công tắc (biến môi trường, mặc định `false`)

| Công tắc | Tính năng |
|---|---|
| `STAGE_HANDOVER_ENABLED` | Giao nhận giữa tổ: kho Phôi giao đoạn cho Hàn, kho Hàn giao khung cho Sơn bằng phiếu XK; Hàn / Sơn chỉ báo trong số đã nhận; QLSX mở chặn có lý do. Cần `SEGMENT_STOCK_ENABLED=true`. |
| `PALLET_SON_ENABLED` | Pallet Sơn: pallet cố định có tem QR, thủ kho Sơn xếp pallet, công nhân Sơn quét pallet báo "Sơn xong", xuất đan theo pallet. |
| `CK_DG_QR_ENABLED` | Chuyền kiểm + đóng gói bằng quét QR; vai KCS chuyền kiểm chấm. |
| `VI_TRI_KHO_ENABLED` | Vị trí kho Thành phẩm (khu - dãy - ô có tem QR), soạn hàng theo booking, quản lý cont (số cont, seal, ảnh). |
| `DIEU_PHOI_DAN_ENABLED` | Tài khoản Điều phối đan: theo dõi điểm đan giữ hàng, lời hẹn trả + nhắc. |

## 2. Sửa thêm khi gộp

- Ghép với huỷ lệnh đợt 2: `steel-issues.service.ts` dùng hàm tính sắt chung `steelUsage` và vẫn trừ phần cây đã nhập trả kho
  (trả sắt của SKU huỷ). `schema.prisma`: giữ cả liên kết chuyển hàng của SKU huỷ lẫn liên kết lần báo đóng gói; enum sổ kho có cả
  `STEEL_RETURN` lẫn `SEGMENT_HANDOVER`, `FRAME_HANDOVER`.
- Vị trí kho: huỷ một lần báo đóng gói CŨ (chưa gắn ô) mà hàng đó đã được cất vào ô hoặc đã vào cont / đã xuất thì chặn (409, câu
  báo nêu mã ô), không để lại hàng ảo trong ô (`ViTriKhoService.assertCancelKeepsBinStockInTx`, gọi khi huỷ lần báo đóng gói).
- Giao nhận, công tắc tắt: `GET /stage-handover/board` và `GET /stage-handover/plan` (dạng danh sách - FE gọi mỗi lần QLSX mở
  "Sản lượng xưởng" / thủ kho mở "Phân phối nội bộ" để biết có hiện tab mới) trả ngay `enabled: false`, không dựng số từng lệnh
  (trước đây có thể chạy hàng nghìn truy vấn mỗi lần mở). `POST /stage-handover/overrides` báo 400 khi tắt.
- Seed: thêm vai Điều phối đan; sửa kiểm kho theo xưởng (bỏ kiểm 1-1 làm seed dừng). Seed đồng bộ lại quyền MỌI vai về đúng
  bảng quyền trong code - chạy trên production sẽ ghi đè quyền đã chỉnh tay. Đợt này KHÔNG cần chạy seed.
- Bỏ tên người trong chú thích, test và migration.

## 3. Kiểm

- `prisma validate`, `nest build` đạt; tsc chỉ 2 lỗi seed cũ có sẵn.
- Trên `main` mới nhất (02016a3): jest các module có đổi 111 bộ / 2539 test đạt; test tích hợp (DB test) 23 bộ / 254 test đạt.
  Sau khi thêm phần "trả ngay khi tắt": giao nhận 13 + 14 (tích hợp) test đạt.
- QA review độc lập "tắt hết công tắc thì như cũ": Đạt có điều kiện - đã sửa 2 chỗ hiệu năng + 1 API chưa gác công tắc (ở trên);
  số liệu / tồn kho / câu báo của các luồng cũ không đổi.
- Migration trên bản sao production 23/11: chạy đủ 8 (3 huỷ lệnh đợt 2 + 5 ở trên), chạy lần 2 không còn gì, so schema với DB
  không lệch.

## 4. Lưu ý deploy

- Để nguyên các công tắc ở mục 1 là `false` trên production (không cần đặt thêm biến; thiếu biến = tắt). Kiểm
  `SEGMENT_STOCK_ENABLED` vẫn `false`.
- Lên BE trước FE. Không chạy seed.
- Còn khác ở màn cũ khi tắt (chữ, không đổi số): màn điểm đan có thêm
  cột / ô "Người liên hệ"; mỗi lần đọc phiếu XK trả thêm `palletCodes: []`.
- Bật từng công tắc theo kế hoạch riêng, sau khi làm xong phần sửa đợt 2 và chạy thử trên bản thử.
