# 2026-08-26 (tiếp) — Backfill lengthSource/stockLengthMm cho dữ liệu cũ

## Lý do

Sau khi mở lại `auto_scan` (xem `changelog-2026-08-26-mo-lai-auto-scan-cho-ca-khong-gop-duoc.md`),
review lại phát hiện: **dữ liệu tính TRƯỚC ngày 26/08 có thể backfill được `lengthSource`, khác
với suy đoán ban đầu.**

Changelog trước ghi "không backfill vì solver không trả `length_source` trong request cũ" —
**sai**. Kiểm tra trực tiếp `CuttingProposal.rawResponse` (JSON gốc solver trả, lưu nguyên văn từ
lâu) của các phương án cũ nhất hệ thống (proposal id=2, tính 2026-08-11) cho thấy solver **luôn**
gửi `length_source` — code cũ chỉ đơn giản không đọc field đó ra cột riêng, không phải solver
thiếu dữ liệu.

**Phát hiện rủi ro thật khi review**: `PurchaseProposalItem` của PO-1 (id đề xuất mua = 4, trạng
thái **PURCHASING** - Mua hàng đang xử lý dở) thực ra cần đặt cây **5600mm** (đã cắt được, không
phải cây chuẩn 6000mm) từ tận 2026-08-11, nhưng màn Mua hàng không hiện gì vì `stockLengthMm`
chưa từng tồn tại lúc đó. Nếu không vá, Mua hàng có thể đặt nhầm cây 6000mm cho đơn đang mua dở.

## Thay đổi

- `prisma/backfill-length-source.ts` (script chạy 1 lần, `npm run backfill:length-source`):
  - **`lengthSource`**: đọc lại `CuttingProposal.rawResponse.purchase_plan[].length_source` theo
    từng `CuttingProposalLine` còn NULL, khớp qua `materialId`. Không gọi lại solver, không suy
    diễn - chỉ đọc lại đúng nguyên văn dữ liệu đã lưu.
  - **`stockLengthMm`**: copy từ `CuttingProposalLine.bestStockLengthMm` tương ứng (join qua
    `PurchaseProposal.cuttingProposalId` + `materialId`) cho mọi `PurchaseProposalItem` còn NULL.

## Kết quả chạy

- `lengthSource`: 16/16 dòng lấp được (100% - rawResponse luôn có field này cho dòng feasible).
- `stockLengthMm`: 12/34 dòng lấp được; 22 dòng còn lại **đúng là không có gì để lấp** - toàn bộ
  đều là nhánh kiểm tra vật tư (`InspectionKhoResultItem`, không có `cuttingProposalId`), không
  có khái niệm chiều dài cây, kiểm tra thủ công từng dòng xác nhận không sót ca nào liên quan sắt.
- Trong 12 dòng lấp được có **4 đề xuất mua đang hoạt động thật** (1 PURCHASING + 3 NEW) - đã xác
  nhận số lấp vào khớp 100% với chiều dài thật lưu ở `CuttingProposalLine.bestStockLengthMm`.

## Xác minh

- Live-test qua chrome-devtools MCP: mở lại PO-1 (phương án cũ nhất, tính 2026-08-11) ở màn Admin
  "Cắt sắt" → badge "⚠ đặt riêng" giờ hiện đúng ở 5600mm (trước backfill: trống trơn, không có
  cảnh báo gì dù đây là cây đặt riêng thật).
- BE: `npx tsc --noEmit`, `npm test` ở 2 module liên quan vẫn 139/139 pass (script backfill không
  đụng code nghiệp vụ, chỉ chạy 1 lần độc lập).
- Không đụng solver, không đụng trạng thái/tồn kho/mua hàng - chỉ ghi 2 cột đang NULL bằng dữ liệu
  đã có sẵn từ trước. Chạy lại script nhiều lần vô hại (chỉ đụng dòng còn NULL).
