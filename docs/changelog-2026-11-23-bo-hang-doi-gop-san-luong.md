# 23/11/2026 - Bỏ hàng đợi xưởng, gộp sản lượng vào Hướng dẫn cắt (BE)

## Vì sao
- Màn "Sản lượng & hàng đợi" trùng với Hướng dẫn cắt (xem các tổ). Hàng đợi bắt QLSX chuyển lệnh tay, nên tổ hay bị kẹt
  lệnh. Chốt 23/11: bỏ hàng đợi, sản lượng xem ở Hướng dẫn cắt, Khung hàn và Mảnh chờ đan.
- Hàn thấy lệnh có mảnh Phôi đạt KCS; Sơn thấy lệnh có khung Hàn đạt KCS.
- Hàn làm theo xưởng của lệnh. Phước An chỉ có tổ Phôi + Hàn, nên Sơn theo nơi sơn: Phước An lập phiếu chuyển khung sang
  Phú An, tổ Sơn Phú An sơn.
- Tin "đợt chờ KCS quá 4 giờ" chỉ gửi KCS. QLSX không còn số đỏ của tin này.

## Thay đổi
- **Migration `20261123100000_bo_hang_doi_phoi_done`:**
  - thêm cột `production_invoices."phoiDoneAt"`;
  - chép mốc xong Phôi từ dòng hàng đợi PHOI đã DONE;
  - đóng các tin đang mở FLOOR_PHOI_DONE / FLOOR_STAGE_COMPLETE.

  Bảng `floor_queue_entries` giữ nguyên nhưng không ghi nữa; xoá ở đợt sau.
- **Migration `20261123100100_kcs_batch_stale_chi_kcs`:** đóng các tin KCS_BATCH_STALE còn mở của người nhận là QLSX (không
  có vai KCS).
- **`floor/floor-stage.service.ts` (mới):**
  - **Tập lệnh tổ Hàn / Sơn làm được:**
    - Lệnh thuộc xưởng của máy (Hàn: xưởng của lệnh; Sơn: nơi sơn = `paintWorkshopId` ?? xưởng của lệnh), chưa kết thúc và
      chưa báo đủ.
    - Lệnh có mảnh Phôi đạt KCS (Hàn) hoặc khung Hàn đạt KCS (Sơn). Lệnh tổ đã từng báo cũng tính.
    - Xếp theo hạn giao rồi mã lệnh.
    - KCS chấm lỗi thì lệnh tự hiện lại để làm bù.
  - **Tiến độ từng tổ theo lệnh**, và chi tiết một lệnh.
  - Điều kiện "có đạt KCS" tính gộp trên DB bằng một câu truy vấn, không tải từng đợt về máy chủ.
- **Màn quét `GET /floor/scan/:token`:**
  - thêm `stagePis` (mã lệnh, hạn, còn thiếu N mảnh);
  - `runningPi` luôn null, `reworkPis` luôn [], để FE cũ không vỡ.
- **`POST /floor/scan/:token/reports`:** báo lệnh ngoài tập trả 409 "Lệnh này chưa làm được ở tổ {Hàn|Sơn} của xưởng này ...".
- **Lượt nền:** `checkPhoiDone` ghi `phoiDoneAt` khi Phôi đủ, phát realtime 'floor', không gửi tin.
- **API mới:**
  - `GET /floor/stage-progress?stage=&workshopId=&productionInvoiceIds=` và `GET /floor/stage-progress/:stage/:pi`.
  - Ai được xem: QLSX / Admin / Boss; tài khoản tổ chỉ xem tổ mình; KCS bị 403; QLSX gắn xưởng chỉ thấy xưởng mình (Sơn tính
    theo nơi sơn: QLSX Phú An thấy lệnh Phước An sơn ở Phú An).
  - Truyền `productionInvoiceIds` (tối đa 200 id) thì trả đúng các lệnh đó, không áp cửa sổ 7 ngày.
- **Bỏ:**
  - các route `/floor/queue*` (nay trả 404);
  - `/floor/reports/:id/reverse` nay trả 403 kèm câu giải thích;
  - không phát FLOOR_PHOI_DONE / FLOOR_STAGE_COMPLETE nữa, nhưng giữ định nghĩa để tin cũ vẫn hiện đúng;
  - `ensurePhoiQueued` / `queueMissingPhoi`;
  - phần dời hàng đợi khi đổi xưởng lệnh, kèm `queueMoves` trong tin PI_WORKSHOP_CHANGED;
  - KCS_BATCH_STALE không gửi QLSX nữa, và bỏ khỏi số đỏ menu QLSX (`GET /floor/summary`).
- **Câu 403 các route báo cũ:** bỏ ý "QLSX hủy lần báo sai". Báo sai số thì KCS sửa bằng "Thực có" lúc chấm.
- **Xoá file:** `floor-queue-move.util(.spec).ts`, `dto/floor-queue.dto.ts`. Script `test/load/floor-load.mjs` bỏ phần gọi
  hàng đợi.

## Kiểm
- Test tích hợp mới:
  - `test/integration/bo-hang-doi-quet|xong-phoi|quyen.integration.spec.ts` (+ fixture);
  - sửa `n1-nhom1`, `p1-kcs-cham`, `p1-kcs-stale`, `p1-kcs-quyen.e2e-spec.ts` theo hành vi mới.
- Tích hợp 18 bộ / 211 test đạt.
- E2E 166/167. Ca T3-15 chuyển kho (`loi-test-toan-he-thong-1911`) đỏ từ trước, file không đổi.
- Jest floor / production-invoices / notifications 44 bộ / 1367 đạt.
- tsc build sạch, nest build đạt, eslint sạch.
- QA review độc lập: 0 Cao, 3 Vừa (đã sửa). QA nghiệm thu trên bản sao dữ liệu 17/11 (desktop + 375 px): Đạt sau 1 lượt sửa
  (cột SL cần, lỗi 409 sau báo đủ, chữ). AC chưa kiểm: máy rảnh tự kéo (tắt trên bản sao), đóng tin cũ, hủy lần báo cũ (không có dữ liệu).

## Deploy
- 2 migration. Deploy BE TRƯỚC, FE NGAY SAU: FE mới gọi `/floor/stage-progress`, FE cũ gọi `/floor/queue*` (sẽ 404).
- Trước deploy: chạy SELECT chỉ đọc production theo spec mục 9 (lệnh đang nằm trong hàng đợi, tin mở) và kiểm xưởng
  Phước An có `paintWorkshopId` = Phú An.
- Sau deploy: tổ Hàn / Sơn tải lại màn quét. Lệnh Phước An vẫn sơn ở Phú An (phiếu chuyển khung như cũ).
