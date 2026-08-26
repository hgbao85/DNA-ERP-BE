# 2026-08-26 — Mở lại auto_scan cho ca không gộp được nữa

## Lý do

Sếp từng chốt bỏ `auto_scan` ngày 18/08 (xem lịch sử tại nơi gọi solver,
`cutting-proposals.service.ts`). Sếp chốt lại 26/08: **vẫn dùng** tính năng này, cụ thể:

> Nếu dùng gộp và tính ra được tối ưu rồi thì case này pass không liên quan. Nếu không có SKU nào
> để gộp (chỉ còn 1 SKU) hoặc gộp xong vẫn bị cảnh báo vượt 1% hao hụt, thì vẫn tiến hành cho vét
> cạn chiều dài cây sắt trong phạm vi 5000-6000mm.

Sau đó làm rõ thêm 2 điểm mở rộng phạm vi ban đầu:
- Chiều dài vét cạn (vd 5900mm) **phải chảy tới Mua hàng**, không chỉ nằm trong tính toán nội bộ.
- Đợt **GỘP** nhiều SKU mà tính xong vẫn trượt ngưỡng 1% thì **cũng** được vét cạn (không chỉ ca
  1 SKU đứng riêng).

## Vì sao an toàn khi bật lại

Đo thực tế trên PO-49 (Bàn J55 × 500) trước khi code: gọi thẳng solver với `auto_scan=true` —
2 loại sắt đã đạt ngưỡng trên 6000mm **giữ nguyên số y hệt** (solver ưu tiên chiều dài chuẩn đạt
ngưỡng trước, chỉ vét cạn khi KHÔNG chuẩn nào đạt — cơ chế có sẵn trong `de_xuat_logic.py`, không
phải code mới). Loại sắt thứ 3 (STL-VUONG-20X20, trước đó infeasible ở 6000mm, tốt nhất 1.86%) ra
5900mm, 72 cây, hao hụt 0.22%. Toàn bộ 3 loại sắt: 47 giây (ngân sách `timeoutSeconds` 1700s).

## Thay đổi

**BE:**
- `cutting-proposals.service.ts`: `auto_scan: true` (từ `false`) cho MỌI lần gọi solver — không
  cần cổng riêng theo "gộp hay không gộp": solver tự ưu tiên chiều dài chuẩn trước, chỉ vét cạn khi
  cần, nên bật chung cho cả 2 nhánh vẫn đúng ý Sếp.
- `prisma/schema.prisma`: `CuttingProposalLine.lengthSource String?` ("fixed" | "scan" | null) —
  phân biệt cây chuẩn với cây đặt riêng. `PurchaseProposalItem.stockLengthMm Int?` — chiều dài cây
  copy từ `CuttingProposalLine.bestStockLengthMm` lúc `approve()`, để Mua hàng biết đặt cây dài
  bao nhiêu (trước đây chỉ có `buyQty`, vô nghĩa nếu không biết chiều dài).
  Migration `20260826010000_cutting_length_source_and_purchase_stock_length`.
- DTO forward cả 2 field mới (`cutting-proposal-response.dto.ts`,
  `purchase-proposal-response.dto.ts`).

**FE:**
- Badge cảnh báo "⚠ cỡ đặt riêng Xmm — không phải cây chuẩn" ở: màn Admin "Cắt sắt" (danh sách +
  chi tiết), màn Phôi "Hướng dẫn cắt" (cả trên màn hình lẫn Excel/PDF xuất ra).
- "· cây Xmm" cạnh tên vật tư ở 3 màn Mua hàng: Lệnh mua NCC (`LenhMuaNCCPage.tsx`), So sánh giá
  Giám đốc (`BossApp.tsx`), Nhập kho (`NhapKhoPage.tsx`) — hiện cho MỌI vật tư sắt (kể cả cây
  chuẩn 6000mm), không chỉ ca đặt riêng, để luôn rõ ràng đặt cây dài bao nhiêu.

## Xác minh

- BE: `npx tsc --noEmit`, `npm test` (139/139 pass ở 2 module liên quan, thêm test `auto_scan=true`,
  `lengthSource` lưu đúng "fixed"/"scan"/null, `stockLengthMm` copy đúng vào `PurchaseProposalItem`).
- FE: `npx tsc --noEmit`, `npm run lint` (0 lỗi/warning mới), `npx vitest run` (44/44 pass),
  `npm run build`.
- Live-test qua chrome-devtools MCP trên **PO-49 thật** (đang "Cần xử lý" từ trước vì STL-VUONG-20X20
  vượt ngưỡng): bấm "Tính lại" ở Admin → solver chạy that với `auto_scan=true` → tự động chuyển
  **APPROVED** (trước đó bị chặn tự-duyệt). Đối chiếu DB: `lengthSource='scan'`,
  `bestStockLengthMm=5900` cho STL-VUONG-20X20; 2 dòng còn lại vẫn `lengthSource='fixed'`,
  `bestStockLengthMm=6000` y hệt trước khi bật lại (không đổi số của ca đã đạt).
  `PurchaseProposalItem.stockLengthMm` copy đúng (6000/6000/5900) cho cả 3 dòng đề xuất mua.
  Badge "⚠ đặt riêng" hiện đúng ở màn Admin "Cắt sắt". Màn Mua hàng (`muapsh`) hiện đúng
  "· cây 5900mm" / "· cây 6000mm" cạnh tên vật tư cho cả 3 dòng.

## Việc cần Sếp/Mua hàng biết

- Câu hỏi "NCC có bán/cắt được cây lẻ 5900mm không" là quyết định thương mại, hệ thống không tự
  quyết — Mua hàng thấy badge/nhãn "cây Xmm" thì tự cân nhắc đặt đúng cỡ đó hoặc trao đổi với NCC.
- Các phương án `CuttingProposal` tính TRƯỚC ngày này có `lengthSource=null` (cột chưa tồn tại) —
  không tự suy diễn "fixed" cho dữ liệu cũ, chỉ hiện trống. Không backfill vì không có nguồn dữ
  liệu để suy lại (solver không trả `length_source` trong request cũ đã lưu).
