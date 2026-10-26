# Changelog 2026-09-30 — Đánh giá ý tưởng dùng AI nhập định mức + tự điền tham số Solver

> Trạng thái: **CHỈ ĐÁNH GIÁ, CHƯA SỬA CODE — TẠM HOÃN** (người dùng 2026-09-30: "chỗ đó từ từ vì
> có issue cần xử lý"). Hướng đã thống nhất: có chỗ upload Excel → AI tạo định mức nháp → chỉnh sửa
> tại đó → duyệt như cũ.

## 1. Yêu cầu

Người dùng: *"review về DNA-ERP-BE, DNA-ERP và DNA-DEXUAT, tôi đang có ý tưởng là ứng dụng AI để tự
nhập định mức và auto fill vào Solve thì bạn thấy có khả thi và tốt hơn hiện tại không?"*

## 2. Hiện trạng đã rà

**Nhập định mức (DNA-ERP `SpecSteelPage.tsx`)** — KHSX nhập TAY từng mảnh rồi từng dòng con: chọn vật
tư (`MaterialPicker`), chiều dài cắt, SL/mảnh, công đoạn phôi, ghi chú, ảnh. Không có import Excel.
Nguồn gốc thực tế là file Excel của xưởng; 4 sản phẩm thật trong
`prisma/real-data/dinh-muc-j55-gtu.json` = 24 mảnh / 74 dòng, quy cách viết tự do kiểu
`25*50*0,7  *200`, `Ø21*0.6*610`, `phi 8 *20`, `55 *0.2`, lẫn cả phụ kiện (pát/chốt) không phải đoạn
sắt. Bản JSON đó được trích bằng script Python viết tay trong phiên 2026-09-21, và file gốc có lỗi gõ
(tên "sắt hộp" nhưng quy cách "Ø21").

**Đưa sang solver (DNA-ERP-BE `cutting-proposals.service.ts`)** — ĐÃ TỰ ĐỘNG gần hết:
`buildBomRows()` dựng `bom[]` từ `PieceBom`; tham số lấy từ `SystemConfig` + ngưỡng riêng
`Material.maxCuttingWastePercentage`; `time_limit_seconds` FE tự tính
(`GomDotCatPage.tsx::autoTimeLimitSeconds`) và BE tự co lại; chạy nền sau khi Sếp duyệt. KHSX chỉ
còn quyết 3 thứ: gộp SKU nào, có xin đặc cách % hao hụt (bắt buộc lý do, Sếp duyệt) không, chiều dài
cây riêng theo quy cách. Mức % gợi ý đã có sẵn bằng tính toán tất định (`suggestedPct`, best-fill DP).

**DNA-DEXUAT** — solver thuần CP-SAT, không lưu nghiệp vụ; vẫn còn `PRODUCT_CATALOG` mock trong
`cat_sat/de_xuat_views.py` (chỉ phục vụ UI demo riêng của DEXUAT, luồng ERP không dùng).

## 3. Kết luận đánh giá

- **AI đọc định mức → nháp BOM: khả thi, đáng làm có điều kiện.** Điều kiện: AI chỉ tạo
  `BomRevision` DRAFT, giữ nguyên chuỗi duyệt KHSX → Sếp; UI hiện ô gốc cạnh giá trị AI hiểu; AI
  chỉ được CHỌN `materialId` từ danh sách ứng viên (hoặc báo "chưa có vật tư"), không tự bịa. Nên
  làm parser tất định cho Excel trước (định dạng `R*C*dày*dài` khá đều), LLM chỉ gánh dòng parser
  bó tay / file ảnh / PDF. Rủi ro chính: số sai → solver vẫn tối ưu "đúng" cho BOM sai → mua/cắt sai
  hàng loạt, solver không tự phát hiện được.
- **AI tự điền tham số Solver: không nên.** Đầu vào solver đã suy ra tất định từ BOM; phần còn lại là
  quyết định nghiệp vụ có người chịu trách nhiệm (lý do đặc cách, Sếp duyệt). LLM không tối ưu tốt
  hơn CP-SAT; nút thắt thật của Solve là thời gian giải (GHE-J55 7 loại sắt từng mất 1302s trước khi
  bật `stop_on_first`), không phải khâu nhập tham số.

## 4. Phát hiện phụ (dữ liệu seed)

`prisma/seed-real-products.ts::materialCode()` ghép mã vật tư chỉ theo loại + tiết diện, BỎ độ dày.
Trong dữ liệu thật, `HOP-20X20` có cả dày **0,8** (Bàn J55) lẫn **0,6** (Ghế tình yêu) → bị gộp chung
1 vật tư `SAT-HOP-20X20`, tức solver có thể xếp đoạn của 2 loại sắt khác nhau lên cùng 1 cây, và đề
xuất mua gộp sai. Chưa kiểm tra catalog vật tư trên môi trường thật có cùng vấn đề không. Liên quan
seed ở `changelog-2026-09-17-reset-local-du-lieu-that-e2e.md`. Đây cũng là điều kiện tiên quyết cho
AI map vật tư: khoá khớp phải gồm độ dày.

## 5. Chưa làm / còn treo

- Chưa sửa code gì. Chờ người dùng trả lời: số SKU mới mỗi tháng, định dạng file nguồn (Excel cùng
  mẫu hay nhiều mẫu/ảnh chụp/bản vẽ) — quyết định nên dừng ở import Excel tất định hay thêm LLM.
- Chưa sửa phát hiện ở mục 4 (cần người dùng xác nhận quy ước: độ dày khác = vật tư khác).
