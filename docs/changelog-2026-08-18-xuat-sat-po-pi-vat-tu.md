# Changelog 2026-08-18 — PO/PI thật + mảnh nhiều loại sắt + hướng gộp theo PI cho "Xuất sắt trong phôi"

> **CẬP NHẬT 2026-08-19: mục 2 (redesign gộp theo PI) đã CODE XONG VÀ SHIP** — phần dưới đây mô tả
> đúng trạng thái tại thời điểm 2026-08-18 (lúc còn "chưa code"), nay đã lỗi thời cho mục 2. Chi
> tiết đầy đủ (schema/service/FE đã đổi gì, và vì sao `WarehouseTransfersService.
> getPieceTransferPlan()` giờ chặn cứng `needsHan=false`) xem memory
> `project_steel_issue_pi_redesign_paused.md`. Giữ nguyên nội dung gốc bên dưới làm tài liệu tham
> khảo lịch sử (bối cảnh phát hiện vấn đề, các phương án đã cân nhắc).

> Tổng kết phiên làm việc, xuất phát từ câu hỏi "cột PO trên màn Phân phối nội bộ là gì" — dẫn tới
> 3 việc: (1) sửa cột PO/PI hiển thị đúng dữ liệu thật thay vì field tĩnh hay bỏ trống, (2) phát
> hiện + sửa 1 bug khiến "Xuất sắt trong phôi" gần như không dùng được cho SKU thật (mảnh dùng
> nhiều loại sắt bị âm thầm loại bỏ), (3) thiết kế lại hướng "gộp theo loại sắt cho cả 1 PI" —
> **dừng ở bước thiết kế**, chưa code, vì phát hiện quy mô thật đụng tới cả luồng Phôi/KCS.

Repo liên quan: `DNA-ERP-BE` (nhánh `main`), `DNA-ERP` (nhánh `demo`). Trạng thái commit tại thời
điểm viết changelog này: **chưa commit gì**. Mục 1 (PO/PI thật + đa vật tư) đã được commit ngay
sau đó (`sanxuat-stage-v20`); mục 2 (gộp theo PI) code ở phiên riêng ngày 2026-08-19, **chưa
commit** tính đến lúc cập nhật ghi chú này — kiểm tra `git status`/`git log` để biết trạng thái
mới nhất thay vì tin vào dòng này.

---

## 1. Đã code xong, đã test, an toàn dùng ngay

### 1.1. Cột PO/PI ở "Phân phối nội bộ" đọc từ `ProductionOrder` thật

**Vấn đề ban đầu:** cột "PO" đọc `PlanForm.salesOrderId` (gắn tay lúc tạo SKU, hoặc gắn khi Sales
chọn đúng SKU lúc tạo PO — xem mục 1.2) — field này **độc lập với việc SKU có thật sự được Sếp
duyệt sản xuất hay chưa**, nên "đã gắn PO" không có nghĩa "đã có lệnh sản xuất thật".

**Sửa:** PO/PI hiển thị giờ tra theo chuỗi thật `mfgProductId → ProductionOrder (Sếp đã duyệt) →
ProductionInvoiceItem → SalesOrder`, chỉ có giá trị SAU khi Sếp duyệt lệnh sản xuất — đúng lúc kho
mới có gì để làm.

| File | Thay đổi |
|---|---|
| BE `production-orders/production-orders.service.ts` + `dto/production-order-response.dto.ts` | Thêm `piCode`, `deliveryDeadline` vào response (include `productionInvoiceItem.{salesOrder.code, productionInvoice.code, deliveryDeadline}`) |
| FE `services/production-invoice-item.ts` | Thêm `buildProductionOrderInfoByMfgProduct()` — fetch `/production-orders?limit=100` 1 lần, map `mfgProductId → {poCode, piCode, deliveryDate}` |
| FE `XuatSatPage.tsx`, `XuatVatTuTieuHaoPage.tsx` | Cột PO/PI (list + header chi tiết) đọc từ map trên thay vì `Sku.exportOrder`/`Sku.piCode` |

Kèm sửa message trống "Chưa có mảnh nào cần xuất sắt" — phân biệt rõ 2 trường hợp: chưa có
`ProductionOrder` (chưa duyệt) vs. đã có nhưng BOM/định mức trống.

Test: `production-orders.service.spec.ts` 8/8 pass (2 case mới cho `piCode`/`deliveryDeadline`).

### 1.2. (Phụ, vẫn giữ nhưng không còn là nguồn hiển thị) `linkExistingSkus()`

Bản sửa đầu phiên: khi Sales tạo PO chọn đúng 1 SKU theo `mfgProductId` chưa gắn đơn hàng nào, tự
gắn `PlanForm.salesOrderId` + `productionInvoiceId` — file `sales-orders/sales-orders.service.ts`.
**Không rollback** (vô hại, giúp `resolveProductionInvoiceItemId()` có đường tắt qua
`pf.productionInvoiceId` thay vì luôn quét fallback theo `mfgProductId`), nhưng **không còn quyết
định cột PO/PI hiển thị** — xem mục 1.1. Test: `sales-orders.service.spec.ts` 10/10 pass.

### 1.3. "Xuất sắt trong phôi" hỗ trợ mảnh dùng nhiều loại sắt (bug quan trọng)

**Bug phát hiện:** debug SKU "Ghế J55" (đã duyệt, có PO/PI thật, BOM đủ 5 mảnh/33 dòng sắt) vẫn
hiện trống trơn. Đào DB thật (script Prisma read-only, xoá sau khi dùng) phát hiện: **mọi mảnh đều
dùng nhiều loại sắt khác nhau** (vd "Khung tựa" dùng 6 loại). `SteelIssuesService.getIssuePlan()`
có giả định cứng "1 mảnh chỉ dùng đúng 1 loại sắt" — mảnh vi phạm bị **âm thầm loại khỏi kế
hoạch**, không báo lỗi. Vì hầu hết sản phẩm thật đều ghép nhiều loại sắt/mảnh, tính năng gần như
không dùng được cho dữ liệu thật trước khi sửa.

| File | Thay đổi |
|---|---|
| BE `steel-issues/steel-issues.service.ts` | `getIssuePlan()`: nhóm `pieceBom` theo `(pieceId, materialId)`, sinh **1 dòng kế hoạch/loại sắt** thay vì loại bỏ cả mảnh. `resolveRequiredSteps()` lọc thêm theo `materialId` (mỗi loại sắt trong mảnh có công đoạn phôi riêng). `resolveMaterialForPiece()` → đổi thành `assertMaterialBelongsToPiece()` (chỉ xác thực, không tự suy) |
| BE `dto/create-steel-issue.dto.ts` | `materialId` giờ **bắt buộc** — client tự chọn loại sắt khi xuất |
| FE `XuatSatPage.tsx` | Mọi state (ô nhập, nút Xuất, lịch sử) đổi khoá từ `pieceId` sang `${pieceId}:${materialId}` |
| FE `services/steel-issues-api.ts` | `issueSteel()` gửi kèm `materialId` |

Test: `steel-issues.service.spec.ts` 31/31 pass (4 case mới: multi-material create + plan).

### 1.4. UI `XuatSatPage.tsx` — gộp hiển thị theo mảnh, ô "dài (mm)" mặc định 6000mm

- Gộp các dòng vật tư theo **mảnh** (1 card/mảnh, bảng con liệt kê từng loại sắt) — bước trung
  gian, **KHÔNG PHẢI** hướng cuối cùng (xem mục 2, user đã đổi ý sang gộp theo cả PI).
- Ô "dài (mm)" mặc định cứng **6000mm** (chốt cuối phiên — đã bỏ hướng lấy `bestStockLengthMm` từ
  phương án cắt vì quá phức tạp so với lợi ích, số đó cũng không đại diện chung khi 1 vật tư dùng
  ở nhiều sản phẩm/phương án cắt khác nhau trong cùng 1 PI).

Đã `npx tsc --noEmit` + `npx eslint` sạch (BE + FE) sau toàn bộ mục 1.

---

## 2. Đã bàn kỹ, **CHƯA CODE** — việc cần làm tiếp

### 2.1. Quyết định đã chốt với user

- Nút "Xuất" sẽ hỏi **loại sắt + tổng số cây** — **KHÔNG** hỏi sản phẩm/mảnh nào cả. Bên Phôi tự
  phân bổ vật lý theo đề xuất phần mềm, hệ thống không cần biết trước "cây này cho mảnh nào".
  Ô "dài (mm)" mặc định 6000mm (đã code, xem mục 1.4).
- Kế hoạch/nút xuất gộp theo **loại sắt cho CẢ 1 PI** (không phải theo 1 mảnh/1 SKU) — vì phần
  mềm đề xuất mua/cắt sắt vốn đã tính gộp ở cấp PI, và 1 PI có thể có nhiều SKU/sản phẩm khác nhau
  (xem memory `project_pi_multi_sku_multi_po`).
- Danh sách ngoài (trước khi bấm vào xem chi tiết) đổi hẳn sang **liệt kê theo PI** (không phải
  theo SKU như hiện tại).

### 2.2. Phát hiện quan trọng khi thiết kế — lý do dừng lại

> **CẬP NHẬT 2026-08-21:** giả định "không có needsHan=false nào tồn tại thật" (và quyết định
> rollback ở phiên 2026-08-19 dựa trên giả định đó) đã SAI — xác nhận với user: có ít nhất 1 loại
> vật tư thành phẩm thật (chân nhôm). Đã xử lý bằng hướng KHÁC với 3 hướng bàn ở mục 2.2 gốc dưới
> đây (không đảo ngược redesign gộp-PI) — xem
> `changelog-2026-08-21-vat-tu-thanh-pham-needshan-false.md`.

`SegmentSpec` (vật tư + chiều dài cắt, `@@unique([materialId, cutLengthMm])`) là khái niệm **dùng
chung toàn hệ thống**, không thuộc riêng 1 mảnh — 2 mảnh khác nhau (thậm chí khác sản phẩm) có thể
cùng tham chiếu 1 `SegmentSpec` nếu cần cùng vật tư + cùng chiều dài cắt. Hệ quả: **ngay cả sau khi
Phôi báo cắt xong, hệ thống cũng không tự suy được "đoạn này của mảnh nào"** chỉ từ dữ liệu cắt
(`segmentSpecId`) — khớp đúng tinh thần "Phôi tự làm đúng, hệ thống không cần biết" mà user muốn,
nhưng có nghĩa: nếu bỏ hẳn việc gắn `SteelIssue` vào 1 mảnh cụ thể, phải bỏ luôn khái niệm "theo
dõi theo mảnh" **xuyên suốt** chuỗi Xuất → Nhận → Báo cắt xong → KCS duyệt/chấm phế → Cấp bù, không
chỉ riêng bước xuất kho.

Việc cần sửa nếu làm trọn vẹn (đã liệt kê nhưng **chưa động vào file nào** ở mục này):

| Lớp | Thay đổi cần làm |
|---|---|
| Schema (`prisma/schema.prisma`) | `SteelIssue.productionOrderId` → đổi thành `productionInvoiceId`; `SteelIssue.pieceId` → **bỏ hẳn**. Cần viết migration mới |
| BE `steel-issues/steel-issues.service.ts` | Sửa toàn bộ (`create`, `getIssuePlan` → đổi thành gộp theo PI, `resolveRequiredSteps` → tính theo vật tư+PI thay vì theo mảnh, `completeCutting`/`completeStep`) |
| BE `qc-reviews/qc-reviews.service.ts` | **Chưa đọc kỹ trong phiên này** — duyệt/chấm phế và luồng cấp bù (`ReplenishRequest`) hiện đối chiếu "cùng mảnh + cùng loại sắt với đợt gốc" (xem test `qc-reviews.service.spec.ts` — "ném BadRequestException nếu đợt cấp bù khác mảnh/loại sắt với đợt gốc") → phải bỏ điều kiện theo mảnh, chỉ còn theo vật tư |
| FE — 2 màn **chưa xem trong phiên này** | `XacNhanSanLuongPage.tsx` (Phôi nhận/báo cắt xong) và màn KCS duyệt sắt (nhiều khả năng `KcsPhoiPage.tsx` hoặc tương tự) — nhiều khả năng đang hiển thị/thao tác theo từng mảnh, cần audit kỹ trước khi sửa |
| FE `XuatSatPage.tsx` | Đổi hẳn: danh sách ngoài theo PI, kế hoạch gộp theo vật tư (không breakdown theo mảnh nữa vì `issuedBarCount` cũng không còn theo dõi được ở cấp mảnh), nút Xuất chỉ hỏi (vật tư, tổng số cây) |
| FE `services/steel-issues-api.ts` | Bỏ các hàm theo `Sku`/`productionOrderId` hiện tại, thêm hàm theo `productionInvoiceId` |

### 2.3. Việc cần làm khi tiếp tục — checklist gợi ý

1. Quyết định trước: làm trọn vẹn cả chuỗi Phôi/KCS luôn, hay tách giai đoạn (đợt sau mới đụng
   Phôi/KCS)? User dừng phiên này đúng ở chỗ chưa chọn.
2. Nếu làm trọn vẹn: đọc kỹ `XacNhanSanLuongPage.tsx`, màn KCS liên quan, và
   `qc-reviews.service.ts` (+ test) để biết chính xác UX/hợp đồng hiện tại trước khi sửa — **chưa
   đọc gì trong phiên này**, đừng giả định.
3. Viết migration Prisma cho `SteelIssue` (bỏ `pieceId`, đổi `productionOrderId` →
   `productionInvoiceId`) — cân nhắc dữ liệu cũ (nếu môi trường có `SteelIssue` đã tồn tại,
   migration cần xử lý backfill hoặc chấp nhận mất field cũ theo đúng quy ước dev/test hiện tại
   của repo).
4. Sửa BE + FE theo bảng ở mục 2.2, viết test mới cho toàn bộ luồng đổi.
5. **Đừng** làm lại hướng lấy `bestStockLengthMm` từ phương án cắt cho ô "dài (mm)" — đã bị bỏ,
   user muốn mặc định cứng 6000mm (mục 1.4).

---

## 3. Ghi chú kỹ thuật đã lưu vào memory (còn hiệu lực, tham khảo khi tiếp tục)

- `project_po_pi_link_sku.md` — cột PO/PI đọc từ `ProductionOrder` thật (mục 1.1)
- `project_steel_issue_multi_material.md` — bug mảnh nhiều loại sắt (mục 1.3)

2 file trên nằm ở `C:\Users\DELL\.claude\projects\d--DNA-ERP\memory\` (memory riêng của phiên
Claude Code, không phải trong repo).
