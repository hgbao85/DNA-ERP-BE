# Changelog 2026-09-30 — Review: đưa Solve lên cho KHSX tính trước, QLSX/Sếp chỉ duyệt kết quả

> Trạng thái: **"Bước 2" (Solve trước → tạo PI) ĐÃ LÀM + LIVE-TEST — xem
> `changelog-2026-09-30-solve-truoc-tao-pi.md`.** Mục 3-5 dưới đây là lịch sử đánh giá; 3 câu hỏi ở mục 5
> đã chốt: giữ nguyên chức năng màn Tối ưu cắt sắt, mỗi PI = 1 phương án tính trước, làm thẳng Bước 2. Việc "cho KHSX
> tự nhập % hao hụt mặc định" (đã chọn phương án: sửa riêng ô % + ghi lịch sử + báo Sếp) **TẠM DỪNG**
> theo yêu cầu người dùng, chưa viết dòng code nào — xem mục 6.

## 1. Yêu cầu

Người dùng: *"tôi muốn đưa solve lên trước cho KHSX thao tác tính luôn rồi chỉ ném cái data đó qua
cho QLSX với BOSS duyệt là xong và để KHSX có thể xem tiến độ solve giống admin"*.

## 2. Luồng hiện tại (đọc từ code)

1. KHSX ở "Tối ưu cắt sắt" (`GomDotCatPage.tsx`) chỉ thấy **số ƯỚC TÍNH** (best-fill DP, và thử
   solver 5s cho loại ít cỡ đoạn) → gộp/cắt riêng → tạo PI → gửi QLSX → QLSX gửi Sếp.
2. Sếp duyệt (`ProductionInvoicesService.approveItem/approveBatch`) → tạo ProductionOrder (ghim BOM
   ACTIVE lúc đó) → **lúc này solver mới chạy** (`requestForOrder`/`requestForInvoice`, chạy nền,
   hàng đợi FIFO trong bộ nhớ).
3. Tính xong → `autoApproveBlockReason()` → tự `approve()` (giữ chỗ tồn + tạo đề xuất mua). Bị chặn
   (vô nghiệm / hết giờ / vượt ngưỡng không có đặc cách) thì phương án nằm DRAFT/FAILED, và từ
   2026-09-26 **không còn thông báo nào** cho các nhánh này (không có màn nào để xử lý).
4. Tiến độ chỉ xem được ở Admin > Dữ liệu nghiệp vụ > Đề xuất cắt sắt (`CuttingProposalsPage.tsx`):
   trạng thái "Đang tính" + thời gian đã chạy + danh sách loại sắt sẽ giải, tự tải lại 20s. Không có
   tiến độ theo từng loại sắt (solver trả về 1 lần duy nhất).

## 3. Đánh giá

**Nên làm — tốt hơn hiện tại, khả thi**, vì:
- Sếp duyệt trên **số thật** (số cây, % hao hụt, chiều dài cây), không phải số ước tính;
  `solverOverrideEvidence` của đặc cách cũng thành số thật.
- Vô nghiệm/hết giờ lộ ra **ngay ở KHSX**, người có quyền chỉnh (gộp khác, cây riêng, đặc cách) —
  lấp đúng lỗ "tính hỏng sau khi Sếp duyệt mà không ai thấy" ở mục 2.3.
- Kết quả solver trước khi duyệt **không đụng tiền/kho** (giữ chỗ + đề xuất mua chỉ xảy ra ở
  `approve()`), nên từ chối ở QLSX/Sếp chỉ cần bỏ phương án, không có gì phải hoàn tác. Tồn kho cũng
  không phải đầu vào của solver → để lâu trước khi duyệt không làm sai số cây; phần trừ tồn vẫn tính
  lúc Sếp duyệt như cũ.

**Rủi ro / việc phải làm cho đúng:**
1. **Neo phương án**: `CuttingProposal` hiện neo `productionOrderId` (PO chỉ sinh ra khi Sếp duyệt)
   hoặc `productionInvoiceId` (chỉ PI gộp). Tính trước duyệt cần neo vào PI (hoặc PI item cho PI
   thường nhiều SKU) — đổi schema.
2. **Ghim BOM lúc tính**, không phải lúc Sếp duyệt: nếu BOM/số lượng/SKU đổi sau khi tính thì phương
   án phải bị đánh "lỗi thời", chặn gửi/duyệt cho tới khi tính lại. PO tạo lúc duyệt phải dùng đúng
   revision đã ghim.
3. **Bỏ tự-duyệt sau khi tính**: Sếp duyệt PI = `approve()` phương án có sẵn, không gọi solver lại.
   Các cổng của `autoApproveBlockReason()` chuyển thành cổng **"được gửi QLSX"**.
4. **Tải solver**: KHSX có thể bấm tính nhiều lần; solver 1 hàng đợi, mỗi lượt có thể vài phút → chỉ
   1 lượt đang chạy/PI, lượt mới thay lượt cũ; phần thử-sai nhanh vẫn dùng số ước tính sẵn có.
5. **Đụng đường tiền** (`approve()`/`approveItem`/`approveBatch`) → cần test kỹ + live-test lại toàn
   chuỗi Sếp duyệt → mua hàng.
6. Quyền: KHSX đã có `CUTTING_PROPOSAL:VIEW` (xem tiến độ được ngay); cần thêm `CREATE` để tự bấm
   tính.

## 4. Đề xuất chia 2 bước

- **Bước 1 (nhỏ, an toàn):** cho KHSX xem màn tiến độ/kết quả giống Admin (lọc theo PI của mình) —
  chỉ FE + tái dùng API sẵn có. Giải quyết ngay nhu cầu "xem tiến độ", chưa đổi luồng duyệt.
- **Bước 2 (chính):** chuyển solve lên trước duyệt theo mục 3.

## 5. Chờ người dùng chốt

1. PI thường có nhiều SKU (không gộp): vẫn tính riêng từng SKU và Sếp duyệt lẻ từng SKU như hiện
   tại, hay coi cả PI là 1 lần tính / 1 lần duyệt?
2. Bị QLSX/Sếp từ chối: KHSX sửa rồi tính lại từ đầu — có cần giữ lịch sử các lần tính cũ để so sánh?
3. Làm Bước 1 trước rồi mới Bước 2, hay làm thẳng Bước 2?

## 6. Đính chính trong phiên + việc tạm dừng

- Đính chính: câu trả lời trước trong phiên nói "Admin sửa % mặc định ở Cấu hình hệ thống" là **SAI**.
  `SystemConfigPage.tsx` chỉ có thông tin công ty; `solverMaxWastePercentage` (và các tham số solver
  khác) hiện **không có màn nào sửa được** — chỉ qua API `PUT /system-config` hoặc DB.
- Việc "KHSX tự nhập % mặc định": đã khảo sát xong (quyền theo module, `SystemConfig` chưa nằm
  trong `AUDITED_MODELS` nên đổi cấu hình hiện không để lại lịch sử, thông báo qua
  `NotificationsService.emit`). Tạm dừng theo yêu cầu người dùng; nếu làm Bước 2 ở trên thì ô % này
  nên đặt luôn trong màn tính của KHSX.
