# Changelog 2026-11-04 — Phần A của 12 yêu cầu (Kế hoạch & Sản xuất)

> Trạng thái: **Đợt 1 (Load cont, YC9) ĐÃ CODE + kiểm tra + chạy thử thật, CHƯA commit** (người dùng tự commit) - nhánh
> `dot-1-load-cont` ở worktree BE `D:\DNA-ERP-BE-parta` và FE `D:\DNA-ERP-parta`. Đợt 2 (LSX + xưởng) đang chuẩn bị ở phiên riêng. Các
> đợt 3, 4, 9, 8, 10a chưa làm. Plan chi tiết: `docs/ke-hoach-phan-a-12-yeu-cau-2026-11-04.md`.

## Mục lục
1. Plan phần A (4 vòng đánh giá + phản biện độc lập) và 4 quyết định người dùng chốt
2. Đợt 1 – Load cont (YC9): đã làm
3. Review Đợt 5a của người B (`faf75fe` BE, `13b75bb` FE) và việc kéo về

## 1. Plan phần A

**Đã làm:** đọc bản yêu cầu v8 + kế hoạch kỹ thuật bản 2 người; 4 trợ lý chỉ đọc rà code hiện có của từng đợt; viết
`docs/ke-hoach-phan-a-12-yeu-cau-2026-11-04.md` (thiết kế từng đợt, điểm ghép với người B, câu hỏi, rủi ro); tự đánh giá 3 vòng; 1
trợ lý độc lập phản biện (25 điểm, 5 mức cao) - Opus kiểm lại các điểm cao bằng code/`node` rồi ghi vào vòng 4 (vd load cont tính bằng
số thực ra 99 thay vì 100; `boxesPacked` đã là bộ; xưởng phải đi cùng vòng đời `warehouseCode`; ngày đề xuất không bao giờ được lưu).

**Người dùng chốt (04/11):** mỗi dòng SKU 1 số LSX riêng, không trùng · lúc KHSX gửi QLSX, mốc còn trống tự lưu ngày đề xuất · "Đóng gói
N+14" là ngày BẮT ĐẦU, hạn VT còn lại = ngày đó − 7 · lệnh cũ đã gửi Sếp/đã duyệt gán mặc định Xưởng Phú An.

**Quy tắc làm:** mỗi đợt 1 nhánh trong worktree riêng ngoài thư mục chính (thư mục chính và các phiên khác không bị đổi nhánh); DB dev
riêng `dna_erp_parta` dựng từ `backups/prod_20261026_0951_truoc-deploy-solver.dump`; **không tự commit - người dùng tự commit** (chốt
04/11 sau khi máy khởi động lại).

## 2. Đợt 1 – Load cont (YC9)

**Vì sao:** v8 mục 9 - mỗi SKU có thể tích thùng và "load cont" (số bộ/cont) làm nền cho năng lực 1,3 cont/ngày (Đợt 3) và xếp hàng
lên cont (Đợt 10a).

**Đã làm (2 thợ `implementer-sonnet` song song BE / FE trên tập file rời nhau; Opus viết trước hàm tính + hợp đồng dữ liệu):**
- BE:
  - `MfgProduct` thêm `boxLengthCm/boxWidthCm/boxHeightCm` (Decimal 7,1), `boxesPerSet` (mặc định 1), `loadContManual`, và 3 cột LƯU SẴN
    `boxVolumeM3`, `loadContFormula`, `loadCont` + người/lúc sửa; `SystemConfig.containerVolumeM3` (mặc định 68). Migration
    `20261104150000_add_mfg_product_container_load` (chỉ thêm cột).
  - `src/common/utils/container-load.util.ts`: load cont = ⌊thể tích cont ÷ (thể tích thùng × số thùng/bộ)⌋, **tính bằng số nguyên
    mm/mm³** (số thực làm 85×80×100 ra 99); số nhập tay thắng công thức. `src/common/dto/container-load.dto.ts` (`ContainerLoadDto`).
  - `PATCH /skus/:id/container-load` - quyền `SKU:VIEW` + vai trò Admin / KHSX / NV định mức chi tiết (không thêm quyền mới, khỏi seed
    production); sửa được ở mọi trạng thái định mức (MfgProduct không bị khoá BOM); lịch sử do audit extension của Prisma tự ghi.
  - Khối `containerLoad` trong response SKU, dòng đơn hàng, dòng lệnh SX.
  - `GET /system-config/planning-params` (mọi người đăng nhập) trả thể tích cont; Admin đổi thể tích cont → tính lại load cont của mọi
    SKU trong cùng transaction.
- FE: `ContainerLoadEditor` (ô kích thước, số thùng/bộ, load cont nhập tay, dòng kết quả cập nhật khi gõ) ở màn NV định mức chi tiết
  (`SpecDetailQuotaPage`) và chi tiết SKU của KHSX (`SKUDetail`); dòng "Load cont 80 · ≈ 2,5 cont" ở đơn hàng (Sales), các dòng SKU của
  lệnh SX và hộp Sếp duyệt (`LenhSXPage`); cột "Load cont" ở danh sách SKU; ô "Thể tích cont 40HC (m³)" ở Cấu hình; bài Hướng dẫn
  `mfg-container-load`; `src/utils/containerLoad.ts` cùng công thức và cùng bộ ví dụ test với BE.

**Review của Opus (đọc diff thật) - đã sửa:**
- Route PATCH trả cả SKU, trái hợp đồng (FE chờ khối `ContainerLoad`) → trả `ContainerLoadDto`.
- Ghi lịch sử 2 lần (gọi `auditEvent` tay trong khi `MfgProduct` đã thuộc `AUDITED_MODELS` của audit extension) → bỏ lời gọi tay; chạy
  thật xác nhận mỗi lần sửa đúng 1 dòng AuditLog.
- FE cho kích thước tới 10.000 cm, số thùng/bộ và load cont tới 1.000.000, không giới hạn số lẻ, trong khi BE chỉ nhận ≤ 1000 cm (1 số
  lẻ), ≤ 20 thùng/bộ, ≤ 100.000 → khớp giới hạn BE để báo ngay ở ô thay vì lỗi 400.
- `SKUDetail` giữ load cont vừa lưu trong state không theo SKU (đổi SKU vẫn hiện số cũ) → state gắn theo id SKU.
- 2 test metadata controller vi phạm `unbound-method` → thêm ghi chú tắt luật đúng như `auth.controller.spec.ts`.

**Đụng phần có sẵn của file dùng chung:** `schema.prisma` (chỉ thêm cột vào `MfgProduct`, `SystemConfig`) · `SystemConfigService.update`
**đổi sang chạy trong `$transaction`** (ghi cấu hình + tính lại load cont cùng lúc) · `system-config.controller.ts` thêm route ·
FE `SystemConfigPage` thêm ô, `system-config-api.ts` thêm field vào danh sách gửi · Hướng dẫn `manufacturing.ts` thêm 1 bài.

**Kiểm tra:**
- BE: jest các module liên quan (util, dto, skus, system-config, production-invoices, sales-orders) qua hết; toàn bộ jest 2209/2213 qua,
  3 test hỏng đều là test giới hạn thời gian của bộ giải cắt sắt (`optimize-material.spec.ts`, "ra phương án trong 20 s") khi chạy cùng
  nest build trên máy vừa khởi động lại - chạy riêng file đó qua 14/14 (Đợt 1 không đụng bộ giải); `tsc` chỉ còn 2 lỗi seed cũ; `nest
  build` OK; eslint các file đổi 0 lỗi (12 cảnh báo đều ở dòng có từ trước).
- FE: `tsc` 0 lỗi; `vitest` 276/276; eslint các file đổi 0 lỗi, không cảnh báo nào ở dòng mới.
- Chạy thật BE 3032 + FE 3132 trên `dna_erp_parta` (sau khi đã kéo Đợt 5a của B về): 19/19 ca API khớp - 85×80×100 → 100 (FORMULA),
  nhập tay 90 thắng (công thức vẫn 100), 2 thùng/bộ → 50, Sales sửa → 403, 1500 cm / 60,55 cm / 21 thùng → 400, planning-params Sales
  200 / chưa đăng nhập 401, Admin đổi 67,5 m³ → SKU tính lại 99, trả 68 → 100, AuditLog 7 dòng cho 7 lần ghi. Giao diện: KHSX sửa thùng
  90×75×125 ở chi tiết SKU → "80 bộ/cont" (đúng ví dụ J55 của v8), "Đã lưu"; NV định mức thấy đúng số ở màn định mức chi tiết; màn 375px
  không kéo ngang; console không lỗi. (Chưa có đơn hàng / lệnh SX trong bản backup 26/10 nên dòng "Load cont" ở đơn hàng và lệnh SX
  chỉ kiểm bằng test + đọc code.)

**Chưa làm:** commit (người dùng); dòng load cont ở đơn hàng/lệnh SX chưa thấy trên dữ liệu thật (cần dữ liệu thử ở Đợt 2).

## 3. Review Đợt 5a của người B và việc kéo về

Người B gộp Đợt 5a "người mua tăng số mua" (YC7 mục 7.2): BE `f201913` + gộp `faf75fe`, FE `901a81f` + gộp `13b75bb`. Đã kéo
fast-forward vào thư mục chính và 2 worktree phần A (`schema.prisma` của worktree gộp 3 chiều bằng `git merge-file`, 0 xung đột), áp
migration `20261104100000_add_purchase_item_order_qty` vào `dna_erp_parta`.

**Đúng:** cột riêng `orderQty` (không sửa thẳng `buyQty` vì lượt tính lại đề xuất ghi đè); số thực mua = max(cần mua, số mua); chỉ được
tăng, sắt chỉ số cây nguyên; đúng người mua phụ trách hoặc Admin/Sếp; khoá sau "Sếp đã duyệt" có kiểm lại trong khoá nghiệp vụ; nhận hàng
chỉ cộng vào giữ chỗ phần còn thiếu so với cần mua, phần dư về tồn chưa giữ (v8 7.4, 4.12); có migration; FE ô "Số mua" + nhãn "Mua dư",
màn nhập kho và theo dõi mua dùng số mua. Kiểm lại: BE jest `purchase-proposals` 97/97, `tsc` chỉ 2 lỗi seed cũ; FE `tsc` 0, vitest 280/280.

**Cần thống nhất (điểm ghép ⑤ của plan phần A):** khi lượt tính lại đề xuất (code của A, `production-invoices/*-purchase.service.ts`)
làm "cần mua" GIẢM xuống dưới "số mua" đã chốt, số mua vẫn giữ → phần mua dư tăng lặng lẽ (vd cần 100, chốt 110; nhu cầu giảm còn 50 →
vẫn mua 110, dư 60). Đề xuất: lượt tính lại đổi `buyQty` của dòng có `orderQty` thì xoá `orderQty` và báo người mua chốt lại. Ghi cho
Đợt 4 của A: màn "Vật tư cần về" tính "còn thiếu" theo số mua (`purchaseQty`), không theo `buyQty`.
