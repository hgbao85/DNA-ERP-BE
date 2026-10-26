# Changelog 2026-10-02 — Kế hoạch dùng AI tổng hợp báo cáo từ nhóm Zalo vào ERP

> Trạng thái: **CHỈ LÀ KẾ HOẠCH, CHƯA CODE.** Chờ Ban giám đốc duyệt và chốt các quyết định ở mục 4.

## 1. Bối cảnh
Sếp muốn có AI phụ trách: hằng ngày vào nhóm Zalo được chỉ định, lấy dữ liệu trong ngày, tổng hợp và cập nhật vào ERP production.
Đã trao đổi các phương án lấy tin Zalo: Zalo OA (kênh chính thức), bot không chính thức (`zca-js`, npm 2.2.0, cập nhật 09/09/2026 — README
ghi chỉ 1 phiên nghe tin web/tài khoản, mở Zalo web là bot dừng), tự động hoá Zalo PC, và Cowork đọc qua ảnh chụp màn hình khi được gọi.
Người dùng chọn hướng bot không chính thức; Cowork đề xuất chia việc (Cowork đọc Zalo, ERP có endpoint nhận dữ liệu).

## 2. Đánh giá đề xuất của Cowork (đã trả lời người dùng)
Đồng ý: duyệt trước khi ghi, chống trùng, chế độ thử (dry-run), API key riêng, kiểm tra mã theo danh mục. Cần chỉnh:
- `zalo-import` CHỈ ghi bảng nháp; duyệt xong mới gọi đúng service nghiệp vụ hiện có (đợt Phôi/Hàn/Sơn qua KCS, nhận hàng theo đề xuất mua,
  xuất sắt theo lệnh...) dưới tên người duyệt — không mở đường ghi tắt vào bảng.
- Một lần duyệt, trong ERP, đúng vai trò (QLSX: sản lượng; thủ kho: kho) — không duyệt 2 lần (Cowork xem trước + ERP chờ duyệt).
- Chưa làm loại "đơn hàng" ở giai đoạn đầu (cần khách, mã PO, hạn giao, SKU đã duyệt).
- API là BE trên Render, không phải Vercel. Khoá chống trùng cần thêm hash nội dung + thứ tự dòng, không chỉ (nhóm, giờ, người gửi).
- Cách của Cowork là "khi được gọi", đọc qua ảnh chụp màn hình — không tự động hằng ngày.

## 3. Tài liệu trình sếp
Trang kế hoạch cho người không chuyên kỹ thuật (artifact riêng tư, cần Share mới người khác mở được):
https://claude.ai/artifact/WejBSrdukMTxcbZFMdupb8 — gồm: tóm tắt 1 phút, luồng 6 bước (có bước người duyệt), nguyên tắc an toàn,
báo cáo thực tế (bảng theo dõi sắt, xem mục 5), lộ trình 5 giai đoạn (~4–6 tuần tới khi chạy chính thức loại báo cáo đầu tiên, có 2 tuần chạy song song),
rủi ro/cách xử lý, phân vai, phương án thay thế, và 5 việc cần Ban giám đốc quyết.

## 4. Việc chờ quyết (chưa làm)
1. Nhóm Zalo và loại báo cáo làm trước (đề xuất: sản lượng công đoạn Phôi/Hàn/Sơn).
2. Người duyệt bản nháp. 3. Chấp nhận cách đọc Zalo không chính thức với tài khoản riêng. 4. Gửi file Excel thay ảnh + giữ cố định mẫu bảng (đổi từ "mẫu tin nhắn" sau mục 5). 5. Chi phí vận hành.
Đã có mẫu báo cáo thật (mục 5); còn cần: 1-2 file Excel gốc để thử đọc, và bảng đối chiếu tên gọi. Thời gian và chi phí trong tài liệu là ƯỚC TÍNH, chốt sau giai đoạn thử đọc Zalo.

## 5. Cập nhật sau khi xem báo cáo thật (6 ảnh "Bảng theo dõi sắt thành phẩm", LSX 157–163)
- Báo cáo thật KHÔNG phải tin nhắn ngắn mà là ảnh chụp bảng Excel theo từng LSX: mỗi dòng = 1 đoạn sắt của 1 bộ phận (mã I3.1.1.1 / JSE 55.1.1.1,
  tên sắt viết tắt kèm công đoạn "H10-20 (uốn- 1 dập)", kích thước cm (I3) hoặc mm (J55), số đoạn, số ghế/bàn, SL cần cắt, máy cắt LS/TD/LSB),
  số đã cắt theo ngày × ca sáng/chiều, cộng dồn, còn lại; các khối DẬP / KHOAN / TÁN / UỐN cùng dạng.
- Hệ quả cho thiết kế: (1) nên yêu cầu gửi FILE Excel thay ảnh — đọc file chính xác tuyệt đối, đọc ảnh bảng dày số dễ sai; (2) bảng là CỘNG DỒN →
  phải so với bảng hôm trước để lấy phần mới làm thêm theo ngày/ca, chống ghi trùng; (3) cần bảng đối chiếu: số LSX ↔ lệnh trong ERP, tên sắt viết tắt
  ↔ mã vật tư (H10-20 ↔ SAT-HOP-10X20, V15, FI19...), cm/mm, mã bộ phận ↔ mảnh; (4) công đoạn: ERP có CAT/UON/DAP/DUC_LO/TAN/TOP_DAU/XE —
  "KHOAN" (có thể = DUC_LO?) và "nhấn" chưa có, cần hỏi xưởng; (5) dữ liệu bảng có lỗi/không nhất quán (dòng "còn lại" âm, header "năm 2024",
  mã "I1.1.2" lẫn "I3.1.2") → cần kiểm tra và đưa dòng nghi ngờ cho người duyệt.
- ERP đã theo dõi đúng loại số này ở màn QLSX "Tiến độ Phôi theo loại sắt" (Cắt/Uốn/Dập/Tán theo cỡ đoạn) → đích ghi là báo cắt/báo công đoạn Phôi.
- Đã sửa trang kế hoạch (version 2, cùng URL): thay mục "quy ước tin nhắn" bằng mục báo cáo thực tế, cập nhật bước 1/3, rủi ro, lộ trình, quyết định.

## 6. Review lịch sử trao đổi anh Nhân – Claude (4/10 → 10/10/2026) và đối chiếu với ERP hiện tại (2026-10-10)
> Trạng thái: **CHỈ REVIEW, CHƯA SỬA CODE.** Nguồn: `LICH_SU_TRAO_DOI_CLAUDE_den_10-10-2026.md` (12.519 dòng, 333 tin anh Nhân).
> Đối chiếu với `prisma/schema.prisma`, `cutting-proposals`, `production-invoices`, `purchase-proposals`, `weaving-*`.

**Bối cảnh rút ra:** cả tuần, việc điều hành (tiến độ xưởng, kế hoạch LSX, cắt sắt, đề xuất mua, booking) chạy hoàn toàn bằng
Zalo + Excel + một phiên Claude trên máy anh Nhân. Log không nhắc ERP lần nào. Nhiều lỗi trong log đến từ việc trộn nhiều nguồn
(file chị Ngân, chị Nhớ, Thảo Trinh, nhóm Tiến Độ Tổng chưa quét) và tự đoán (LSX308 vs 312, màu dây, logo Patiojoy, "N8").

### 6.1 Quy tắc nghiệp vụ anh Nhân đã chốt trong log (bản cuối)
- **Lịch LSX theo ngày N (bắt đầu phôi):** Phú An 1 lệnh/ngày; Phước An cách 3 ngày. Phú An: VT nhóm 1–2 (sắt, dây đan, đinh, nút…)
  về hết N−1 (sớm nhất N−5); phôi/xuất đan xong N+2; VT còn lại về hết N+8; thu mảnh N+9→N+12; chuyền kiểm N+12; đóng gói N+14.
  Phước An = Phú An +2 (N+4, N+10, N+11→N+14, N+14, N+16). Không cho VT về sớm quá 4 ngày (kho chật). MY-324/325 (sofa): +10 ngày từ VT còn lại trở đi.
- **Hàng gỗ (I37/I38/I56/I57):** G = hạn giao − 9; VT đóng gói G−3; đóng gói G+2; số cont/tháng ≤ "số cont yêu cầu chuẩn bị" (bảng Ba Chinh).
- **Tách xưởng:** 1 LSX có thể chia bàn ở Phú An, ghế ở Phước An (GP-180/181, 188–192, 198/199, 209–213, 220–223); phần ghế không bắt đầu trước phần bàn.
- **Cắt sắt:** mỗi quy cách 1 chiều dài cây chung cho mọi lệnh và cả 2 xưởng; tròn đuôi 0/5 cm; tối đa 6,5 m; mỗi kiểu cắt hao < 1%
  (nhát cưa không tính hao, tề đầu 10 mm có tính); nhiều kiểu cắt được nhưng ít nhất; gộp tối đa **2** lệnh (đổi từ 3), cùng xưởng, cùng quy cách,
  ưu tiên hạn giao gần nhau (riêng 20×20 cho gộp bàn I3 mới với bàn J55); đoạn dư chuyển nhóm sau, cây cuối cắt vừa đủ, phần còn lại giữ nguyên thanh nhập kho.
  kg/m lấy theo phiếu so sánh giá của chị Nhàn, không theo công thức lý thuyết.
- **Đề xuất mua:** hao hụt sắt ống/hộp theo file cắt; la tấm/pass/thép dây 1%; bì zipper 1%; dây đan/dây hàn/CO2/nhãn số/HDLR/poster 0%;
  còn lại 1,5%. La tấm làm tròn tới 0,1 tấm. Màu dây theo đơn khách (ô tiếng Việt), không theo định mức. Phải trừ tồn và loại lệnh đã có đề xuất. Chia file theo 3 người mua.
- **Báo cáo:** phân biệt rõ "nhập kho (thu mảnh về)" và "chuyền kiểm"; booking phải ghi thiếu bao nhiêu, ở công đoạn nào, mảnh nào ở điểm đan nào.

### 6.2 Đối chiếu với ERP
| Nhu cầu trong log | ERP hiện tại | Đánh giá |
|---|---|---|
| Mốc kế hoạch theo N, tự tính | `ProductionInvoiceItemStage` (FRAME, FRAME_PHOI/HAN/SON, WEAVING, TRANSFER_CHECK, PACKAGING) + `materialDeadline`/`deliveryDeadline` — **nhập tay**, không có ngày N, không có mốc "VT còn lại" | THIẾU: không có ngày bắt đầu phôi và công thức mốc theo xưởng |
| Xưởng cơ khí Phú An / Phước An, tách bàn–ghế | Không có khái niệm xưởng. `warehouseCode` trên PI item là kho **thành phẩm/đóng gói**, không phải xưởng cơ khí | THIẾU — anh Nhân dùng 2 cột riêng "xưởng chính" và "kho đóng gói" (8/10) |
| Hàng gỗ (không phôi/đan) | Luồng LSX giả định có phôi sắt | THIẾU luồng riêng |
| 1 chiều dài/quy cách cho **mọi** lệnh | `solverStockLengthsByMaterial` ở **từng PI (đợt)** — quyết định 2026-09-16 cố ý KHÔNG đặt ở Material | **MÂU THUẪN** với ràng buộc anh Nhân chốt 8/10 → cần anh Nhân/KHSX quyết lại |
| Dải chiều dài 5–6,5 m, tròn 0/5 cm | `solverMinLengthMm=5000`, `solverMaxLengthMm=6000`, `solverLengthStepMm=10` (mặc định) | LỆCH: max 6000 vs 6500; bước 10 mm vs 50 mm (chỉ là cấu hình, chỉnh qua SystemConfig) |
| Hao < 1%, nhát cưa không tính hao, tề đầu tính | `solverMaxWastePercentage=1`, `trim=10`, kerf tính là "sắt đã dùng" (best-fill.util) | KHỚP (nhát cưa log dùng 3 mm, ERP mặc định 1 mm — cần xác nhận) |
| Gộp tối đa 2 lệnh, cùng xưởng | PI gộp (`isMerged`) không giới hạn số SKU, không biết xưởng | THIẾU ràng buộc |
| Đoạn dư chuyển lệnh sau / giữ thanh dài vào kho | Memory: đoạn dư để dưới xưởng, thủ kho tự nhập; `StockQuant.stockLengthMm` có thể giữ thanh dài | CẦN CHỐT: quy tắc mới trong log khác cách ERP đang giả định |
| kg/m theo phiếu so giá | `Material` không có trường kg/m | THIẾU (nếu cần báo kg khi mua sắt) |
| Hao hụt mua theo nhóm vật tư | `Material.purchaseWastePercentage` theo từng vật tư; `MaterialGroup` không có % mặc định | KHỚP về chức năng; cần nạp đúng bảng 0/1/1,5% |
| Hạn về vật tư trên đề xuất mua (N−1, N+8, không sớm quá 4 ngày) | `PurchaseProposal` không có ngày cần hàng | THIẾU |
| Chia đề xuất theo người mua | `Material.buyerId` | KHỚP |
| Trừ tồn, loại lệnh đã đề xuất | `actualStock` trên item; đề xuất sinh từ PI nên không trùng | KHỚP nếu mọi đề xuất đi qua ERP |
| Màu dây theo đơn khách | `ProductVariant.colorCode` + `customerId` | KHỚP một phần (định mức dây cần theo variant) |
| Mảnh nào ở điểm đan nào | `WeavingIssue`/`WeavingReceipt` theo LSX × mảnh × điểm đan | KHỚP — trả lời được ngay nếu xưởng nhập liệu |
| Nhập kho vs chuyền kiểm | `WeavingReceipt` (thu mảnh) tách với `TransferCheckResult` (chuyền kiểm) | KHỚP — ERP đã tách đúng chỗ log bị nhầm |
| Booking / cont (số booking, ngày lấy cont, cut-off, ETD) ↔ LSX, bù hàng giữa lệnh | Không có model Booking; chỉ `SalesOrderItem.shippedQty` + `PackagingRecord.boxesPacked` | THIẾU — đây là việc anh Nhân hỏi nhiều nhất 9–10/10 |
| Tồn thành phẩm theo khách | `StockQuant.productVariantId` (kho thành phẩm) | KHỚP |

### 6.3 Đề xuất thứ tự (chưa làm, chờ quyết)
1. Chốt mâu thuẫn chiều dài cây: theo quy cách toàn công ty (Material) hay theo đợt (PI) như 2026-09-16.
2. Thêm trường xưởng cơ khí cho LSX (tách bàn/ghế) + ngày N, tự sinh mốc theo bảng 6.1 (vẫn cho sửa tay).
3. Model Booking/cont gắn với LSX/PI item, ghi nhận bù hàng giữa lệnh.
4. Ngày cần hàng trên đề xuất mua, suy từ N.
5. Cấu hình SystemConfig: max 6500, bước 50 mm (sau khi KHSX xác nhận); ràng buộc gộp tối đa 2 lệnh.

Kiểm tra: chỉ đọc code/schema, không chạy test (không đổi code).
