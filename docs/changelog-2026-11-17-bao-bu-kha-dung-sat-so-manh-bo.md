# 17/11/2026 - Báo bù sau KCS lỗi, câu lỗi / tin KCS bằng lời thường, khả dụng sắt, số mảnh / bộ (BE)

Đi kèm FE: changelog cùng ngày `changelog-2026-11-17-dong-bo-bo-theo-dinh-muc.md` ở repo FE.
Không migration, không biến môi trường mới. Không đổi route. API chỉ THÊM trường; có 2 trường `done` đổi nghĩa (xem mục 1).

## Vì sao

Thử trọn luồng 2 lệnh trên bản sao dữ liệu (17/11) thấy:

1. Công nhân báo bù đoạn KCS chấm lỗi thì màn quét và thẻ QLSX "chờ gửi KCS" coi phần bù là **vượt** (vd "1192/1180 · vượt 12"), hộp "Gửi KCS tất cả" báo "có cảnh báo vượt". Màn Hàn / Sơn thì đã trừ lỗi đúng.
2. Câu lỗi in mã công đoạn ("đã báo UON 1180 đoạn ... vượt số đã cắt") và không nói phải làm gì; tin KCS lỗi chỉ ghi "KCS chấm lỗi 12".
3. Cột "Khả dụng" ở Tổng hợp vật tư không trừ phần sắt đã giữ cho lệnh: sắt đã giữ hết cho lệnh vẫn hiện khả dụng bằng tồn.
4. "Tổng hợp lệnh SX" báo "lệch bộ" và "cần hàn thêm" sai cho SKU có mảnh ×2 / ×4, vì FE không biết số mảnh / 1 bộ (BE chưa trả).

## Thay đổi

### 1. Báo bù sau KCS lỗi không còn bị coi là vượt
- `floor/floor-scan.service.ts` (màn quét QR máy cắt + máy công đoạn phụ): mỗi cỡ đoạn và mỗi `byOrder` trả
  `done` = **số được tính** = max(0, đã báo − lỗi KCS) (hàm `goodQty`), thêm `failed` (lỗi KCS) và `reportedQty` (số đã báo thô).
- `floor/floor-review.service.ts` `segmentProgress` (thẻ "chờ gửi KCS"): như trên; `over` tính trên số được tính. Đợt gắn SKU lấy lỗi của SKU, đợt cũ không gắn SKU lấy lỗi cả PI. Thiếu `failed` thì coi 0.
- KHÔNG đổi: `GET /steel-issues/:id/phoi-progress` vẫn trả `done` thô (bất biến từ 24/08); cảnh báo "đoạn báo vượt sắt đã nhận" (`steel.overMm`) giữ nguyên (cắt bù thật sự tốn thêm sắt; chờ nghiệp vụ).
- `steel-issues/dto/phoi-progress-response.dto.ts`: sửa chú thích `failed` (lỗi KCS cộng dồn, không còn `resolvedQty`).

### 2. Câu lỗi và tin KCS lỗi bằng lời thường (KHÔNG nới luật chặn nào)
- `common/constants/process-steps.constant.ts`: thêm `PROCESS_STEP_LABEL` + `processStepLabel()` (Cắt, Uốn, Dập, Đục lỗ, Tán, Tóp đầu, Xẻ, Nhấn); `common/utils/segment-code.util.ts` lấy nhãn từ đây.
- Câu lỗi in nhãn thay cho mã: `steel-issues.service.ts` (gán SKU đợt công đoạn, gửi KCS công đoạn, báo công đoạn, hủy báo cắt X3), `production-batches.service.ts` (công đoạn của mảnh), `material-yield-recipes/material-yield-recipe-production.service.ts` (công thức vật tư TP).
- Câu chặn báo công đoạn vượt số đã cắt: ghi rõ số đã báo gồm cả đoạn KCS chấm lỗi, và bảo **báo cắt thêm đúng phần vượt** (= đã báo + báo thêm − đã cắt) ở máy cắt trước. Câu chặn gán SKU in số mm thay cho mã cỡ đoạn.
- Tin `QC_FAILED` (`notification-types.ts`, `qc-reviews.service.ts`): thêm trường tuỳ chọn `detail` / `todo`, chỉ đợt Phôi truyền:
  - đợt cắt: "KCS chấm lỗi - Cắt <loại sắt + quy cách>: 12 đoạn 471mm lỗi" / "Báo công nhân cắt lại ... rồi quét mã máy cắt báo cắt bù; kiểm rồi gửi KCS";
  - đợt công đoạn phụ: "... - Uốn <loại sắt + quy cách>: 5 đoạn 355mm lỗi" / "Báo công nhân làm bù ...: nếu không còn đoạn đã cắt dư thì cắt thêm số đó ở máy cắt trước, rồi báo Uốn bù; kiểm rồi gửi KCS".
  - Hàn / Sơn / pat / vật tư TP giữ câu cũ. Người nhận không đổi (tổ + QLSX).

### 3. Khả dụng sắt trừ đúng giữ chỗ
Làm trên bản K5 (17/11, `7890d24`) đã gom giữ chỗ 1 lần cho mọi dòng (`getReservedQtyMap`) nhưng vẫn chỉ lấy ô chiều dài 0.
- `stock/stock-reservations.service.ts` `getReservedQtyMap`: bỏ lọc `stockLengthMm: 0`; giữ chỗ cắt sắt khoá theo (kho, vật tư, quy cách, **chiều dài cây**), giữ chỗ chuyển kho (không có chiều dài) khoá riêng. Thêm `reservedFor(map, kho, vật tư, quy cách, chiều dài)` = giữ chỗ cắt sắt cùng ô + giữ chỗ chuyển kho, đúng phép cộng của `getReservedQty()`. `reservedKey` thêm tham số chiều dài.
- `stock/stock-quant.service.ts` `toResponseDto`: trừ `reservedFor(..., row.stockLengthMm)` (trước đây luôn tra ô 0 nên giữ chỗ sắt ô 6000... không bao giờ bị trừ).
- Hệ quả khác (đúng nghĩa): giữ chỗ ô 0 của cùng vật tư không còn bị trừ lặp vào ô 6000. Giữ chỗ chuyển kho vẫn trừ vào mọi ô như cũ. Vật tư không theo chiều dài không đổi.
- `stock/dto/stock-quant-response.dto.ts`: sửa chú thích `availableQty`.

### 4. Số mảnh / 1 bộ trong kế hoạch mảnh
- `production-batches/dto/production-batch-plan-item-response.dto.ts`: thêm `qtyPerUnit` (`@Expose`) = `BomPiece.qtyPerUnit` của định mức lệnh đang ghim; bất biến `plannedQty = qtyPerUnit × số bộ`.
- `production-batches.service.ts` `getBatchPlan` / `getBatchPlanBatch` gán trường này (tự chảy tới `GET /production-orders/:id/production-batch-plan`, `.../production-batch-plan/batch`, `GET /floor/queue/:stage/detail/:piId`).

## Kiểm tra (17/11)
- Unit: toàn bộ BE qua (xem số ở báo cáo); thêm test cho từng mục trên (`floor-scan`, `floor-review-list`, `steel-issues`, `qc-reviews`, `notifications`, `stock-quant`, `production-batches`).
- Tích hợp (DB test): `stock-quant-available` (mới), `cut-bundle-race`, `giu-cho-theo-kho`, `reservation-own-pi`: 21/21.
- QA review độc lập + nghiệm thu trên app thử (bản sao dữ liệu 17/11): 10/11 tiêu chí đạt.

## Còn biết, chưa sửa
- **(Vừa)** Đoạn cắt THÊM để bù đoạn hỏng ở công đoạn phụ (Uốn / Dập...) vẫn bị máy cắt và thẻ QLSX gắn "vượt" theo đoạn, vì số được tính ở khâu cắt chỉ trừ lỗi KCS của khâu cắt. Chờ nghiệp vụ: đoạn công đoạn phụ bị KCS chấm lỗi là bỏ (phải cắt mới) hay làm lại trên chính đoạn đó. Có từ trước đợt này.
- Tin `QC_FAILED` và Hướng dẫn còn ghi "kiểm rồi gửi KCS": đổi khi làm phần "công nhân tự chuyển KCS" (quyết định 17/11).

## Lưu ý deploy
- Deploy BE một lần cho cả 4 mục (mục 1 và mục 2 phải lên cùng lúc: sau mục 1, màn Uốn / Dập hiện "còn N" và mời báo bù, câu chặn mục 2 mới nói rõ phải cắt thêm trước).
- FE chạy được với BE cũ (tự suy số mảnh / bộ) và BE mới chạy được với FE cũ (trường mới chỉ thêm).
- Báo xưởng: màn quét "Đã cắt / Đã uốn ..." nay là số đã trừ đoạn KCS chấm lỗi ("còn N" = phải làm bù); QLSX hết nhãn vượt giả khi bù; tin KCS lỗi ghi rõ lỗi ở đâu và phải làm gì; thủ kho thấy cột Khả dụng của sắt giảm đúng phần đã giữ cho lệnh.
