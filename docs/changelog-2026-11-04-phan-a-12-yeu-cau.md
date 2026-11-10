# Changelog 2026-11-04 — Phần A của 12 yêu cầu (Kế hoạch & Sản xuất)

> Trạng thái (05/11): **Đợt 1 (YC9) và Đợt 2 (V3-1, YC12) đã commit + gộp + push** (mục 4, 5). **Đợt 3 (YC10) và Đợt 10a
> (YC5) đã commit + gộp + push 05/11** (mục 10, 12). **Đợt 4 (YC6) đã commit + gộp + push 05/11** (mục 15, 17, 18). **Đợt 9 (YC2) đã xong cả 2 phần: phần 1 push 05/11, phần 2 (câu trả lời Sếp) commit + gộp + push 06/11**
> (mục 19, 20, 22–26). Đợt
> 8, 11 chưa làm. Plan chi tiết:
> `docs/ke-hoach-phan-a-12-yeu-cau-2026-11-04.md`. File hướng dẫn test: `docs/huong-dan-test-phan-a-2026-11-05.docx` (mục 9).

## Mục lục
1. Plan phần A (4 vòng đánh giá + phản biện độc lập) và 4 quyết định người dùng chốt
2. Đợt 1 – Load cont (YC9): đã làm
3. Review Đợt 5a của người B (`faf75fe` BE, `13b75bb` FE) và việc kéo về
4. Commit + gộp Đợt 1 vào `main` / `demo` + push
5. Commit + gộp Đợt 2 (số LSX + chọn xưởng) vào `main` / `demo` + push
6. Mở 2 phiên song song: Đợt 3 (mốc, năng lực, cảnh báo) và Đợt 10a (Booking)
7. Kéo `main` / `demo` mới nhất về thư mục chính (05/11)
8. Demo trình duyệt Đợt 1, 2, 3, 10a cho người dùng review (05/11)
9. File Word hướng dẫn test Phần A (05/11)
10. Commit + gộp Đợt 3 và Đợt 10a vào `main` / `demo` (05/11, chưa push)
11. Chạy thử trọn vẹn bản gộp ở local trước khi push (05/11)
12. Push Đợt 3 + 10a lên GitHub (BE rồi FE) + file Word bỏ chi tiết IT (05/11)
13. Review commit của người B 05/11: mã lệnh LSX ở Mua hàng + ẩn mã PI khỏi giao diện
14. Đợt 4 – Vật tư cần về: rà code, thiết kế bản 2, file câu hỏi Sếp (05/11) → code ở mục 15
15. Đợt 4 – Sếp trả lời 4 câu, code xong ở nhánh `dot-4-vat-tu-can-ve` (05/11, chưa commit)
16. Kéo Đợt 5d phần 1 của người B (nhận hàng theo phiếu) + migrate DB dev + đổi tên migration Đợt 4 (05/11)
17. Commit + gộp Đợt 4 vào `main` / `demo` (sau Đợt 5d phần 1 của người B, 05/11, chưa push)
18. Push Đợt 4 lên GitHub (BE rồi FE) + kiểm Render / Vercel (05/11)
19. Đợt 9 – Sửa kế hoạch + Excel (YC2): rà code, thiết kế bản 2, file câu hỏi Sếp (05/11, chưa code)
20. Đợt 9 – code xong ở nhánh `dot-9-sua-ke-hoach` theo phương án IT đề xuất (05/11, chưa commit, chờ Sếp 4 câu)
21. Kéo Đợt 5d phần 2 của người B (ưu tiên SKU cần sớm khi xuất) về thư mục chính (05/11)
22. Commit + gộp Đợt 9 phần 1 vào `main` / `demo` (05/11) → đã push (mục 23)
23. Push Đợt 9 phần 1 lên GitHub (BE rồi FE) + kiểm Render / Vercel (05–06/11)
24. Đợt 9 phần 2 – Sếp trả lời 4 câu, code xong ở nhánh `dot-9-sua-ke-hoach` (06/11) → đã commit + gộp (mục 25)
25. Commit + gộp Đợt 9 phần 2 vào `main` / `demo` (06/11) → đã push (mục 26)
26. Push Đợt 9 phần 2 lên GitHub (BE rồi FE) + kiểm CI / Vercel (06/11)
27. File Word gửi người B: Đợt 9 + phần A còn lại đụng phần B + 8 câu hỏi (06/11)
28. Kéo Đợt 5e của người B (đóng phần thiếu + nhận vượt bắt buộc lý do) về thư mục chính + migrate DB dev (06/11)
29. Kéo Đợt 6 của người B (phiếu xuất XK + số phiếu NK) về thư mục chính + migrate DB dev (06/11)
30. Nhận file Excel kế hoạch của KHSX (mẫu cho Đợt 9) - phân tích + đã đổi cột file xuất theo file KH (Đợt 9 mục 10, đã commit + gộp 09/11 - mục 40) (06/11)
31. Bảo trả lời 8 câu (file gửi Bảo Đợt 9 + Phần A còn lại) kèm anh Nhân chốt 07/11 - cập nhật kế hoạch, chưa code (07/11)
32. Rà lại "cộng 1% khi mua vật tư" - code đúng chốt, dữ liệu thật còn lệch bảng % (script Đợt 0 của B chưa chạy trên bản 26/10) (07/11)
33. Sửa % hao hụt hàng loạt: chọn được nguyên nhóm Sắt (bỏ qua sắt phần mềm) - FE, nhánh `sua-hao-hut-nhom-sat`, đã gộp `demo` + deploy production (07/11)
34. Kéo Đợt 7 của người B (chia 9 kho - phần lõi) về thư mục chính + migrate 2 DB trong máy (07/11)
35. Kéo commit Đợt 7 bổ sung của người B (đá cắt kho Phôi → kho Hàn) + dựng DB test riêng cho test tay trên trình duyệt (07/11)
36. Kéo Đợt 7 bổ sung lần 2 của người B (1 người giữ nhiều kho - đổi "kho đang làm"; chặn xoá 4 kho mới) + migrate 3 DB trong máy (07/11)
37. Cập nhật file Word hướng dẫn test Phần A theo việc sau 06/11 (09/11)
38. Kéo Đợt 10b + thông báo LSX / nhu cầu giảm + link mở thẳng dòng nhận hàng của người B; migrate 3 DB trong máy (09/11)
39. Sửa sau buổi test tay 07/11: tính lại số mua khi nhu cầu giảm, nút Nhập kho ở Vật tư cần về, thông báo số LSX, gom lỗi giao diện + 2 file xác nhận - nhánh `sua-sau-test-tay`, đã commit + gộp + deploy production (09/11)
40. Clone production về local + xoá DB cũ; commit + gộp + push đồng bộ Phôi – Hàn và Đợt 9 phần 3; sửa tiếp "Tổng 0 PI", "Khung 99%", cột Hạn cắt sắt, tiền tố LSX - nhánh `sua-tiep-0911` đã commit + gộp + push (09/11)
41. Dọn worktree cũ, 3 review (chức năng / bảo mật / hiệu năng), "Văn phòng agent", test tay lần 2 (đã đi hết luồng, 38 điểm) + gọn khung "phần đồng nghiệp" ở Lệnh mua vật tư (09/11; commit + push 10/11 - mục 49)
42. Sửa nhóm 1 sau test tay lần 2 (~20 điểm giao diện FE, 5 thợ song song) (09/11; commit + push 10/11 - mục 49)
43. Kéo commit mới của Bảo "Xuất đan 2 phiếu" (BE `b2c8c48`, FE `cdc60af`) + áp migration vào DB máy (09/11)
44. Làm tiếp 4 việc sau test tay lần 2 (NCC 18–21, chặn xuất sắt sớm 30, mã lệnh không nhảy chữ 31, "Khung sẵn để sơn" 34d) + dựng lệnh thử MY-314 xem trên màn phần nhóm 1 (09/11; commit + push 10/11 - mục 49)
45. Hết nhóm 1 sau test tay lần 2: mã lệnh không nhảy chữ ở mọi màn, đo lại "~3 giây" Phôi nhận sắt (không tái hiện), xem trên màn 7/8, 13, 16b + bỏ nút Sếp trùng, nới ô tiền tố LSX (09/11; commit + push 10/11 - mục 49)
46. File Word tổng hợp mọi câu chờ anh Nhân chốt (23 câu + 1 xin dữ liệu) - ghi đè file xác nhận 09/11 (09/11)
47. Pat làm như chân nhôm - điều tra: Pat / Sắt phi (cắt) rơi khỏi tính mua vì chỉ đếm dòng tick "Đan"; vướng tồn Pat ảo - CHỜ người dùng chọn cách, chưa sửa code (09/11)
48. Trả lời file Bảo hỏi "Đổi xưởng khi lệnh đã có phương án cắt / đã giữ sắt" (4 câu) - file Word đã điền (10/11)
49. Commit + push phần sửa sau test tay lần 2 (mục 41.5, 42, 44, 45) + changelog; che chi tiết review bảo mật vì repo công khai (10/11)

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

## 4. Commit + gộp Đợt 1 vào nhánh chính + push

**Vì sao:** người dùng: "làm giống ohey" - mỗi đợt 1 commit trên nhánh đợt, gộp vào nhánh chính bằng commit gộp (`--no-ff`), như
`Gộp Đợt 5a` / `Gộp Đợt 5b` của người B.

**Đã làm:** trước khi commit, đưa nhánh `dot-1-load-cont` lên commit mới nhất có Đợt 5b (BE `5ace63b`, FE `9dd8bc2`) - `schema.prisma`
gộp 3 chiều, 0 xung đột; migration `20261104110000_add_supplier_orders` của B áp vào `dna_erp_parta`. BE: người dùng commit `4d2d215
Load cont SKU (YC9)` (25 file); Opus gộp vào `main` → `4b7f899 Gộp Đợt 1 – Load cont SKU` (trước đó xoá bản sao chưa theo dõi của
`docs/ke-hoach-phan-a-12-yeu-cau-2026-11-04.md` ở thư mục chính - giống hệt bản trong commit, nếu để thì git chặn lệnh gộp). FE: Opus
commit `41ac207 Load cont SKU (YC9)` (19 file, không gồm `next-env.d.ts`, `tsconfig.tsbuildinfo`) theo yêu cầu người dùng, gộp vào
`demo` → `032ec7b Gộp Đợt 1 – Load cont SKU` (trước đó khôi phục `Guide/content/manufacturing.ts` ở thư mục FE chính - chỉ khác ký tự
xuống dòng so với HEAD, nội dung giống hệt).

**Kiểm tra:** trên nền mới (có Đợt 5b): BE jest 35 bộ liên quan 660/660 (gồm `purchase-proposals` của B), `tsc` chỉ 2 lỗi seed cũ,
`nest build` OK; FE `tsc` 0, vitest 275/275. Sau khi gộp: cây code `main` == `dot-1-load-cont`, `demo` == `dot-1-load-cont` (đúng bản đã
kiểm tra); mỗi repo đi trước GitHub 2 commit.

**Push (người dùng duyệt "Push cả 2 repo"):** fetch lại trước khi push - GitHub không có commit mới (chỉ đi trước 2, không tụt sau);
`git push origin main` → `5ace63b..4b7f899`, `git push origin demo` → `9dd8bc2..032ec7b`; nhánh `dot-1-load-cont` không push (như
người B). Push `main` làm Render deploy BE + `prisma migrate deploy` trên production (thêm cột load cont, cột `containerVolumeM3`);
push `demo` làm Vercel deploy FE.

**Chưa làm / chưa kiểm:** GitHub không có trạng thái deploy cho commit (Render/Vercel không báo ngược) → chưa xác nhận deploy xong và
migration đã chạy trên production - người dùng xem ở Render/Vercel. Mục 4 này ghi sau commit nên chưa nằm trong commit nào (để người
dùng commit cùng đợt sau).

## 5. Commit + gộp Đợt 2 vào nhánh chính + push

**Vì sao:** người dùng duyệt tên commit và bảo "tiến hành" - làm như Đợt 1. Đợt 2 do phiên riêng làm (worktree `D:\DNA-ERP-BE-dot2`,
`D:\DNA-ERP-dot2`, DB `dna_erp_dot2`; chi tiết + danh sách file: `docs/changelog-2026-11-04-phan-a-dot-2.md`), đã ghép Đợt 1 + Đợt 5b.

**Kiểm lại trước khi commit (phiên gốc tự chạy, không chỉ tin báo cáo):** nhánh đứng trên `main 4b7f899` / `demo 032ec7b` (GitHub không có
commit mới); BE jest 27 bộ liên quan 601/601, `tsc` chỉ 2 lỗi seed cũ; FE `tsc` 0, vitest 300/300; đọc migration
`20261104170000_add_lsx_and_workshop` (chỉ thêm bảng/cột, chèn 2 xưởng, LSX unique, gán Phú An cho dòng WAITING_BOSS/APPROVED); kiểm các
luật: `workshopId` xoá cùng `warehouseCode` (2/2 chỗ), đổi xưởng chặn khi PI có `SteelIssue` hoặc `MaterialYieldIssue`, bắt buộc LSX khi
gửi QLSX (lẻ + cả lệnh), gửi Sếp thiếu xưởng → 400 "tải lại trang".

**Commit:** BE `45e87de Số LSX + chọn xưởng cơ khí (V3-1, YC12)` (30 file), FE `604c190` cùng tên (20 file, không gồm `next-env.d.ts`,
`tsconfig.tsbuildinfo`). **Gộp `--no-ff`:** BE `main` → `e3ef7c1 Gộp Đợt 2 – Số LSX + chọn xưởng` (không trùng file nào với việc dở ở
thư mục chính); FE `demo` → `b27935e` cùng tên. FE có 3 file trùng với việc dở CHƯA commit ở thư mục chính (`ThongKePagePlan.tsx` - tab
Đồng bộ Phôi–Hàn, `Guide/content/productionPlan.ts` - bài đồng bộ, `e2e/golden-path.spec.ts` - sửa của phiên khác): sao lưu, gộp 3
chiều (1 xung đột ở `ThongKePagePlan.tsx`: 2 bên cùng thêm `import` một chỗ → giữ cả 2), đưa 3 file về HEAD, gộp, đặt lại bản đã gộp.
Kiểm sau gộp: cây `main`/`demo` == `dot-2-lsx-xuong`; việc dở 3 file còn nguyên (số dòng khác HEAD trước/sau như nhau: 2/2, 31/0, 5/1);
`tsc` thư mục chính FE 0 lỗi, BE 2 lỗi seed cũ. Mỗi repo đi trước GitHub 2 commit.

**Push (người dùng duyệt "Push cả 2 repo"):** fetch lại - GitHub không có commit mới; đẩy liền nhau BE `4b7f899..e3ef7c1` và FE
`032ec7b..b27935e` (2 bên phải lên cùng lúc vì gửi Sếp bắt buộc xưởng). Render deploy BE + chạy migration `20261104170000_add_lsx_and_workshop`
trên production (bảng `workshops` + 2 xưởng, cột `lsxCode`/`workshopId`, gán Phú An cho dòng đang chờ Sếp/đã duyệt).

**Chưa kiểm:** chưa xác nhận Render/Vercel deploy xong (không báo ngược về GitHub). Mục 4–5 này chưa nằm trong commit nào.

## 6. Mở 2 phiên song song: Đợt 3 và Đợt 10a (chỉ ghi ở máy, không commit)

Người dùng: "triển khai tiếp phần A". Đợt 1 + 2 đã trên `main`/`demo` nên 2 đợt không chờ nhau chạy được: phiên "Phần A – Đợt 3: mốc,
năng lực, cảnh báo (YC10)" (worktree `*-dot3`, nhánh `dot-3-moc-nang-luc`, DB `dna_erp_dot3`, cổng 3034/3134) và "Phần A – Đợt 10a:
Booking / Lịch xuất hàng (YC5)" (worktree `*-dot10a`, nhánh `dot-10a-booking`, DB `dna_erp_dot10a`, cổng 3035/3135). Brief của mỗi phiên
gồm quyết định đã chốt, mặc định đang chờ anh Nhân (file `docs/cau-hoi-xac-nhan-anh-nhan-2026-11-04.docx` câu 2.2–2.3), cách tránh đụng
nhau (khối chú thích riêng trong `schema.prisma`/`notification-types.ts`, Đợt 10a chỉ thêm 1 dòng vào `daily-jobs`, giờ migration khác
nhau), không commit, changelog file riêng mỗi đợt. Đợt 4, 9 chờ Đợt 3; Đợt 8 chờ câu 2.4 của anh Nhân.


## 7. Kéo `main` / `demo` mới nhất về thư mục chính (05/11, chỉ ghi ở máy, không commit)

Người dùng: "pull nhánh BE và FE mới nhất đã" (trước khi commit + gộp Đợt 3, 10a).

- `git fetch --all`: trên GitHub không có gì mới hơn `Gộp Đợt 5c` của người B (`main` `376534c`, `demo` `6774431`, 04/11 16:18) -
  đúng là gốc của 2 nhánh `dot-3-moc-nang-luc` và `dot-10a-booking`, nên 2 nhánh **không phải kéo/gộp thêm**.
- Thư mục chính chậm hơn → `merge --ff-only`: BE `e3ef7c1` → `376534c` (4 commit Đợt 5c: đơn gộp nhiều lệnh, in phiếu theo mẫu
  Excel, thay phiếu, cột lệnh dùng số LSX), FE `b27935e` → `6774431` (3 commit, tab "Đơn đặt hàng"). File đang sửa dở ở thư mục chính
  (changelog QR, changelog này, `app.module.ts`; FE: phần bảng đồng bộ + vài file khác) không trùng file kéo về → còn nguyên.
- BE thêm thư viện `exceljs` → `pnpm install --frozen-lockfile` (kèm `prisma generate`) ở thư mục chính.
- Kiểm: BE `nest build` exit 0, jest `purchase-proposals` 7 bộ 120/120; FE `tsc --noEmit` 0 lỗi.
- **Chưa làm:** DB dev của thư mục chính (`dna_erp`) còn thiếu 5 migration (`20261104100000_add_purchase_item_order_qty`,
  `…110000_add_supplier_orders`, `…120000_supplier_order_revision`, `…150000_add_mfg_product_container_load`,
  `…170000_add_lsx_and_workshop`) - không tự chạy (luật không tự migrate DB dev dùng chung); muốn chạy app ở thư mục chính thì phải
  `migrate deploy` trước.

## 8. Demo trình duyệt Đợt 1, 2, 3, 10a cho người dùng review (05/11, chỉ ghi ở máy)

Người dùng: "trước khi commit thì hãy mở browser để demo… những YC trong phiên A". Chạy bản Đợt 3 (`be-3034-dot3` + `fe-3134-dot3`,
DB `dna_erp_dot3`, đã gồm Đợt 1 + 2) rồi bản Đợt 10a (`be-3035-dot10a` + `fe-3135-dot10a`, DB `dna_erp_dot10a`); tài khoản demo của
`seed-demo` (admin, khsx, qlsx, sales). Đã cho xem: Cấu hình (tiền tố LSX, thể tích cont 68, năng lực 1,3 / 4); chi tiết SKU gõ thùng
90×75×125 → 80 bộ/cont, 2 thùng/bộ → 40, nhập tay 45; lệnh SX hiện "Load cont 80 · ≈ 2 cont", chip LSX, số trùng bị chặn; QLSX hộp kho &
xưởng (1 ô cả lệnh, chọn Phước An → cảnh báo 8 ngày vs 2 ngày), khối "Đã gửi Sếp — chờ duyệt" + "Đổi xưởng"; tab Năng lực (7 cảnh báo,
bấm ô xem lệnh, dòng vàng SKU chưa có load cont); Bảng mốc (Nhập đan, Chuyền kiểm, "Bắt đầu"); form Sửa thời hạn (ngày đúng công thức
N+k, cảnh báo Nhập đan sớm hơn Sơn); Lịch xuất hàng (lịch, bảng, m³ vượt sức chứa, thiếu hàng chia theo ngày, gõ vượt → viền đỏ + khoá Lưu).
**Không lưu gì** (mọi form bấm Huỷ/Đóng; lần bấm Lưu duy nhất là số LSX trùng - bị từ chối). DB thử để trống "Tiền tố số LSX" nên chưa
thấy chặn tiền tố lạ (chỉ chặn khi Admin đã nhập). Server đã tắt sau demo.

## 9. File Word hướng dẫn test Phần A (05/11, chỉ ở máy, không commit)

Người dùng: "làm cho tôi một file hướng dẫn test, mô tả chi tiết phần A đã làm kèm business rule của từng phần".
- `docs/huong-dan-test-phan-a-2026-11-05.docx` (12 trang, dựng bằng script ở scratchpad phiên, khuôn Arial của file câu hỏi anh Nhân):
  mục 0 tổng quan + trạng thái từng đợt; 1 môi trường (cấu hình chạy, 2 DB test, tài khoản demo - mật khẩu không ghi, chỉ trỏ
  `prisma/seed-demo.ts`; bảng lệnh thử PA3 dùng cho ca nào); 2–5 mỗi đợt: trước/sau, business rule đánh mã (R1.x, R2.x, R3.x, R10.x),
  ca test có ô Đạt/Lỗi (TC1.1–1.12, TC2.1–2.13, TC3.1–3.15, TC10.1–10.16); 6 câu chờ anh Nhân 2.1–2.5 + phần còn treo; 7 bảng ghi lỗi.
- Nguồn rule: changelog Đợt 1 (mục 2), `changelog-…-dot-2.md`, `…-dot-3.md`, `…-dot-10a.md`, plan phần A; giới hạn cấu hình năng lực đọc
  ở DTO (0,1–20 cont/ngày, 1–60 ngày/cont). Ngày trong ca test đối chiếu với lần demo 05/11 và tính tay theo công thức.
- **Thêm dữ liệu thử vào `dna_erp_dot3`** (DB test riêng, không phải DB dùng chung): `PA3-PI-L` (PA3-J55 200 bộ, chưa gửi QLSX, chưa LSX,
  chưa mốc) và `PA3-PI-M` (16 bộ = 0,2 cont, MY-9313, chờ QLSX) - để làm được ca "thiếu LSX khoá Gửi QLSX", "đổi N thì ô đề xuất tính
  lại", "Gửi QLSX tự lưu mốc", "Phước An cùng 1 ngày không cảnh báo". Đã mở thử trên trình duyệt: PA3-PI-L hiện nhãn "Thiếu số LSX (1 SKU)",
  hộp Gửi QLSX báo đỏ + khoá nút, ngày đề xuất 01/12 · 05/12 · 14/12 · 09/12 · 17/12 đúng công thức (N = 20/12 − 18 = 02/12). Không gửi gì.
- Chưa kiểm trên máy: ca tin sáng (TC3.14) và cảnh báo booking (TC10.15) cần chạy BE có bật việc hằng ngày - phiên Đợt 3 / 10a đã thử.

## 10. Commit + gộp Đợt 3 và Đợt 10a vào `main` / `demo` (05/11, chỉ ghi ở máy, CHƯA push)

Người dùng: "tiến hành commit" (sau khi xem demo + file hướng dẫn test). Làm như Đợt 1, 2 (kiểu người B: 1 commit trên nhánh đợt + 1
commit "Gộp Đợt n – …" `--no-ff` vào nhánh chính). Trước khi commit: `fetch` - GitHub không có gì mới hơn `376534c` / `6774431`; quét thay
đổi 4 worktree không thấy mật khẩu / URL DB / tên khách thật (repo BE public).

| | Commit trên nhánh đợt | Gộp vào nhánh chính |
|---|---|---|
| BE Đợt 3 (`dot-3-moc-nang-luc`) | `a4331d8` Mốc, năng lực, cảnh báo (YC10) - 40 file | `f3c3d50` Gộp Đợt 3 – Mốc, năng lực, cảnh báo |
| FE Đợt 3 | `798a82f` - 19 file (bỏ `next-env.d.ts`, `tsconfig.tsbuildinfo`) | `c9d6588` |
| BE Đợt 10a (`dot-10a-booking`) | `0e3b21b` Booking / Lịch xuất hàng (YC5) - 24 file | `4d95d04` Gộp Đợt 10a – Booking / Lịch xuất hàng |
| FE Đợt 10a | `67bfc8b` - 15 file | `b7efc8c` |

- **Xung đột khi gộp 10a sau Đợt 3 (BE, đã gỡ trong commit gộp `4d95d04`):** đều là "2 đợt cùng thêm 1 chỗ", giữ cả hai, Đợt 3 trước:
  `daily-jobs.module.ts` (imports có cả `ProductionCapacityModule`, `BookingsModule`), `daily-jobs.service.ts` (import + tham số
  constructor `dailyOutput`, `bookingAlerts`), `daily-jobs.service.spec.ts` (3 chỗ mock tương ứng), `notification-types.ts` (2 interface
  params + 2 loại `PI_TIMELINE_NEEDS_REPLAN`, `BOOKING_SHORT`). `schema.prisma` tự gộp. FE 2 đợt không chung file.
- **File đang sửa dở ở thư mục chính FE (phần đồng bộ Phôi–Hàn mức 1, chưa commit) trùng Đợt 3** ở `Guide/content/productionPlan.ts`
  và `Manufacturing/ThongKePagePlan.tsx`: chép giữ bản đang sửa → trả 2 file về HEAD → gộp → trộn 3 chiều lại (giữ cả hai: 2 bài Hướng
  dẫn; 4 tab Theo lệnh / Bảng mốc / Năng lực / Đồng bộ Phôi – Hàn). Diff đang sửa dở sau gộp giữ đúng +36 / −1 như trước; KHÔNG vào commit.
  BE thư mục chính: 3 file đang sửa dở không trùng.
- husky `lint-staged` (BE) chạy eslint --fix + prettier khi commit; stash tạm của nó tự xoá (danh sách stash vẫn 26 cái cũ).
- **Kiểm sau gộp (thư mục chính):** BE `prisma validate` OK + `prisma generate`; `tsc` chỉ 2 lỗi seed cũ; `nest build` OK; jest toàn bộ
  2510 qua / 1 bỏ qua, chỉ `optimize-material.spec.ts` hỏng 4 test thời gian khi máy bận - chạy riêng 14/14. FE `tsc` 0, vitest 35 file /
  344 test, eslint 3 file đụng 0 lỗi (5 cảnh báo có sẵn). **Migration:** bản sao tạm `dna_erp_merge_check` của `dna_erp_dot3` chạy thêm
  `20261104190000_add_bookings` sạch, `migrate diff` DB ↔ schema gộp rỗng; đã xoá bản sao.
- Cập nhật file Word hướng dẫn test (trạng thái Đợt 3, 10a = đã gộp, chưa push) và trạng thái đầu file changelog đợt 3 / 10a.
- **Chưa làm:** push (chờ người dùng - push `main` là deploy Render + chạy migration production). DB dev chung `dna_erp` còn thiếu 8 migration
  (`20261104100000` … `20261104190000`: 3 của người B + 5 của phần A) - chưa chạy (luật không tự migrate DB dev dùng chung). Không cần cài
  thư viện mới (2 đợt không đổi `package.json`; `exceljs` của 5c đã `pnpm install` lúc kéo về - mục 7).

## 11. Chạy thử trọn vẹn bản gộp ở local trước khi push (05/11, chỉ ghi ở máy)

Người dùng: "chạy thử trọn vẹn ở local đi" (sau câu hỏi DB local chưa migrate có ảnh hưởng production không - trả lời: không, Render tự
`migrate deploy` lúc khởi động trên DB của chính nó; lần push này thêm 3 migration chỉ-thêm).
- **DB dev chung `dna_erp`:** sao lưu `backups/dna_erp_truoc-migrate-dot3-10a-2026-11-05.dump` (96 bảng dữ liệu) rồi `migrate deploy` 8
  migration `20261104100000` … `190000` → "Database schema is up to date". Thư mục chính (có cả phần đồng bộ đang sửa dở) chạy trên DB
  này: đăng nhập + 9 API (planning-params, production-capacity, milestone-board, bookings, bookings/meta, workshops, production-invoices,
  skus, piece-sync-board) đều 200 (DB chưa có đơn/lệnh nên dữ liệu rỗng).
- **Đúng code sẽ push:** 2 worktree sạch tách rời `D:\DNA-ERP-BE-verify` (= `main` `4d95d04`) và `D:\DNA-ERP-verify` (= `demo` `b7efc8c`),
  `pnpm install` / `npm ci`, `nest build` OK → code commit KHÔNG phụ thuộc file đang sửa dở ở thư mục chính. Cấu hình chạy mới
  `be-3036-full` (bật việc hằng ngày) + `fe-3136-full` trong `.claude/launch.json`.
- **DB test gộp `dna_erp_full`** = bản sao `dna_erp_dot3` (dữ liệu PA3) + migration booking + `pa10-seed.sql` của phiên 10a (đơn/lệnh PA10,
  chưa booking). Script kiểm API 1 mạch (scratchpad `full-check/full-check.mjs`): 23 ca, 21 đạt ngay, 2 ca "SAI" là kỳ vọng của script
  sai (tổng booking tên trường `totalM3`; Bảng mốc chỉ hiện dòng đã duyệt - MY-9312 đang chờ Sếp) → app đúng:
  - Đợt 1: dòng lệnh PA3-PI-L có `containerLoad.loadCont` 80; planning-params 68 m³.
  - Đợt 2: gửi QLSX thiếu LSX 400; LSX trùng 409 nêu lệnh; "my 9312" → MY-9312; gửi Sếp thiếu xưởng bị chặn.
  - Đợt 3: gửi QLSX tự lưu 9 mốc + M1 01/12, M3 09/12 theo N = 20/12 − 18 = 02/12, hạn giao giữ 20/12; bảng năng lực 200 có MY-9312.
  - Ghép 2↔3: QLSX gửi Sếp ở Phước An → KHSX nhận "MY-9312: đặt lại mốc theo Xưởng Phước An - cần 10 ngày … Phú An: 2 ngày".
  - Đợt 10a ↔ 1, 2: ứng viên booking hiện lệnh theo LSX MY-9001, m³/bộ 0,68; booking 100 + 10 bộ → 74,8 m³ / 68 (110%), thiếu 10; thủ kho
    TP tạo 403; booking 2 xếp vượt 400; xác nhận thiếu kho gom 400 → có kho thì CONFIRMED; xoá đơn đang trong booking 409; tìm theo LSX.
  - Việc hằng ngày (chỗ gỡ xung đột `daily-jobs`): khởi động lại BE → lượt đầu 60 s gửi `BOOKING_SHORT` "Booking PA10-FULL-1 (PA10-MEIYING):
    chưa đủ hàng - lấy cont 06/11/2026 (ngày mai) - còn thiếu 10 bộ" tới `sales`, `khsx`, `khotp` (không tới Mua hàng); log không lỗi.
    Tin sáng hôm nay không gửi lại (DB chép từ bản Đợt 3 đã có tin 07:56 - đúng luật 1 tin/ngày).
  - Trình duyệt (khsx, sales): tab Năng lực (3 tab Theo lệnh / Bảng mốc / Năng lực - đúng bản commit), thẻ lệnh MY-9312 hiện đủ load cont +
    kho + Xưởng Phước An + LSX + mốc đã lưu, Lịch xuất hàng hiện booking với khối/thiếu đúng; console không lỗi.
- Sau khi thử: dựng lại `dna_erp_full` về trạng thái sạch (0 booking, PA3-PI-L chưa gửi) cho người test; chép `pa10-seed.sql` vào
  `.claude/tools/huong-dan-test-phan-a/`; tắt mọi server (3001, 3036, 3136). File Word: thêm "bản gộp" ở mục 1.1 + kết quả chạy thử.
- Giữ lại 2 worktree verify (để test bản gộp); xoá được bất cứ lúc nào (`git worktree remove`).
- **Chưa làm:** push (chờ người dùng; nên push BE trước, chờ Render xong rồi FE).

## 12. Push Đợt 3 + 10a lên GitHub (BE rồi FE) + file Word bỏ chi tiết IT (05/11, chỉ ghi ở máy)

- Người dùng: "Push BE rồi FE" (sau khi chạy thử trọn vẹn mục 11). Fetch lại: GitHub không có gì mới.
- 09:52 `git push origin main` BE `376534c..4d95d04` → Render tự deploy + `migrate deploy` 3 migration (`20261104180000`, `180100`,
  `190000`). Theo dõi không vào Render: gọi `https://dna-erp-be.onrender.com/api/v1/production-capacity` (route chỉ bản mới có) - trước
  push 404, **09:55:26 → 401** (route có, cần đăng nhập); `bookings`, `workshops`, `planning-params` 401; `/api/health` 200 → bản mới đã
  chạy, migration đã qua (entrypoint migrate trước khi mở app).
- 09:55 `git push origin demo` FE `6774431..b7efc8c` → Vercel. Kiểm: JS của trang `/` trên `erpdna.vercel.app` có chữ "Lịch xuất hàng",
  "Năng lực sản xuất" (bản mới), KHÔNG có "Đồng bộ Phôi" (phần đang sửa dở không bị đẩy lên). (Cách kiểm trang `/login` không dùng
  được - màn nghiệp vụ không nằm trong JS của trang đăng nhập, chữ của Đợt 1 cũng không thấy ở đó.)
- **File Word hướng dẫn test:** người dùng "cái này là không cần thiết vì sếp không có nghiệp vụ về IT" (bảng cấu hình chạy / cổng / DB) →
  viết lại mục 0–1 cho Sếp đọc: trạng thái "Đã xong, đã cập nhật lên hệ thống"; mục 1.1 chỉ còn 3 "bản thử" (đủ 4 đợt / có booking mẫu /
  chạy cảnh báo tự động) - IT mở sẵn và gửi link + mật khẩu riêng; bỏ tên cấu hình, cổng, tên DB, mã commit, nhánh, tên file/biến code
  ở TC3.14, TC10.15, R1.3, R10.5, mục 6. Quét lại nội dung: không còn từ kỹ thuật. Ghi nhớ luật này cho các lần cập nhật sau.
- Chưa làm: chưa kiểm trên màn production bằng tài khoản thật (không đăng nhập production). Người dùng / KHSX kiểm tay khi dùng.

## 13. Review commit của người B 05/11: mã lệnh LSX ở Mua hàng + ẩn mã PI khỏi giao diện (chỉ ghi ở máy)

Người dùng: "có vẻ ơ hey vừa push, hãy review FE và BE". B đẩy sau khi đã gộp Đợt 3 + 10a của A (merge `origin/main` / `origin/demo`
vào nhánh B) → `origin/main` `e95b28c`, `origin/demo` `ebd83f5` = bản A + B; production đang chạy bản này (B push 09:54 BE / 10:02 FE).
- BE (5 commit, `c53853a` … `e95b28c`): `PurchaseProposalResponseDto.lenhCode` (số LSX, lấy bằng `loadLenhDisplayCodes` của A - điểm ghép ①,
  1 lần đọc cho cả danh sách, không N+1; thông báo Mua hàng dùng mã lệnh); module mới `lenh-codes` `GET /lenh-codes?codes=` (mã PI →
  mã lệnh, ≤ 500 mã, chỉ cần đăng nhập). FE (6 commit, `82015d0` … `ebd83f5`): component `LenhCode` / `useLenhCodeLookup` gom mã PI của cả
  màn vào 1 lần gọi (200 mã/lần, nhớ 2 phút), ~30 màn kho / Phôi / KCS / xưởng / Mua hàng đổi cột "PI" → "Lệnh"; bỏ dòng mã PI mờ ở
  màn của A (LenhSXPage, Tổng hợp lệnh SX, Bảng mốc, hộp Đổi xưởng).
- Kiểm (worktree sạch `D:\DNA-ERP-BE-verify` / `D:\DNA-ERP-verify` chuyển sang `origin/main` / `origin/demo`): BE `nest build` OK, `tsc`
  0 lỗi ngoài seed, jest `lenh-codes` + `purchase-proposals` + `lenh-code util` 9 bộ 144/144, eslint 0 lỗi; FE `tsc` 0, vitest 33 file
  327/327 (đúng 33 file test như trước - 344 ở thư mục chính là có 2 file test của phần đồng bộ chưa commit), eslint 0 lỗi.
- Đúng: dùng lại hàm của A, không sửa code A ngoài việc bỏ dòng mã PI mờ; không migration; không đổi quyền. Đề xuất mua từ phương án cắt
  luôn ghim `productionInvoiceId` (`resolveTargetProductionInvoiceId`) nên hiện đúng LSX (chú thích schema "chỉ PIECE_MATERIAL_YIELD" đã cũ).
- **Cần lưu ý:**
  1. Đổi quyết định Đợt 2 (mã PI nhạt để đối chiếu) → nhiều **thông báo của lệnh SX (phần A) vẫn ghi mã PI** ở tiêu đề (vd "PA3-PI-L: 1 SKU
     chờ QLSX duyệt", tin sáng) trong khi màn hình không còn mã PI → khó đối chiếu (bấm thông báo vẫn mở đúng lệnh). Việc của A: đổi thông
     báo lệnh SX sang số LSX.
  2. e2e `golden-path.spec.ts` dòng 245–249, 277 tìm `getByText(piCode)` sau khi lệnh đã có LSX → sẽ hỏng (chỉ là test tự động; e2e chưa
     chạy định kỳ).
  3. Đề xuất neo 1 SKU (PO) hiện mã lệnh của CẢ PI (lệnh gộp "MY-313 + MY-314") thay vì LSX của đúng dòng - nhỏ.
  4. Đơn đặt hàng: ô lọc nay khớp số LSX nhưng hết khớp mã PI (trái chú thích "vẫn tìm được theo mã PI") - nhỏ.
  5. `/lenh-codes` đọc `productionInvoice` 2 lần; `LenhCode` có thể gọi trùng khi 2 màn hỏi cùng mã lúc đang chờ - nhỏ, không sai số.
- **Đã kéo về thư mục chính** (người dùng: "Kéo về"): BE `4d95d04` → `e95b28c`, FE `b7efc8c` → `ebd83f5` (fast-forward). 3 file đang sửa
  dở của phần đồng bộ trùng file kéo về: chép giữ → trả về HEAD → kéo → trộn 3 chiều lại: `app.module.ts`, `ThongKePagePlan.tsx` tự gộp,
  `core.tsx` 1 chỗ (2 bên cùng thêm import) giữ cả hai. Diff đang sửa dở giữ đúng như trước (`app.module.ts` +2, `core.tsx` +34 −7,
  `ThongKePagePlan.tsx` +5 −1; vẫn 4 tab). Kiểm: BE `tsc` 0 lỗi ngoài seed, `nest build` OK, jest `lenh-codes` + `piece-sync-board` +
  `purchase-proposals` 11 bộ 151/151; FE `tsc` 0, vitest 35 file 345/345, eslint 2 file 0 lỗi. Không cần cài thư viện / migration.
- File Word: R2.6, TC2.13 sửa theo "mã PI không còn hiện", thêm TC2.14; bản thử "đủ 4 đợt" nay chạy đúng bản đang chạy production.

## 14. Đợt 4 – Vật tư cần về (YC6): rà code, thiết kế bản 2, file câu hỏi Sếp (05/11, chỉ ghi ở máy) → code ở mục 15

Người dùng: "Làm Đợt 4 trước". Đọc lại plan mục 4 + v8 YC6 (6.1–6.4) + YC11 11.1, rà code ở `main` `e95b28c` (đã có Đợt 3 + 5a–5c).
- Phát hiện chính: Bảng mốc đã tính theo từng dòng SKU các dòng mua còn thiếu ở 2 mốc mua (kèm người mua, kho nhận, gán dây/nệm riêng
  của SKU) và tin sáng `MORNING_MATERIALS_DIGEST` dựng từ đó → Đợt 4 dùng lại logic này; điểm ghép ② dùng hàm chung `purchaseDeadlineOf`
  (thêm dự phòng M1 = Bắt đầu Phôi − 1, M3 = Bắt đầu đóng gói − 7 của Đợt 3; `frameDeadlineOf` không đổi). Bảng mốc chấm "đủ" theo cần
  mua còn dòng mua chỉ đóng khi đủ số mua (5a) → tách "còn chờ mua dư". Badge bị gọi 30–120 s → tính nhẹ, nhớ tạm 60 s. NCC lấy từ đơn
  đặt hàng (5b/5c) hoặc báo giá đã chọn.
- Thiết kế bản 2 + 6 điểm tự đánh giá (V5-1 … V5-6) ghi vào plan mục **4b**. Đụng file dùng chung với B (sidebar Mua hàng + Kho,
  `work-queue`, `purchaseDeadlineOf`) - đã báo người dùng.
- 4 điểm v8 chưa rõ → file Word cho Sếp `docs/cau-hoi-sep-dot-4-vat-tu-can-ve-2026-11-05.docx` (1 trang, không dùng từ IT; script
  `.claude/tools/huong-dan-test-phan-a/build_cau_hoi_dot4.py`): (1) "Hôm nay" = mọi ngày trong khoảng được về / chỉ ngày sớm nhất / chỉ
  hạn chót; (2) lệnh gộp dùng chung 1 dòng mua: 1 dòng + hạn từng SKU / tách 2 dòng; (3) mua dư đã đủ số cần: hiện không đỏ / như thiếu /
  ẩn; (4) KHSX có mục xem riêng không. IT đề xuất phương án A ở cả 4 câu. Người dùng "câu 4 cần rõ ra nữa" → viết lại câu 4 (bối cảnh: hiện KHSX chỉ thấy vật tư thiếu theo từng lệnh ở Bảng mốc; màn mới xếp theo vật tư + ngày, có còn thiếu / NCC / người mua; A = thêm mục ở menu Kế hoạch SX, đúng danh sách Mua hàng + Kho thấy, chỉ xem, không số nhắc việc; B = không thêm), căn lại vừa 1 trang. File cũ đang mở trong Word nên lưu bản mới `docs/cau-hoi-sep-dot-4-vat-tu-can-ve-2026-11-05-v2.docx`.
- ~~**Chưa làm:** code (chờ Sếp trả lời 4 câu); dựng nhánh `dot-4-vat-tu-can-ve` + DB `dna_erp_dot4` + dữ liệu thử `PA4-`.~~ → đã làm (mục 15).

## 15. Đợt 4 – Sếp trả lời 4 câu, code xong ở nhánh `dot-4-vat-tu-can-ve` (05/11, chưa commit)

Người dùng gửi `TRA_LOI_DOT_4_VAT_TU_CAN_VE_IT_05-11-2026.docx`: câu 1 **A + C** (Hôm nay = cả khoảng được về; ngày hạn chót ghi "HẠN
CHÓT HÔM NAY"; tới hạn chót chưa về đủ → đỏ + báo **KHSX và Sếp**), câu 2 A, câu 3 **B** + ý kiến (theo **số chốt mua**, đã gồm
mua dư), câu 4 A. Người dùng xác nhận Sếp = tài khoản vai trò BOSS (Giám đốc).
- Thiết kế chốt ghi plan mục **4c**. Nhánh + worktree `D:\DNA-ERP-BE-dot4` (từ `main` `e95b28c`), `D:\DNA-ERP-dot4` (từ `demo` `ebd83f5`),
  DB `dna_erp_dot4` (bản sao `dna_erp_full`), dữ liệu thử `.claude/tools/huong-dan-test-phan-a/pa4-seed.sql` (ngày tính theo ngày chạy,
  chạy lại được). Opus viết hợp đồng `MaterialsDueResponse` trước; 1 thợ BE + 1 thợ FE song song (2 repo, không chung file); Opus đọc diff
  thật + chạy lại kiểm tra.
- Chi tiết đã làm / quyết định / kiểm tra / còn treo / file để commit: **`docs/changelog-2026-11-05-phan-a-dot-4.md`** (trong nhánh Đợt 4).
  Tóm tắt: module BE `materials-due` + badge `materialsDueNow` + tin sáng vật tư đổi nguồn (theo mã LSX) + cảnh báo mới
  `MATERIALS_DEADLINE_ALERT` (CRITICAL, KHSX + Sếp) + cấu hình N + dự phòng hạn vật tư (V4-3); FE màn `VatTuCanVePage` ở menu Mua hàng,
  Kho, Kế hoạch SX + ô cấu hình + Hướng dẫn.
- Kiểm tra: BE `nest build` OK, tsc còn 2 lỗi seed cũ, jest toàn bộ 124 suite / 2582 test xanh; FE tsc sạch, vitest 341 test xanh; API thật
  trên dữ liệu PA4 đúng từng vai trò; việc hằng ngày thật gửi đúng cảnh báo đỏ tới khsx + boss và 6 tin sáng đúng người; nhận 10 + 10 Kg
  Sơn qua đúng API Nhập kho → còn thiếu 10 rồi tự biến mất. Trình duyệt (sau khi Claude desktop bị tắt ngang, bật lại BE 3037 / FE 3137):
  màn Mua hàng / Kho / Kế hoạch SX đúng (thẻ + bảng, màu, lọc, phạm vi, cảnh báo đỏ trong chuông của khsx); Opus sửa nhãn kho hiện tên kho.
- **Phát hiện lỗi có sẵn:** số nhắc việc trên menu không hiện ở mọi phân hệ từ 07/10 (`useWorkQueue.ts`, commit `a0c7705`: `poll` giữ
  `token = null` của lần vẽ đầu) - ảnh hưởng cả production; sửa 1 dòng, chờ người dùng quyết (file dùng chung).
- File Word hướng dẫn test: thêm mục **6. Đợt 4** (12 rule R4.1–R4.12, 14 ca TC4.1–TC4.14, bảng dữ liệu PA4, tài khoản muapsh / muavttp /
  khopsh / khovttp, bản thử "Bản Đợt 4"); mục chờ chốt / ghi lỗi đổi thành 7 / 8 (16 trang).
- Đánh giá UX/UI (canvas thiết kế: tổng quan, màn hiện tại / đề xuất, điện thoại; chi tiết U1–U9 ở mục 9 changelog Đợt 4). Người dùng
  "Sửa cả U1–U6" → đã sửa (mục 10 changelog Đợt 4), gồm lỗi số nhắc việc ở `useWorkQueue.ts` (file dùng chung, sửa cho mọi phân hệ -
  báo người B khi gộp). FE tsc sạch, vitest 342 test xanh, trình duyệt thấy số nhắc việc + dải quá hạn + ô Phạm vi đúng.
- **Chưa làm:** U7–U9 (để sau); commit / gộp / push (chờ người dùng).

## 16. Kéo Đợt 5d phần 1 của người B (nhận hàng theo phiếu) + migrate DB dev + đổi tên migration Đợt 4 (05/11)

Người dùng: "pull nhánh mới nhất của Bảo đã" (kèm tin nhắn của B: migration `20261105100000_add_purchase_receipts` đã chạy trên DB dev
chung, chỉ cần `prisma generate`; route `POST /purchase-proposals/:id/items/:itemId/receive` đã gỡ, nhập kho đi qua `/purchase-receipts`).
- **Commit mới:** BE `02bae17` + gộp `b212eab` (bảng `purchase_receipts`, `purchase_receipt_logs.receiptId`, `POST /purchase-receipts`
  (+ preview / reject / GET), chia theo hạn cần, chứng từ bắt buộc, từ chối nhận báo người mua, gỡ route nhận từng dòng); FE `58811c5` +
  gộp `67f912d` (màn Nhập kho nhận theo phiếu `NhapKhoNhanHang.tsx`, `purchase-receipts-api.ts`, Hướng dẫn Kho). Không đổi `package.json`.
- **Kéo về thư mục chính:** file B sửa không trùng file đang sửa dở → `merge --ff-only` thẳng: BE `main` = `b212eab`, FE `demo` = `67f912d`;
  `git status` trước/sau giống hệt (việc dở đồng bộ Phôi–Hàn giữ nguyên). `prisma generate` ở BE.
- **DB dev trong máy `dna_erp` CHƯA có migration của B** (tin của B nói DB dev chung - không phải DB local này): sao lưu
  `backups/dna_erp_truoc-migrate-5d-purchase-receipts-2026-11-05.dump` rồi `migrate deploy` (chỉ CREATE TYPE / TABLE / INDEX, ADD COLUMN /
  CONSTRAINT) → "Database schema is up to date".
- **Ảnh hưởng tới Đợt 4:**
  - **Trùng mốc giờ migration:** B `20261105100000_add_purchase_receipts` và Đợt 4 `20261105100000_add_material_earliest_arrival_days` - theo
    tên thì Đợt 4 xếp TRƯỚC B dù production sẽ chạy B trước. Đổi tên Đợt 4 → **`20261105120000_add_material_earliest_arrival_days`** (worktree
    `D:\DNA-ERP-BE-dot4`, chưa commit) và sửa tên dòng tương ứng trong `_prisma_migrations` của `dna_erp_dot4` (cùng nội dung, `migrate status`
    sạch). Changelog Đợt 4 đổi theo.
  - Màn "Vật tư cần về" đọc `PurchaseProposalItem.receivedQty` / `status` - luồng phiếu mới vẫn ghi vào đó (`applyItemReceipt`) nên không
    phải sửa. Nhận hàng mới chia theo hạn cần qua `itemDeadlineOf` → dùng `purchaseDeadlineOf` (Đợt 4 thêm dự phòng cho lệnh chưa lưu hạn mua).
  - Đợt 4 không gọi route nhận cũ (chỉ script thử ở scratchpad). Khi gộp Đợt 4 với `main` / `demo` sẽ chạm chung `schema.prisma`,
    `notification-types.ts` (BE) và `Guide/content/warehouse.ts` (FE) nhưng ở chỗ khác nhau.
  - File Word: TC4.9 đổi sang nhận theo phiếu (kèm phiếu giao, phiếu nhập, số theo phiếu giao phải khớp).
- **Chưa làm:** gộp `main` / `demo` mới vào nhánh Đợt 4 (làm lúc commit Đợt 4); chạy thử lại TC4.9 trên màn nhận theo phiếu mới.

## 17. Commit + gộp Đợt 4 vào `main` / `demo` (sau Đợt 5d phần 1 của người B, 05/11, chưa push)

Người dùng: "Commit + gộp".
- Rà file trước khi commit (repo BE public): không mật khẩu / IP nội bộ; bỏ tên riêng của Giám đốc khỏi changelog Đợt 4 (ghi "Sếp = vai trò
  BOSS"). Dòng trạng thái đầu changelog Đợt 4 ghi "commit + gộp, chưa push".
- **Commit trên nhánh `dot-4-vat-tu-can-ve`:** BE `0c8a033` (29 file, husky lint-staged eslint + prettier chạy qua); FE `1b06a18` (18 file;
  KHÔNG đưa `next-env.d.ts` (next dev tự sửa) và `tsconfig.tsbuildinfo`).
- Thử gộp trước bằng `git merge-tree`: không xung đột ở cả 2 repo (chạm chung `schema.prisma`, `notification-types.ts`, Hướng dẫn Kho với Đợt
  5d nhưng khác chỗ).
- **Gộp `--no-ff` "Gộp Đợt 4 – Vật tư cần về (YC6)":** BE `main` = **`59f828c`** (file Đợt 4 không trùng việc dở ở thư mục chính); FE `demo` =
  **`136a1a3`** - `Guide/content/productionPlan.ts` vừa là việc dở đồng bộ Phôi–Hàn vừa có bài Đợt 4 → sao lưu bản dở, `checkout --`, gộp,
  `git merge-file` 3 chiều (không xung đột), ghi lại CRLF. `git status` + số dòng việc dở trước/sau giống hệt ở cả 2 thư mục chính.
- **Kiểm bản gộp ở worktree sạch** `D:\DNA-ERP-BE-verify` (= `59f828c`) / `D:\DNA-ERP-verify` (= `136a1a3`): BE `prisma generate`, `nest build`
  OK, `tsc` chỉ 2 lỗi seed cũ, `jest --runInBand` **126 suite / 2598 test xanh** (1 skip có sẵn; gồm test Đợt 5d của B); FE `tsc` sạch, `vitest`
  **34 file / 340 test xanh**.
- **DB dev `dna_erp`:** sao lưu `backups/dna_erp_truoc-migrate-dot4-2026-11-05.dump` → `migrate deploy` `20261105120000_add_material_earliest_
  arrival_days` (ADD COLUMN mặc định 4) → up to date.
- ~~**Chưa làm:** push~~ → đã push (mục 18). Còn: báo người B: `useWorkQueue.ts` đã sửa deps (số nhắc việc mọi phân hệ),
  `purchaseDeadlineOf` thêm dự phòng, tin sáng vật tư đổi nội dung + loại cảnh báo mới `MATERIALS_DEADLINE_ALERT`; chạy lại TC4.9 trên màn
  nhận theo phiếu; worktree `*-dot4` + DB `dna_erp_dot4` còn giữ để test.

## 18. Push Đợt 4 lên GitHub (BE rồi FE) + kiểm Render / Vercel (05/11)

Người dùng: "Push BE rồi FE".
- Fetch trước: `origin/main` = `b212eab`, `origin/demo` = `67f912d` (không có commit mới hơn) → `main` / `demo` chỉ đi trước đúng 2 commit Đợt 4.
  Production trước push: `GET /api/v1/materials-due` → 404.
- **BE** 14:33 `b212eab..59f828c main -> main`. Canh route mới: **14:35:31 → 401** (route có, cần đăng nhập) = Render đã lên bản mới; entrypoint
  chạy `prisma migrate deploy` trước khi khởi động nên 2 migration `20261105100000_add_purchase_receipts` (B) + `20261105120000_add_material_
  earliest_arrival_days` (A) đã vào DB production. `system-config/planning-params` cũng 401.
- **FE** 14:36 (fetch lại: không có commit mới) `67f912d..136a1a3 demo -> demo`. Canh chunk JS của trang `/` trên `erpdna.vercel.app`: **14:37:56**
  có `materials-due` (Đợt 4) và `purchase-receipts` (Đợt 5d của B) → Vercel đã lên bản mới.
- File Word hướng dẫn test: trạng thái Đợt 4 → "Đã xong, đã cập nhật lên hệ thống ngày 05/11".
- **Còn:** báo người B 3 thay đổi dùng chung (`useWorkQueue.ts`, `purchaseDeadlineOf`, tin sáng vật tư + `MATERIALS_DEADLINE_ALERT`); chạy lại TC4.9 trên
  màn nhận theo phiếu; chưa đăng nhập production để xem màn thật (không dùng tài khoản thật).

## 19. Đợt 9 – Sửa kế hoạch + Excel (YC2): rà code, thiết kế bản 2, file câu hỏi Sếp (05/11, chưa code)

Người dùng: "làm đợt 9, nếu bạn cần mẫu excel hay gì thì cứ nói tôi hỏi sếp cung cấp". Đọc lại v8 YC2 (2.1–2.4) + plan mục 5, rà code ở `main`
`59f828c` (đã có Đợt 3, 4, 5d).
- Phát hiện chính: 2 route sửa mốc không kiểm trạng thái và ghi cả hạn giao; quyền UPDATE có cả ở thủ kho (để gọi transfer-check / packaging);
  FE chỉ gọi route cả PI từ "Sửa thời hạn", chỉ hiện PI đang lập kế hoạch. Hàm ghi mốc + luật gộp + audit / thông báo `PI_ITEM_DEADLINE_CHANGED`
  đã có - Đợt 9 dùng lại. Mọi màn đọc mốc trực tiếp nên áp mốc xong là tự đổi. Lịch sử có trong audit nhưng không có màn xem. FE `xlsx` 0.18.5
  có lỗi bảo mật khi đọc file lạ → đọc / xuất Excel ở BE bằng `exceljs` (đã có từ 5c).
- Thiết kế bản 2 + tự đánh giá V9-1 … V9-7 ghi vào plan mục **5b**: lô đổi mốc chờ Sếp (`DeadlineChangeBatch` / `Request`), dòng chưa duyệt sửa
  thẳng, dòng đã duyệt vào lô, chỉ KHSX (`@RequireRole`), Sếp duyệt / từ chối có lý do, kiểm mốc không bị đổi từ lúc gửi, Excel so với giá trị
  LÚC XUẤT (cột ẩn) để file cũ không ghi đè, xem trước cũ → mới + lỗi + cảnh báo, lịch sử đổi mốc theo dòng SKU, nút lọc "Đang chạy", màn Sếp
  "Đổi mốc lệnh SX".
- File Word cho Sếp `docs/cau-hoi-sep-dot-9-sua-ke-hoach-2026-11-05.docx` (1 trang, không từ IT; script `.claude/tools/huong-dan-test-phan-a/
  build_cau_hoi_dot9.py`): (1) dời 1 mốc có tự dời mốc sau (A chỉ ô sửa + cảnh báo / B tự dời cùng số ngày); (2) thứ tự ngược: A cảnh báo vẫn
  lưu / B chặn; (3) Excel gồm: A mọi lệnh chưa Kết thúc / B chỉ lệnh đã duyệt; (4) lô có 1 lệnh Sếp không đồng ý: A từ chối cả lô (v8) / B bỏ chọn
  lệnh đó, duyệt phần còn lại. IT đề xuất A, A, A, **B** (câu 4 lệch v8 - ghi rõ trong file). Xin kèm file Excel kế hoạch KHSX đang dùng để
  đặt tên / thứ tự cột giống.
- Người dùng "ghi rõ YC2 về câu 3" → câu 3 thêm Bối cảnh trích nguyên văn v8 YC2 mục "Cách làm" ("Nút 'Tải Excel kế
  hoạch': xuất ra file danh sách lệnh đang chạy, mỗi dòng 1 SKU với các cột mốc") và nói rõ chỗ chưa rõ: "lệnh đang chạy" có gồm lệnh chưa
  duyệt (KHSX đang lập, chờ QLSX, chờ Sếp) không; ví dụ 5 chưa duyệt + 20 đã duyệt → A 25 lệnh / B 20 lệnh. Vẫn 1 trang.
- ~~**Chưa làm:** code; nhánh `dot-9-sua-ke-hoach` + DB `dna_erp_dot9` + dữ liệu `PA9-`.~~ → đã làm (mục 20).

## 20. Đợt 9 – code xong ở nhánh `dot-9-sua-ke-hoach` theo phương án IT đề xuất (05/11, chưa commit, chờ Sếp 4 câu)

Người dùng: "Làm trước" (làm phần không phụ thuộc câu trả lời trong lúc chờ Sếp). Câu phụ thuộc (dời mốc sau, chặn / cảnh báo thứ tự, phạm vi
Excel, duyệt từng lệnh) làm theo phương án IT đề xuất, mỗi câu đổi được bằng 1 hằng / 1 tham số.
- Nhánh + worktree `D:\DNA-ERP-BE-dot9` (từ `origin/main` `59f828c`), `D:\DNA-ERP-dot9` (từ `origin/demo` `136a1a3`); DB `dna_erp_dot9` (bản sao
  `dna_erp_dot4` + migration 5d); dữ liệu `pa4-seed.sql` + `pa9-seed.sql` mới. Opus viết hợp đồng (types, hàm thuần, "cổng" `DeadlineChangesPort` để
  phần Excel không phải chờ lõi) → 4 thợ song song: BE lõi, BE Excel, FE KHSX, FE Sếp (không chung file). Opus nối Excel vào module, đọc diff, sửa:
  header multipart khi tải file lên (thợ FE phát hiện), cảnh báo thứ tự mốc cho dòng sửa thẳng, gộp cảnh báo thành 1 câu / mốc, số nhắc việc tải
  lại ngay sau khi Sếp quyết (`useWorkQueue.refresh`).
- Chi tiết: **`docs/changelog-2026-11-05-phan-a-dot-9.md`** (trong nhánh Đợt 9).
- Kiểm tra: BE `nest build` OK, `tsc` 2 lỗi seed cũ, `jest` toàn bộ 132 suite / 2672 test xanh; FE `tsc` sạch, `vitest` 365 test xanh; API thật + Excel
  đầu-cuối (xuất, sửa, xem trước: ghi thẳng / chờ Sếp / lỗi ngày / lỗi luật gộp, Xác nhận 2 lần 1 lô); trình duyệt: tab Đang chạy, form lệnh đã duyệt,
  khung chờ + Huỷ yêu cầu, lịch sử, màn Sếp duyệt + từ chối có lý do, tab Đã quyết, nhãn Bảng mốc.
- File Word hướng dẫn test: thêm mục **7. Đợt 9** (11 rule R9.1–R9.11, 17 ca TC9.1–TC9.17, bản thử "Bản Đợt 9"); mục chờ chốt / ghi lỗi thành 8 / 9 (18 trang).
- **Chưa làm:** chờ Sếp trả lời 4 câu + file Excel mẫu → đổi theo (phần 2); push (chờ người dùng). Phần 1 đã commit + gộp (mục 22).

## 21. Kéo Đợt 5d phần 2 của người B (ưu tiên SKU cần sớm khi xuất) về thư mục chính (05/11)

Người dùng: "pull nhánh mới nhất đã".
- Fetch: BE có `a0d288e` + gộp `6f5c554` "Đợt 5d phần 2 (YC11) — lệnh gộp ưu tiên SKU cần sớm khi xuất vật tư" (mới `src/modules/stock/
  sku-priority.util.ts`; nối vào xuất tiêu hao, đóng gói, vật tư mang kèm đan, vật tư thành phẩm; hạn SKU theo `purchaseDeadlineOf`; sắt, giữ chỗ, số
  mua không đổi). FE `demo` không có commit mới (`136a1a3`).
- Không đổi `package.json` / lockfile / `prisma/` → không cài lại, không `prisma generate`, không migrate (`dna_erp` vẫn up to date).
- File B sửa không trùng việc dở ở thư mục chính → `merge --ff-only`: BE `main` = `6f5c554`; `git status` + số dòng việc dở trước / sau giống hệt.
- Ảnh hưởng Đợt 9 (nhánh `dot-9-sua-ke-hoach` gốc `59f828c`, chưa commit): không file nào chung; lúc commit Đợt 9 sẽ gộp `main` mới. B dùng
  `purchaseDeadlineOf` (Đợt 4 thêm dự phòng Bắt đầu Phôi − 1 / Bắt đầu đóng gói − 7) - đúng hàm chung.

## 22. Commit + gộp Đợt 9 phần 1 vào `main` / `demo` (05/11) → đã push (mục 23)

Người dùng: "commit đợt 9 part 1 trước" (phần 1 = theo phương án IT đề xuất cho 4 câu chờ Sếp; phần 2 = đổi theo câu trả lời + file Excel mẫu).
- Rà file (repo BE public): không tên riêng / mật khẩu / IP nội bộ. Dòng trạng thái + tiêu đề changelog Đợt 9 ghi "phần 1, commit + gộp, chưa push".
- **Commit trên nhánh `dot-9-sua-ke-hoach`:** BE `2b7e0cf` (31 file, husky lint-staged chạy qua); FE `2f49d16` (16 file; không đưa `next-env.d.ts`,
  `tsconfig.tsbuildinfo`).
- `git merge-tree` thử trước: không xung đột cả 2 repo (BE `main` đã có Đợt 5d phần 2 `6f5c554` - không file chung).
- **Gộp `--no-ff` "Gộp Đợt 9 phần 1 – …":** BE `main` = **`9615554`** (không trùng việc dở); FE `demo` = **`e1cae72`** - `Guide/content/productionPlan.ts`
  vừa là việc dở đồng bộ Phôi–Hàn vừa có bài Đợt 9 → sao lưu, `checkout --`, gộp, `git merge-file` 3 chiều (không xung đột, đủ 2 bài Đợt 4 + Đợt 9), ghi lại
  CRLF. `git status` + số dòng việc dở trước / sau giống hệt ở cả 2 thư mục chính.
- **Kiểm bản gộp ở worktree sạch** `D:\DNA-ERP-BE-verify` (= `9615554`) / `D:\DNA-ERP-verify` (= `e1cae72`): BE `prisma generate`, `nest build` OK, `tsc` 2 lỗi
  seed cũ, `jest --runInBand` **133 suite / 2689 test xanh** (1 skip có sẵn; gồm test 5d phần 2 của B); FE `tsc` sạch, `vitest` **36 file / 365 test xanh**.
- **DB dev `dna_erp`:** sao lưu `backups/dna_erp_truoc-migrate-dot9-2026-11-05.dump` → `prisma generate` + `migrate deploy`
  `20261105130000_add_deadline_change_batches` → up to date.
- ~~push~~ (đã push - mục 23). **Chưa làm:** phần 2 khi Sếp trả lời; báo người B: route sửa mốc chỉ còn KHSX / Admin,
  `useWorkQueue.refresh`, đường ghi mốc tách ra `ItemDeadlineWriter`.

## 23. Push Đợt 9 phần 1 lên GitHub (BE rồi FE) + kiểm Render / Vercel (05–06/11)

Người dùng: "Push BE rồi FE".
- **BE** 05/11 16:59: `git push origin main` `6f5c554..9615554`. Render lên bản mới lúc 17:01:51 - cách kiểm không cần vào Render: gọi route chỉ bản
  mới có `GET https://dna-erp-be.onrender.com/api/v1/deadline-changes` và `/deadline-plan/export` → 404 đổi thành **401** (cần đăng nhập).
- **FE** 05/11 17:02 (sau khi Render xong): `git push origin demo` `136a1a3..e1cae72`.
- **Vercel:** lần canh tự động 05/11 hỏng giữa chừng (script tạo bằng sed lỗi, exit 4) → 06/11 kiểm tay: tải trang `https://erpdna.vercel.app/`, quét
  14 chunk JS, có chunk chứa chuỗi `deadline-plan` (chỉ bản Đợt 9 có) → **Vercel đã chạy bản Đợt 9 phần 1**.
- Không thêm biến môi trường production nào (exceljs đóng gói cùng BE; không cấu hình mới).
- **Chưa làm:** ~~phần 2~~ (đã code - mục 24); báo người B 3 điểm ở mục 22.

## 24. Đợt 9 phần 2 – Sếp trả lời 4 câu, code xong ở nhánh `dot-9-sua-ke-hoach` (06/11) → đã commit + gộp (mục 25)

Người dùng gửi file trả lời của Sếp: Q1 **B** (mốc sau tự dời, KHSX vẫn sửa tay lại được), Q2 **B** (thứ tự ngược không cho lưu), Q3 **ý kiến khác**
(Excel chỉ lệnh CHƯA bắt đầu sản xuất / chưa cắt phôi; lệnh đã bắt đầu cắt KHÔNG sửa mốc), Q4 **B**. Không có file Excel mẫu.
- Nhánh fast-forward lên `main` `9615554` / `demo` `e1cae72` (đã gồm Đợt 5d phần 2 của người B). Opus viết hợp đồng (hàm `resolveAutoShift`,
  `isFloorStarted`, `blockedReason`, bản chép FE + test) → 4 thợ song song (BE lõi, BE Excel, FE KHSX, FE Sếp) → Opus đọc diff, sửa nhỏ (hạn giao để so
  thứ tự = hạn dòng, chưa có thì hạn lệnh - cả BE + FE; câu nhắc "luôn được lưu" chỉ ở dòng chưa duyệt; câu Sếp rút gọn; Hướng dẫn thêm ô tự đổi trong Excel).
- Excel dời mốc bằng **công thức** (sửa 1 ô thì Excel đổi các ô sau ngay; BE nhận ra ô còn công thức của hệ thống = tự dời, tự tính lại) - để KHSX giữ
  được 1 mốc sau ở ngày cũ (gõ lại ngày cũ). "Đã bắt đầu sản xuất" = lệnh SX `floorStage` ≠ PENDING. 2 mốc Mua VT không tự dời.
- Chi tiết: **`docs/changelog-2026-11-05-phan-a-dot-9.md` mục 9** (trong nhánh Đợt 9).
- Kiểm tra: BE `nest build` OK, `tsc` 2 lỗi seed cũ, `jest` **134 suite / 2722 test xanh**; FE `tsc` sạch, `vitest` **37 file / 392 test xanh**; API thật
  (xuất bỏ lệnh đã cắt, tự dời, giữ ngày, chặn thứ tự cả sửa thẳng, chặn lệnh đã cắt, Sếp 409 / từ chối); trình duyệt KHSX + Sếp; **Microsoft Excel 16
  thật** (sửa 1 ô → Excel tự đổi ô sau, lưu → tải lên nhận đúng).
- File Word hướng dẫn test: mục 7 sửa R9.1, R9.6, R9.7 + thêm **R9.12** (tự dời), **R9.13** (lệnh cắt khi đang chờ); sửa TC9.1, TC9.7–TC9.9 (đổi
  MY-9303 → MY-9305 vì MY-9303 ở bản thử có Hàn ngược sẵn), thêm **TC9.18–TC9.22**; bảng trạng thái + 8.2; ngày cập nhật 06/11 (19 trang).
- Plan `docs/ke-hoach-phan-a-12-yeu-cau-2026-11-04.md` mục 5b: ghi câu trả lời Sếp.
- **Chưa làm:** ~~commit / gộp~~ (mục 25); push (chờ người dùng); màn xem trước Excel chưa bấm thử trên trình duyệt (dữ liệu đã kiểm qua API); chưa thử WPS;
  báo người B (mục 22 + `production-invoices.service.ts` thêm 2 hàm kiểm cho dòng sửa thẳng).

## 25. Commit + gộp Đợt 9 phần 2 vào `main` / `demo` (06/11) → đã push (mục 26)

Người dùng: "Commit + gộp".
- Rà diff (repo BE public): không tên riêng / mật khẩu / IP nội bộ. `git fetch`: `origin/main`, `origin/demo` không có commit mới của người B.
- **Commit trên nhánh `dot-9-sua-ke-hoach`:** BE **`85c7541`** (10 file, husky lint-staged chạy qua); FE **`6b919d3`** (12 file; không đưa `next-env.d.ts`,
  `tsconfig.tsbuildinfo`).
- `git merge-tree` thử trước: không xung đột cả 2 repo.
- **Gộp `--no-ff` "Gộp Đợt 9 phần 2 – đổi theo câu trả lời của Sếp (YC2)":** BE `main` = **`bf42ee2`** (không trùng việc dở); FE `demo` = **`e45c048`** -
  `Guide/content/productionPlan.ts` vừa là việc dở đồng bộ Phôi–Hàn vừa có bài Đợt 9 → sao lưu, `checkout --`, gộp, `git merge-file` 3 chiều (không xung
  đột), ghi lại CRLF. `git status` + `git diff --stat` việc dở trước / sau giống hệt ở cả 2 thư mục chính.
- **Kiểm bản gộp ở worktree sạch** `D:\DNA-ERP-BE-verify` (= `bf42ee2`) / `D:\DNA-ERP-verify` (= `e45c048`): BE `prisma generate`, `nest build` OK, `tsc` 2
  lỗi seed cũ, `jest --runInBand` **134 suite / 2722 test xanh** (1 skip có sẵn); FE `tsc` sạch, `vitest` **37 file / 392 test xanh**.
- **DB dev `dna_erp`:** phần 2 không đổi `prisma/` / thư viện → không migrate, không cài lại.
- ~~push~~ (đã push - mục 26). Ghi chú cũ về cách kiểm Render: phần 2 không thêm route mới → xem log deploy hoặc gọi xuất Excel
  có trang "Hướng dẫn"); báo người B (mục 22 + 2 hàm kiểm mới trong `production-invoices.service.ts`).

## 26. Push Đợt 9 phần 2 lên GitHub (BE rồi FE) + kiểm CI / Vercel (06/11)

Người dùng: "Push BE rồi FE".
- **BE** 08:28:58: `git push origin main` `9615554..bf42ee2`. Phần 2 không thêm route → không dò Render bằng 404 → 401 được; GitHub cũng không nhận thông
  báo deploy từ Render (lần cuối 08/2026). Thay bằng: CI GitHub của `bf42ee2` **lint / test / build đều success** (xong 08:34:51) + đợi ~6 phút (lần
  trước Render mất ~3 phút), BE production vẫn trả 401 bình thường suốt lúc đợi.
- **FE** 08:35:05: `git push origin demo` `e1cae72..e45c048`. **Vercel chạy bản mới lúc 08:37:02** (chunk JS của trang "/" có chữ "Đã bắt đầu SX" - chỉ
  phần 2 có).
- Không thêm biến môi trường, không migration.
- **Chưa xác nhận trực tiếp Render đã chạy `bf42ee2`** (cần xem dashboard Render, hoặc KHSX tải Excel kế hoạch trên hệ thống thật thấy trang "Hướng dẫn" /
  thiếu lệnh đã cắt phôi). Báo người B (mục 22 + 2 hàm kiểm mới trong `production-invoices.service.ts`).

## 27. File Word gửi người B: Đợt 9 + phần A còn lại đụng phần B + 8 câu hỏi (06/11)

Người dùng: "soạn tất cả thành một file word tôi sẽ gửi Bảo". File **`docs/gui-bao-dot-9-va-phan-a-con-lai-2026-11-06.docx`** (4 trang, KHÔNG commit -
repo public, có tên người), dựng bằng `.claude/tools/huong-dan-test-phan-a/build_gui_bao.py` (khuôn Arial của file hỏi anh Nhân).
- Mục 1 việc làm trên máy B (pull, `prisma generate`, `migrate deploy` 1 migration Đợt 9; không cài lại thư viện - đã kiểm `package.json` / lockfile
  từ `6f5c554` / `136a1a3`); mục 2 Đợt 9 đụng file dùng chung + luật mốc mới + nhắc lại Đợt 4; mục 3 bảng phần A còn lại × chỗ đụng phần B (5e, 6, 7,
  10b theo kế hoạch kỹ thuật); mục 4 câu hỏi: ⑤ xoá `orderQty` khi tính lại, xưởng → kho Phôi trước Đợt 8, chỗ B đọc số cây sắt, mảnh mức 2 × Đợt 7,
  màn danh mục xưởng, đường dẫn màn nhận theo phiếu (U8), chia số mua theo SKU, thông báo còn mã PI.
- Kiểm: xuất PDF qua Word, xem 4 trang (sửa dấu ` trong chữ đậm, tiêu đề rớt dòng, dòng chấm điền).
- **Bản v2** `docs/gui-bao-dot-9-va-phan-a-con-lai-2026-11-06-v2.docx` (bản cũ đang mở trong Word nên ghi file mới): người dùng "xoá cái này đi: Việc
  cần làm trên máy em … Bảo là IT, còn Nhân là sếp nhỏ" → bỏ mục việc làm trên máy (chỉ giữ 1 dòng mã commit); mục câu hỏi thành **"Câu kỹ thuật cần em
  trả lời"** + chú thích câu nghiệp vụ hỏi anh Nhân file riêng; câu 1 (điểm ⑤) chỉ hỏi ai sửa code (nghiệp vụ chờ anh Nhân câu 2.5); câu 5 bỏ lựa chọn
  nghiệp vụ "chưa cần". Ghi nhớ mới: Bảo = IT, anh Nhân = sếp nhỏ, Sếp = Giám đốc.
- Người dùng: "nói mà không dùng thuật ngữ … non-tech như sếp có thể hiểu luôn, không tạo file mới, sửa trực tiếp" → viết lại **ngay trong file v2**
  (3 trang): bỏ mọi tên code / route / bảng / mã commit; 3 mục (Đợt 9 đổi gì · việc A còn lại liên quan phần B · 8 câu ngắn); chi tiết code trỏ sang
  nhật ký thay đổi Đợt 4 / Đợt 9.

## 28. Kéo Đợt 5e của người B (đóng phần thiếu + nhận vượt bắt buộc lý do) về thư mục chính + migrate DB dev (06/11)

Người dùng: "pull nhánh mới của ohey" (kèm tin B: 5e đã push, nằm sau Đợt 9 phần 2; BE chỉ cần `prisma generate`, migration chỉ thêm cột; FE không cài gì).
- Fetch: BE `5a5fefe` + gộp **`57c1cd4`**, FE `59a2b38` + gộp **`6440dc3`** (đều 06/11 08:55–08:57). BE 13 file (schema, `notification-types.ts` thêm
  `PURCHASE_OVER_RECEIVED`, supplier-orders / purchase-receipts service + controller + DTO + spec, migration `20261105140000_purchase_short_close_over_receipt`);
  FE 11 file (màn Đơn đặt hàng + hộp "Đóng phần thiếu", màn mới "Nhận vượt", Nhập kho nhận hàng, `PurchasingApp.tsx`, Hướng dẫn mua hàng / kho).
  Không đổi `package.json` / lockfile → không cài lại.
- Cả 2 là nối tiếp bản của A (`bf42ee2` / `e45c048`), không trùng file việc dở → `merge --ff-only`; `git status` + `git diff --stat` việc dở trước / sau
  giống hệt.
- **DB dev `dna_erp`:** sao lưu `backups/dna_erp_truoc-migrate-5e-2026-11-06.dump` → `prisma generate` + `migrate deploy` (1 migration, thêm 5 cột ở dòng mua
  + 3 cột ở phiếu nhận) → đã có cột mới. (Tin B "đã chạy trên DB dev chung" là DB của B.)
- **Ảnh hưởng màn "Vật tư cần về" (Đợt 4):** đóng phần thiếu chuyển dòng cũ sang PURCHASED (+ `shortClosedQty`, lý do) và tạo dòng NEW mới
  (`reorderOfItemId`, số = cần mua − đã nhận). Màn chỉ đọc NEW / QUOTING / SUBMITTED / PURCHASING → dòng cũ tự ra khỏi màn, dòng mới hiện "chưa đặt" tới khi
  về đủ - **không đếm trùng**, không cần sửa. (Mục "đóng phần thiếu" còn treo của Đợt 4 coi như xong nhờ 5e.) Nhận vượt không đổi cách tính còn thiếu.
- **Kiểm bản mới ở worktree sạch** (`57c1cd4` / `6440dc3`): BE `nest build` OK, `tsc` 2 lỗi seed cũ, `jest --runInBand` **134 suite / 2729 test xanh**; FE `tsc`
  sạch, `vitest` **37 file / 392 test xanh**.
- **Chưa làm:** thử trên trình duyệt màn mới của B (không phải việc của A); chạy lại TC4.9 trên màn nhận theo phiếu (vẫn treo).

## 29. Kéo Đợt 6 của người B (phiếu xuất XK + số phiếu NK) về thư mục chính + migrate DB dev (06/11)

Người dùng: "pull nhánh mới nhất" (kèm tin B: Đợt 6 đã push; gỡ 2 route `POST /production-invoices/:id/steel-issues`, `POST /production-orders/:id/
material-issues` - xuất sắt / vật tư tiêu hao giờ qua `POST /issue-slips` rồi `/issue-slips/:id/confirm` kèm ảnh phiếu ký; `POST /purchase-receipts` bắt
buộc `slipCode`; "phần nhập kho 5d–5e và Đợt 6 phải lên bản chính cùng một lần").
- Fetch: BE `87c9140` + gộp **`766f368`** (19 file: module mới `issue-slips`, migration `20261106090000_issue_slips_and_slip_codes`, `schema.prisma`,
  `app.module.ts`, steel-issues / material-issues / purchase-receipts, realtime contract); FE `0691c61` + gộp **`4b53d48`** (17 file: màn Phiếu xuất, giỏ
  phiếu, in phiếu nhập / xuất mẫu 01-VT / 02-VT, Xuất sắt, Xuất vật tư tiêu hao, Nhập kho nhận hàng, Hướng dẫn kho). Không đổi thư viện.
- BE `src/app.module.ts` vừa là việc dở (đăng ký `PieceSyncBoardModule` của đồng bộ Phôi–Hàn) vừa bị B thêm `IssueSlipsModule` → sao lưu, `checkout --`,
  `merge --ff-only`, `git merge-file` 3 chiều (2 chỗ khác nhau, không xung đột), ghi lại CRLF; `git status` việc dở giống hệt. FE không trùng → `ff-only`.
- **DB:** sao lưu `backups/dna_erp_truoc-migrate-dot6-2026-11-06.dump` và `backups/dna_erp_dongbo_truoc-migrate-dot6-2026-11-06.dump` → `prisma generate` +
  `migrate deploy` cả `dna_erp` lẫn DB thử đồng bộ `dna_erp_dongbo`.
- **Route bị gỡ:** không còn chỗ nào trong code A (BE, FE, kể cả phần đồng bộ dở) gọi 2 route cũ (FE service của B đã đổi). Chỉ bài e2e
  `e2e/full-flow.spec.ts` (file CHƯA theo dõi của phiên khác ở thư mục FE chính, dòng 514 + 649) còn bấm 2 route cũ → bài đó sẽ hỏng khi chạy, chưa sửa
  (không phải file của phiên này).
- **Kiểm:** worktree sạch `766f368`: `nest build` OK, `tsc` 2 lỗi seed cũ, `jest --runInBand` lần 1 có 1 ca hỏng (máy đang chạy song song bộ test thư
  mục chính - kiểu ca thời gian của bộ giải đã gặp ở QR mục 59), chạy lại **xanh hết (2745 / 2746, 1 skip)**. Thư mục chính (có đồng bộ dở): BE `tsc` 2
  lỗi seed cũ, jest `piece-sync-board` + `steel-issues` 153/153; FE `tsc` sạch, `vitest` 39 file / 415 test.
- **Production:** `GET https://dna-erp-be.onrender.com/api/v1/issue-slips` → **401** (route đã có) → Đợt 6 ĐÃ chạy trên Render (main tự deploy khi B
  push) - nên "5d–5e và Đợt 6 lên cùng một lần" coi như đã xảy ra; khoá cứng nằm trong code (không có công tắc cấu hình). Việc "nạp số đơn đặt hàng
  cuối năm 2026 từng NCC" B nêu là phần của B - đã báo người dùng.

## 30. Nhận file Excel kế hoạch của KHSX (mẫu cho Đợt 9) - phân tích + đã đổi cột file xuất theo file KH (Đợt 9 mục 10, đã commit + gộp 09/11 - mục 40) (06/11)

Người dùng gửi (theo danh sách IT xin ở mục 29): `TỔNG HỢP TIẾN ĐỘ DNA 6.11 (1).xlsx` (xem 3 sheet TIẾN ĐỘ MEYING 2024 / GOPLUS / NUU: "hàng đang cắt + đã
cắt + đóng gói chưa xuất cont"; "có 1 cái chưa cắt: LSX324 và 325"), `KH MEYING T10 2026.xlsx`, `KH MEYING T11 2026.xlsx`, `GOPLUS KH THÁNG 11-2026.xls`
(.xls cũ → Excel đổi sang .xlsx, tắt macro, chỉ đóng tiến trình Excel do script mở). Chép sang scratchpad `khsx-in/` rồi mới đọc (dữ liệu nội bộ, có tên người
ký - KHÔNG đưa vào repo).
- **3 sheet TIẾN ĐỘ:** theo dõi % từng LSX × mã: Cắt / Hàn / Sơn / Đan / Lấy về / Chuyển kiểm / Đóng gói, đã xuất, còn lại, ghi chú "ĐI CONT NGÀY …" -
  KHÔNG có ngày mốc. Đang chạy (MEYING): LSX313–320, 323, 326; LSX324, 325 (I41-A, I42-A, Phước An cắt) chưa cắt.
- **File KH (kế hoạch cắt sắt tháng, mỗi khách 1 file / tháng, có khối ký KH - Tài chính - QLSX - Giám đốc - các kho):** mỗi dòng LSX × SKU; cột: LỆNH SX
  ("MEYING LSX324"), SỐ PO, SKU khách, MÃ IEA, QTY, SỐ CONT, xưởng ("phước an cắt"), [T10 thêm: thiếu nệm / kính / thùng / hdlr; GOPLUS thêm: ĐI (EU), ITEM
  NO, NỆM], rồi **6 mốc**: NGÀY phôi xong (GOPLUS "CẮT XONG", gõ tay) → HÀN XONG `=+1,5` → xuất đan xong `=+1,5` → SƠN XONG (hàng trần) NHẬP KHO (GOPLUS
  "NHẬP KHO") `=+9` (có dòng +30, +9+5) → NK ĐỦ VẬT TƯ ĐÓNG GÓI `=xuất đan +6` (hoặc `=Sơn −5`) → đóng gói `=+2`; ngày dạng `mm-dd-yy`. → KHSX đang dùng
  **công thức dời mốc sau theo mốc trước** - khớp cách file xuất Đợt 9 phần 2 làm (công thức theo khoảng cách hiện có).
- **Đối chiếu với file xuất Đợt 9** (11 mốc của ERP, đã Sếp duyệt ở Đợt 3): KHSX chỉ có 6 mốc, ERP thêm Mua VT khung & đan, Bắt đầu Phôi, Sơn, Chuyền kiểm,
  Bắt đầu đóng gói. Ánh xạ chắc: phôi xong → Phôi, Hàn xong → Hàn, NK đủ VT đóng gói → Mua VT còn lại, đóng gói → Đóng gói. **Chưa chắc:** "xuất đan xong"
  (IT đoán = Khung) và "SƠN XONG (hàng trần) NHẬP KHO" (IT đoán = Nhập đan) - sheet TIẾN ĐỘ xếp Sơn TRƯỚC Đan nhưng file KH để "Sơn xong nhập kho" SAU
  "xuất đan".
- **Người dùng giải thích (06/11, cùng ngày):** quy trình là Phôi xong (gồm cắt, tán, uốn, dập…) → Hàn → Sơn → **xuất đan** = giao khung sắt ĐÃ SƠN + dây
  + đinh + vật tư đan (nút…) cho bên đan. → "xuất đan xong" = mốc **Khung** của ERP (schema: "Khung cơ khí" = xong cả chuỗi Phôi→Hàn→Sơn) - chốt, không
  hỏi lại. Sơn nằm giữa Hàn và xuất đan (file KH không có cột riêng, gộp trong +1,5 ngày); "Mua VT khung & đan" phải về trước xuất đan (dây, đinh đi theo
  khung). Cột "SƠN XONG (hàng trần) NHẬP KHO" (GOPLUS ghi gọn "NHẬP KHO") vì vậy gần như chắc = hàng đan lấy về nhập kho = **Nhập đan** (khớp cột "Lấy
  về" ở sheet TIẾN ĐỘ); chữ "Sơn xong (hàng trần)" có thể là tên cũ hoặc ý hàng không đan sơn xong nhập thẳng - còn hỏi 1 câu. Đã soát phép kiểm thứ tự
  mốc (`milestone-order.util.ts`): mọi dòng của file KH đi đúng chiều ERP (Mua VT còn lại chỉ cần trước Bắt đầu đóng gói, file KH để vật tư đóng gói về
  TRƯỚC hàng nhập kho 3 ngày - hợp lệ), nên không bị chặn khi nhập lại.
- **Đề xuất (chưa làm, chờ KHSX):** file xuất đặt tên / thứ tự cột theo file KH (LỆNH SX, SỐ PO, SKU khách, MÃ IEA, QTY, SỐ CONT, xưởng…), mốc ERP ghi kèm tên
  KHSX quen gọi; thêm cột chỉ xem PO / SKU khách / số cont / nệm nếu ERP có dữ liệu. Bản in "Kế hoạch cắt sắt tháng" có khối ký là việc riêng (hỏi).
- **Người dùng chốt tiếp (06/11):** "hàng trần" = hàng không đan, sơn xong là nhập kho đóng gói → cột "SƠN XONG (hàng trần) NHẬP KHO" = **Nhập đan**
  (chốt). Câu Số PO / SKU khách / số cont / nệm: "cứ làm theo thế cho KHSX dễ dùng" → **đã làm** ở nhánh `dot-9-sua-ke-hoach` (worktree
  `D:\DNA-ERP-BE-dot9` + `D:\DNA-ERP-dot9`), chưa commit - chi tiết + kiểm tra ở `changelog-2026-11-05-phan-a-dot-9.md` mục 10. Câu +1,5 ngày
  không cần hỏi: file đọc đúng ngày đang hiện trong ô.
- **Phát hiện lệch quyết định cũ (báo người dùng, chưa đổi):** file KH dùng **1 số LSX cho nhiều SKU** (MEYING LSX324 = I41-A + I42-A, LSX325 cũng
  vậy; GOPLUS LSX182 = 3 SKU J55.T6 / J55.C3) - còn ERP Đợt 2 chốt 04/11 "mỗi dòng SKU 1 số LSX riêng, không trùng" (`lsxCode` unique) → KHSX sẽ
  không gõ được LSX324 cho cả 2 SKU. Cần người dùng / anh Nhân quyết. **06/11: người dùng chọn hỏi anh Nhân** - IT soạn tin 2 phương án:
  (1) cho nhiều mã chung 1 số LSX nếu cùng 1 lệnh (KHSX gom cắt chung), 2 lệnh khác nhau vẫn không trùng - IT đề xuất, đúng cách KHSX đang làm;
  (2) giữ mỗi mã 1 số, KHSX thêm đuôi (LSX324-1, LSX324-2). Chờ trả lời, chưa đổi code. **→ 07/11 anh Nhân "ok" phương án 2**
  (tin Bảo "chốt option 2" - IT hiểu là câu này, người dùng không phản đối; không phải đổi code - mục 37). Dẫn chứng (ô cột A gộp nhiều dòng): KH MEYING T11 sheet
  "T10 (2)" dòng 3–4 (LSX324), 5–6 (LSX325); GOPLUS KH T11 sheet "KH T11 (2)" dòng 3–5 / 6–8 / 9–11 (LSX182/183/184, cùng 1 PO); TỔNG HỢP TIẾN ĐỘ
  sheet "TIẾN ĐỘ MEYING 2024" các lệnh đang chạy LSX317 (238–239), 319 (240–242), 320 (438–441, 4 mã), 323 (548–549) → 1 LSX nhiều mã là cách làm
  thường ngày, không phải ngoại lệ.
- **ERP chưa có dữ liệu:** SKU của khách / ITEM NO (không đưa vào file). Khác biệt giữ nguyên: file KH cho "NK đủ VT đóng gói" tự dời theo xuất đan
  (+6), ERP không dời 2 mốc Mua VT (Sếp chọn Q9-1).
- **Chưa làm:** file chiều dài cây sắt theo xưởng (Đợt 8) và sổ theo dõi sắt (định mức) chưa nhận.

## 31. Bảo trả lời 8 câu (file gửi Bảo Đợt 9 + Phần A còn lại) kèm anh Nhân chốt 07/11 - cập nhật kế hoạch, chưa code (07/11)

Người dùng gửi ảnh tin của Bảo + file `gui-bao-dot-9-va-phan-a-con-lai-2026-11-06-v2-TRA-LOI.docx` (Bảo ghi đủ 8 câu, đã cập nhật theo anh Nhân;
chép vào scratchpad `bao-tl-in/` rồi mới đọc - KHÔNG đưa vào repo). Tin nhắc 2 điểm đụng phần A: lưỡi máy tự động 3 mm; ngày chuyển 9 kho
**12/11/2026** (sớm hơn ~06/01/2027).

| Câu | Bảo / anh Nhân trả lời | Việc của A |
|---|---|---|
| 1 xưởng → kho Phôi | A (B đưa danh sách). Phú An → kho Phôi Phú An (tách `phoi-son-han` thành Phôi/Hàn/Sơn); Phước An → kho Phôi Phước An (mới; tồn Phước An chưa nhập, kiểm kê + nhập 12/11; tồn hiện có đều ở Phú An - anh Nhân 07/11). B làm lõi chia 9 kho xong 12/11 + cột "kho Phôi" ở bảng xưởng + hàm "xưởng → kho Phôi" (báo tên sau); chuyển mảnh bằng phiếu, xuất đan 2 phiếu làm sau | Đợt 8 gọi hàm của B (có sớm hơn dự kiến) |
| 2 chỗ dùng số cây sắt | B chỉ đọc `PurchaseProposalItem.buyQty` (+ `stockLengthMm`), không đọc `CuttingProposalLine.buyBars`; số mua = max(buyQty, orderQty), nguyên; đơn NCC + phiếu in; nhận hàng giữ chỗ PI tới buyQty, vượt vào tồn chưa giữ; đóng phần thiếu = buyQty − đã nhận. Đề xuất buyQty = số cây bảng cắt, số mua 3 mm vào orderQty. Anh Nhân 07/11: **laser 1 mm, máy tự động 3 mm (không phải 2,5)**, mua sắt luôn theo 3 mm, không nhân 1%, đúng sơ đồ cắt; mua dư vào tồn tự do; đổi chiều dài chuẩn → đề xuất chưa ký tính lại + báo người mua, phiếu đã ký giữ chiều dài cũ | Đợt 8 (thiết kế cập nhật ở kế hoạch mục 6). **Vướng:** đề xuất ghi số 3 mm vào `orderQty` đụng việc sửa câu 3 (xoá `orderQty` khi tính lại) - chốt với B |
| 3 tính lại làm số cần giảm | A sửa ở phần tính lại. Anh Nhân chốt cho **mọi vật tư**: phiếu chưa có Giám đốc ký → bỏ số người mua đã tăng, quay về số mới, báo người mua nhập lại; phiếu đã ký → báo người mua + Giám đốc, người mua tự quyết phiếu thay thế / nhận đủ, dư vào tồn tự do. B xác nhận lỗi có thật (orderQty 110 giữ nguyên khi buyQty tính lại = 50, không báo ai); phần phiếu đã ký B làm, A gọi 1 hàm B viết sẵn | **Việc mới của A, làm được ngay** (phần phiếu chưa ký); chỗ tính lại: `cutting-proposals.service.ts` (sắt) + `consumable-material-purchase.service.ts` (vật tư khác) |
| 4 đồng bộ mảnh bước 2 + chuyển mảnh bằng phiếu | A: hai bên ngồi 30 phút chốt cách làm trước | Hẹn B; mức 2 vẫn chờ 6 câu anh Nhân |
| 5 màn thêm xưởng | Anh Nhân 07/11: **không cần**; IT thêm tay; xưởng mới = 1 kho Phôi + 1 kho Hàn riêng, Sơn / phụ kiện / thành phẩm dùng kho chung Phú An | Bỏ khỏi việc A |
| 6 đường vào màn nhận hàng | `/?m=inbound_warehouse&p=nhap-kho`; B sẽ thêm `&focus=MATERIAL:<materialId>`; tài khoản Mua hàng bị khoá phân hệ kho → nút "Nhập kho" chỉ hiện cho thủ kho | Nút "Nhập kho" ở Vật tư cần về (Đợt 4), chỉ thủ kho |
| 7 số mua theo SKU của lệnh gộp | Không có và không định có (05/11 chốt chặn ở bước xuất, SKU cần sớm ưu tiên); anh Nhân 07/11: hiện số chung, ghi thêm SKU nào ưu tiên trước là đủ (thứ tự = `ranksBefore` ở `stock/sku-priority.util.ts`) | Tuỳ chọn nhỏ ở Vật tư cần về |
| 8 thông báo bên B còn mã PI | Còn - B tự đổi (cần mua, sắp về, Sếp duyệt, hàng về, đủ hàng, sắt đã xuất, Phôi nhận sắt); link `focus=PI_CODE:…` vẫn giữ mã PI | A đổi thông báo của A (việc treo cũ), giữ link PI |

- **Câu 2.5 của anh Nhân** (file câu hỏi 04/11) coi như đã trả lời qua câu 3. **Câu 2.4** (xưởng dự kiến lúc tính cắt) vẫn chờ → Đợt 8 vẫn chờ.
- **Lưỡi máy tự động 3 mm:** chỉ là số ở Cấu hình (Admin → MC Tự động → "Lưỡi cắt (mm)"), không cần code; ai có quyền Admin đổi trên bản
  chạy thật (IT không tự đụng production). Bảng cắt của lệnh đã tính trước đó vẫn theo 2,5 mm.
- Đã cập nhật: kế hoạch Phần A mục 6 (Đợt 8, khối "Cập nhật 07/11"), mục 8 điểm ghép ⑤, mục 10 câu 1; ghi nhớ sắt / Phần A.
- **Chưa làm:** mọi việc code ở cột "Việc của A" - chờ người dùng chọn thứ tự.

## 32. Rà lại "cộng 1% khi mua vật tư" - code đúng chốt, dữ liệu thật còn lệch bảng % (script Đợt 0 của B chưa chạy trên bản 26/10) (07/11)

**Vì sao:** người dùng hỏi lại: "tôi nhớ có bảo là cộng thêm 1% khi mua vật tư mà? 1% này dựa theo số % hao hụt được config của vật tư có
sẵn, hãy review lại chỗ nhập vật tư" - sau khi mục 31 ghi "mua sắt luôn theo 3 mm, không nhân 1%". CHỈ RÀ, không sửa code / dữ liệu.

**Kết quả rà:**
- **Có 2 thứ "1%" khác nhau.** (a) `Material.purchaseWastePercentage` = "% dự trù hao hụt khi mua" nhập ở Admin → Danh mục vật tư (cột "%
  hao hụt", ô form "% dự trù hao hụt khi mua"), cộng vào số mua của **mọi vật tư trừ sắt phần mềm** theo công thức anh Nhân chốt V3-3 (04/11):
  `số mua = nhu cầu × (1 + %) − tồn khả dụng` (`common/utils/purchase-waste.util.ts`), dùng ở cả 3 luồng: vật tư tiêu hao
  (`consumable-material-purchase`), vật tư thành phẩm theo mảnh (`piece-material-yield-purchase`), vật tư thành phẩm không gắn mảnh
  (`material-yield-recipe-purchase`). (b) "1%" của **sắt cắt bằng phần mềm** = NGƯỠNG phần thừa trên mỗi cây khi cắt (tề + cùi ≤ 1%, cây 6000
  dùng ≥ 5940), không phải đệm mua: form ẩn ô % với sắt nhóm con "Phần mềm" và BE ép trống (`MaterialsService.resolveWasteFields`); số cây mua
  lấy từ bài toán cắt (`cutting-proposals`), không cộng %. Chốt: Sếp 31/10 "Vậy là đủ ko cộng thêm 1% đề xuất sắt nữa", anh Nhân "ko cộng thêm
  lúc mua" (changelog tài liệu nghiệp vụ mục 13, V4-4), vòng 4 02/11 (mục 15) và 07/11 (mục 31 ở đây) lặp lại. → câu "không nhân 1%" CHỈ nói
  sắt phần mềm; vật tư khác vẫn cộng % của chính vật tư.
- **Bảng % anh Nhân chốt (v8 mục 7.9, vòng 3–4):** sắt (trừ sắt phần mềm), la tấm, thép dây 1% · dây đan 1% · bulon, đinh, nút, tán 1,5% ·
  carton, thùng, tem, nhãn, gối, HDLR 0% · sơn, xốp, nệm và loại còn lại 1,5%. B đã viết script nạp bảng này (Đợt 0, `c6bffef`,
  `prisma/apply-purchase-waste-defaults.ts`, mặc định chỉ xem trước, `--apply` mới ghi, có file hoàn tác).
- **Dữ liệu thật lệch bảng:** đếm trên `dna_erp` (backup production 26/10): sắt tự tính 7 + VTTP 19 đều 1% (đúng); đinh 3, nút nhựa 19, tán
  3 đều 1,5% (đúng); sắt phần mềm 20 trống (đúng); **dây đan 14 đều 0%** (chốt 1%), **nệm 9 đều 0%**, **sơn 2 đều 0%**, phụ kiện 161/233 0%,
  bao bì 31/55 0% (chốt 1,5% hoặc 0% theo loại). Chạy script ở chế độ xem trước (không `--apply`, DB máy): 384 vật tư, bỏ 20 sắt phần mềm,
  **sẽ đổi 125** (101 × 0 → 1,5; 14 dây đan 0 → 1; 6 × 1 → 1,5; 4 × 1,5 → 0) - đúng số review 04/11 (changelog tài liệu nghiệp vụ mục 17).
  Nghĩa là trên bản 26/10 script CHƯA chạy; production sau 04/11 thì chưa biết (IT không có quyền xem).
- **2 điểm review 04/11 vẫn mở** (trước khi chạy `--apply`): script ghi đè cả số Admin đã đặt tay (6 vật tư 1 → 1,5, 4 tem/nhãn 1,5 → 0); khoảng
  30 vật tư lót / giấy lót / góc giấy (carton) và mặt bàn gỗ rơi vào 1,5% "còn lại" trong khi carton chốt 0%. Thêm: vật tư mua theo đơn vị
  nguyên có "làm tròn lên" thì tồn vừa đủ vẫn sinh 1 đơn vị mua (cần 10, tồn 10, 1% → mua 1).

**Người dùng chốt (07/11):** "mấy cái đó không quan trọng, vô màn quản lý vật tư sửa được" → KHÔNG hỏi B, không chạy script; % của từng
vật tư do người dùng / Admin tự sửa ở Admin → Danh mục vật tư (có cả nút sửa % hàng loạt) khi cần. Đóng mục này.
**Xem màn thật (07/11, FE 3130 + BE 3031 DB `dna_erp_dongbo`, tài khoản demo `admin`, không lưu gì):** Danh mục hệ thống → Vật tư → lọc Sắt
(46): Sắt nhóm con "Phần mềm" (vd SAT-047) form KHÔNG có ô %, cột "% hao hụt" = "—"; Sắt "Vật tư thành phẩm" (vd SAT-051) có ô "% dự trù
hao hụt khi mua" = 1 + "Làm tròn khi mua", cột "1% · mua". Hộp "Sửa hao hụt hàng loạt": "Theo từng vật tư" bỏ sắt phần mềm khỏi danh sách,
còn Tự tính / VTTP chọn được; "Theo cả nhóm vật tư" khoá hẳn nhóm "Sắt (KHSX quyết định)" dù 26 vật tư Tự tính / VTTP trong nhóm vẫn sửa
được (BE `bulkUpdateWaste` vốn đã bỏ qua sắt phần mềm) - lỗi giao diện nhỏ → **đã sửa ở mục 33** (đã deploy production 07/11). Kết quả xem trước lưu ở
scratchpad `dot9p3/waste-preview.txt` (không đưa vào repo).

## 33. Sửa % hao hụt hàng loạt: chọn được nguyên nhóm Sắt (bỏ qua sắt phần mềm) - FE, nhánh `sua-hao-hut-nhom-sat`, đã gộp `demo` + deploy production (07/11)

**Vì sao:** rà ở mục 32 thấy hộp "Sửa hao hụt hàng loạt" → "Theo cả nhóm vật tư" khoá hẳn nhóm "Sắt (KHSX quyết định)", trong khi 26 vật tư
Sắt "Tự tính" / "Vật tư thành phẩm" của nhóm vẫn có % hao hụt khi mua, phải tick tay từng cái. Người dùng: "hãy thực hiện".

**Đã làm (chỉ FE, BE không đổi vì `MaterialsService.bulkUpdateWaste` vốn đã bỏ qua sắt phần mềm và trả `skippedSteel`):** nhánh mới
`sua-hao-hut-nhom-sat` (từ `demo` `4b53d48`), worktree `D:\DNA-ERP-hao-hut` (node_modules nối sang thư mục chính bằng junction; Turbopack không
chạy với junction nên chạy thử bằng `next dev --webpack`, cấu hình `fe-3130-hao-hut` trong `.claude/launch.json`).
- `src/modules/pages/Admin/masterData/MaterialsBulkWasteModal.tsx`: bỏ `disabled` của nhóm Sắt, nhãn đổi "Sắt (trừ sắt phần mềm)"; đếm số vật tư
  theo nhóm chỉ tính vật tư sửa được (`editableInGroup`) + ghi "· bỏ qua N sắt phần mềm"; nút Áp dụng không còn khoá khi chọn nhóm Sắt; câu ghi
  chú đầu hộp sửa "chọn cả nhóm Sắt thì chỉ sửa 2 loại này"; sửa chú thích cũ (BE ghi `purchaseWastePercentage`, không phải ngưỡng cắt).
- `src/modules/pages/Guide/content/materialsShared.ts` (bài "Sửa hao hụt hàng loạt"): dòng "Theo cả nhóm vật tư", ghi chú bảng, lỗi "Nút Áp dụng
  bị mờ" theo cách mới.

**Kiểm tra:** `tsc --noEmit` sạch; eslint 2 file: 0 lỗi (1 cảnh báo cũ có sẵn `singleGroupIdOfSelection` không dùng); vitest Guide 16 test đạt.
**Thử thật** (FE 3130 nhánh này + BE 3031 DB thử `dna_erp_dongbo`, tài khoản demo `admin`): chọn nhóm Sắt → hiện "26 vật tư trong nhóm này · bỏ
qua 20 sắt phần mềm", "Áp dụng cho 26 vật tư", nút bật; áp 1% (bằng số đang có, dữ liệu thử không đổi giá trị) → `PATCH /materials/bulk-waste`
200 `{updated: 26, skippedSteel: 20}`; DB: Tự tính 7 + VTTP 19 = 1%, sắt phần mềm 20 vẫn trống.

**File để commit (FE):** 2 file trên. **Không commit:** `next-env.d.ts` (next dev tự sửa), `tsconfig.tsbuildinfo`, `.env` của worktree.

**Commit + gộp (07/11, người dùng: "Commit + gộp"):** commit `ba879a9` trên nhánh `sua-hao-hut-nhom-sat` (chỉ 2 file trên; không đưa
`next-env.d.ts`, `tsconfig.tsbuildinfo` do máy tự sinh), gộp `--no-ff` vào `demo` ở thư mục chính FE → `1a28c83` (trên Đợt 7 `3f2ffa8`, không trùng
file nào). Sau gộp `tsc --noEmit` FE sạch. Việc đồng bộ đủ công đoạn đang sửa dở ở thư mục chính FE không bị đụng. Chưa push lúc đó.

**Deploy (07/11, người dùng: "deploy"):** `git fetch` thấy `origin/demo` vẫn ở `3f2ffa8` (không có gì mới hơn) → `git push origin demo`
(`3f2ffa8..1a28c83`, chỉ 2 commit trên). Vercel dựng bản Production từ `demo` (đối chiếu lịch sử deployment GitHub: các bản Production trước đều là
đỉnh `demo`) → deployment `1a28c83` trạng thái **success** ("Deployment has completed", 06:17 UTC). BE không đổi nên không đụng Render / DB production.
Chưa thử trên production bằng tài khoản thật (cần đăng nhập) - người dùng tự xem màn Quản lý vật tư.

## 34. Kéo Đợt 7 của người B (chia 9 kho - phần lõi) về thư mục chính + migrate 2 DB trong máy (07/11)

Người dùng gửi ảnh tin Bảo ("Đợt 7 (9 kho) đang trên nhánh, chưa push… hàm `phoiWarehouseOfWorkshop(db, workshopId)` trong
`src/modules/stock/workshop-warehouse.util.ts`… em có sửa vào code bên Sang…") + "pull nhánh mới trước".
- **Thực tế:** B đã gộp + **push** lúc 10:16–10:17 07/11 (BE `57dfb68` → gộp `a761af8` trên `origin/main`; FE `87bd0f4` → `3f2ffa8` trên
  `origin/demo`) - tin nhắn ghi "chưa push" là cũ. `origin/main` tự deploy Render → migration 9 kho đã lên production (đổi tên kho
  `phoi-son-han` thành "Kho Phôi Phú An", thêm 4 kho Hàn PA / Sơn PA / Phôi PhA / Hàn PhA, gắn loại kho + xưởng); chuyển tồn thật là script
  `prisma/split-warehouses.ts` B chạy ngày kiểm kê 12/11 - IT KHÔNG chạy.
- **Kéo về:** fast-forward thư mục chính BE `main` 766f368 → `a761af8`, FE `demo` 4b53d48 → `3f2ffa8`; không file nào trùng việc đang sửa dở
  (so `git status` + `git diff` trước/sau: y nguyên). Không trùng nhánh `dot-9-sua-ke-hoach` (phần 3 chỉ `deadline-plan-excel`) và nhánh FE
  `sua-hao-hut-nhom-sat`.
- **DB:** sao lưu `backups/dna_erp_truoc-migrate-dot7-2026-11-07.dump`, `backups/dna_erp_dongbo_truoc-migrate-dot7-2026-11-07.dump` (đọc lại được),
  `prisma migrate deploy` cả `dna_erp` + `dna_erp_dongbo` (`20261107090000_warehouse_kind_workshop`), `prisma generate`; đủ 9 kho thật, đúng xưởng.
- **Kiểm tra:** CI GitHub của `a761af8` lint / test / build xanh; ở máy `tsc --noEmit` chỉ còn 2 lỗi cũ ở seed, `nest build` đạt; FE `tsc` sạch.
  Em còn chạy jest 11 thư mục (42 bộ / 1209 test, đạt) + vitest 2 file (19 đạt) - **thừa** vì CI đã chạy đủ, lại làm đơ máy người dùng
  ("chạy gì nhiều test dữ vậy, làm máy tôi bị đơ") → từ nay: code B đã push thì xem CI, ở máy chỉ tsc / nest build; test chỉ spec của file
  đổi, `--maxWorkers=2` (ghi nhớ `test-it-va-gioi-han-worker`).
- **B sửa vào code của A (để ý khi gộp các nhánh A):** duyệt phương án cắt (`cutting-proposals.service.ts`), 3 luồng tính đề xuất mua (ghi thêm
  `receiveWarehouseCode` khi kho nhận khác mặc định - Phước An), `changeWorkshop` (tạm chặn đổi xưởng khi đã giữ chỗ hoặc đang mua), người nhận
  thông báo đổi mốc (`recipient-resolver`). Hàm cho Đợt 8: `phoiWarehouseOfWorkshop(db, workshopId)`.

## 35. Kéo commit Đợt 7 bổ sung của người B (đá cắt kho Phôi → kho Hàn) + dựng DB test riêng cho test tay trên trình duyệt (07/11)

**DB test riêng (người dùng: "chạy test trực tiếp từ đầu tới cuối… bằng mcp trên browser app", rồi "tạm dừng vì Bảo sắp commit"):**
- Tạo `dna_erp_e2e` từ `backups/local_dna_erp_20261028_prod-sach-truoc-e2e.dump` (production 26/10 + mật khẩu demo, `pg_restore` thẳng trong
  container) → `prisma migrate deploy` áp 14 migration mới (Đợt 1 → Đợt 7) → đủ 173 migration, 54 tài khoản, 384 vật tư, 16 SKU, 3 khách, 0 đơn,
  9 kho thật đúng loại. KHÔNG đụng `dna_erp` / `dna_erp_dongbo`.
- Cấu hình chạy mới trong `.claude/launch.json`: `be-3040-e2e-tay` (dist thư mục chính, DB `dna_erp_e2e`, tắt DAILY_JOBS / FLOOR_ALERTS, giới hạn
  đăng nhập nới) + `fe-3140-e2e-tay` (thư mục chính FE, `.next-e2e`). Solver trỏ `localhost:18080` (không gọi production).
- Mới mở tới trang đăng nhập thì người dùng bảo tạm dừng → đã tắt BE + FE, giữ DB. **Chưa test bước nào.**
  **Sau khi kéo code B: đã test tay nửa đầu luồng (07/11) - kết quả + phát hiện ở `changelog-2026-10-28-e2e-tren-backup-production.md`
  mục 18.**

**Kéo code B (người dùng: "pull"):** fast-forward BE `main` `a761af8` → `f27b284` ("Đợt 7: xếp vật tư theo trả lời anh Nhân + chuyển đá cắt kho Phôi
sang kho Hàn" - `issue-slips`, `warehouse-transfers`, `prisma/split-warehouses.ts`), FE `demo` `1a28c83` → `c373e11` (gộp `6c35f4c`: kho Phôi chuyển
đá cắt sang kho Hàn + Dùng chung từ tồn kho mình - 3 trang InboundWarehouse). Không trùng file đang sửa dở (`git status` trước/sau y nguyên),
**không có migration** → không sao lưu / migrate DB. Không đụng code A.
- **Kiểm tra (theo ghi nhớ test ít):** CI GitHub `f27b284` lint / test / build xanh; Vercel production `c373e11` success (bản này gồm cả mục 33). Ở máy
  chỉ `nest build` đạt + FE `tsc --noEmit` sạch; không chạy jest / vitest.
- `prisma/split-warehouses.ts` vẫn là việc B chạy ngày 12/11 - IT không chạy.

## 36. Kéo Đợt 7 bổ sung lần 2 của người B (1 người giữ nhiều kho - đổi "kho đang làm"; chặn xoá 4 kho mới) + migrate 3 DB trong máy (07/11)

Người dùng: "pull nhánh mới rồi tiếp tục test".
- **BE** `main` `f27b284` → `f457bb9` (`edd8e4c` "1 người giữ nhiều kho - đổi kho đang làm không cần đăng xuất": auth switch-warehouse, users
  `warehouseScopes`, recipient-resolver; `f457bb9` chặn xoá/đổi mã 4 kho mới). Có migration `20261107120000_user_warehouse_scopes` (chỉ thêm cột
  `users.warehouseScopes TEXT[]`). Không trùng file đang sửa dở. CI GitHub lint / test / build xanh.
- **FE** `demo` `c373e11` → `0d04699` (ô "Kho đang làm", Admin gán thêm kho, Hướng dẫn theo 9 kho). **Trùng 1 file đang sửa dở:**
  `Guide/content/productionPlan.ts` (phần "Đồng bộ Phôi – Hàn" chưa commit ở dòng ~83; B sửa chữ kho ở dòng ~402–426 - khác chỗ). Không stash /
  commit: lưu bản sao + `git diff --output` patch ở scratchpad `pull-0711b/` → `git apply --reverse` → `pull --ff-only` → `git apply --3way` (sạch)
  → `git restore --staged` (apply 3way tự stage) → file có đủ 2 phần, trạng thái như trước. Vercel `0d04699` success.
- **DB:** sao lưu `backups/{dna_erp,dna_erp_dongbo,dna_erp_e2e}_truoc-migrate-kho-dang-lam-2026-11-07.dump` → `prisma migrate deploy` cả 3 →
  `prisma generate` → `nest build` đạt; FE `tsc` sạch. Khởi động lại BE 3040 (test tay) chạy dist mới.
- Không chạy test jest/vitest (theo ghi nhớ test ít - CI đã chạy).

## 37. Cập nhật file Word hướng dẫn test Phần A theo việc sau 06/11 (09/11)

Người dùng: "Cập nhật luôn" (sau khi hỏi lại file Word ghi chức năng + business rule Phần A). Sửa
`.claude/tools/huong-dan-test-phan-a/build_test_guide.py` → dựng lại `docs/huong-dan-test-phan-a-2026-11-05.docx` (giữ tên, không commit; bản trước lưu ở
scratchpad `hdtest-0911/truoc-sua.docx`). 21 trang, đã xem từng trang qua PDF.
- **Ngày cập nhật 09/11**; bảng trạng thái mục 0: Đợt 9 tách "phần đổi cột Excel (06/11) đã làm trên bản thử, **chưa cập nhật lên hệ thống**" (BE
  `D:\DNA-ERP-BE-dot9` còn sửa dở `deadline-plan-excel.service.ts` + spec, chưa commit); thêm dòng "Sửa nhỏ" (% hao hụt hàng loạt, mục 33 - đã lên hệ
  thống 07/11); dòng "Chưa làm" thêm "tính lại số mua khi nhu cầu giảm" (mục 31 câu 3). R9.14 ghi rõ chưa lên hệ thống.
- **Mục 8 mới** "Sửa nhỏ – % hao hụt hàng loạt theo cả nhóm Sắt": trước / sau, RH.1–RH.3 (công thức số mua × (1 + %) − tồn; sắt phần mềm không cộng %;
  sửa theo nhóm Sắt bỏ qua sắt phần mềm), TCH.1–TCH.3. Kết quả TCH.3 theo code FE: Áp dụng xong hộp đóng + danh sách tải lại, không có câu báo
  (`MaterialsPage.tsx` chỉ ghi nhật ký + `refetch`). Số 26 / 20 lấy từ lần xem màn thật 07/11 (mục 32) - ca test ghi theo công thức N + M = số sắt.
- **Mục 9 (cũ là 8) "Chờ chốt + còn treo"**, mục ghi lỗi thành mục 10 (sửa câu dẫn "mục 10" ở đầu file):
  - 9.1: câu 2.5 → đã chốt 07/11 (phiếu chưa ký / đã ký), chưa làm; 2.4 vẫn chờ; 2.1–2.3 ghi "chưa trả lời, đang làm mặc định"; thêm dòng **LSX**
    (phương án 2, giữ R2.1 / R2.2), **Xưởng** (không làm màn thêm xưởng), **Lưỡi cắt** (máy tự động 3 mm - số ở Cấu hình, Admin đổi), **Lệnh gộp**
    (giữ số chung + ghi SKU ưu tiên, chưa làm).
  - 9.2: thêm "Chung: 12/11 chuyển 9 kho, tên kho trong ca test sẽ đổi"; Đợt 2 bỏ "chưa có màn quản lý xưởng", thêm ví dụ PI còn sót; Đợt 10a thêm kết
    quả test tay 07/11 (kho xuất ở màn cũ → booking báo vượt / thiếu, khoá Lưu - chờ 10b); Đợt 4: "đóng phần thiếu" người B đã làm (đã soát code:
    `closeShortage` đặt dòng `PURCHASED`, `materials-due` chỉ lấy NEW / QUOTING / SUBMITTED / PURCHASING → dòng đã đóng tự ra khỏi danh sách, phần đặt lại
    là dòng NEW mới), nút "Nhập kho" từ Vật tư cần về chưa làm; Đợt 9: sửa câu cũ "chưa có file Excel mẫu" (mâu thuẫn với R9.14) thành "đã đổi cột, chưa
    lên hệ thống, file cũ phải tải lại".
- Không đụng code chương trình, không commit.

## 38. Kéo Đợt 10b + thông báo LSX / nhu cầu giảm + link mở thẳng dòng nhận hàng của người B; migrate 3 DB trong máy (09/11)

Người dùng: "pull nhánh mới nhất trước".
- **BE** `main` `f457bb9` → `8a58e2b`: `6acd06c` (thông báo Mua hàng / Kho ghi số LSX, link giữ mã PI; hàm `notifyPurchaseDemandDropped()` +
  loại `PURCHASE_DEMAND_DROPPED` - báo người mua + Giám đốc khi tính lại làm nhu cầu giảm dưới số đã có phiếu ký, ghi chú "Người A gọi …
  từ phần tính lại", chưa nơi nào gọi), `72bb86e` + gộp `8a58e2b` (Đợt 10b: `/booking-shipments` - kho TP xác nhận xuất theo booking, giữ số
  phiếu XK, ảnh phiếu ký bắt buộc, chặn vượt số còn của booking và vượt hàng sẵn (đã đóng gói − đã xuất), booking → SHIPPED, thông báo
  `BOOKING_TO_SHIP` / `BOOKING_SHIPPED`; **bỏ route "Xuất giao" theo dòng đơn**). Migration `20261109090000_booking_shipment` (chỉ thêm 5 cột
  vào `bookings` + 2 unique index).
- **FE** `demo` `0d04699` → `71d68a6`: `a20f437` (Nhập kho mở thẳng dòng qua `focus=MATERIAL` / `SUPPLIER_ORDER`), `00595e2` + gộp (phần
  "Xuất hàng theo booking" ở Xuất theo đơn hàng, in phiếu 02-VT, bỏ luồng giao từng dòng đơn, Hướng dẫn viết lại bài xuất hàng).
- Cả 2 repo **không trùng file nào** với phần đang sửa dở (BE: các changelog + `src/app.module.ts`; FE: đồng bộ Phôi – Hàn, `quy-doi-doan-phoi.md`,
  e2e, `CuttingSolvePanel.tsx`, `GomDotCatPage.tsx` …) → `git pull --ff-only` thẳng, không cần patch; phần sửa dở còn nguyên.
- Docker Desktop đang tắt (máy khởi động lại) → bật lại; lần chạy đầu tạo 1 file sao lưu rỗng (pg_dump lỗi kết nối) - đã xoá, chạy lại.
- **DB:** sao lưu `backups/{dna_erp,dna_erp_dongbo,dna_erp_e2e}_truoc-migrate-dot10b-2026-11-09.dump` (đọc lại bằng `pg_restore -l`, 1276 mục mỗi
  file) → `prisma migrate deploy` cả 3 đạt → `prisma generate` → `nest build` đạt; FE `tsc --noEmit` sạch. Không chạy jest / vitest (ghi nhớ
  test ít): CI GitHub của `8a58e2b` build / test / lint **success**; Vercel `71d68a6` success. B push `main` là Render tự deploy → 10b đã lên
  production.
- **Ảnh hưởng việc phần A:** (1) "tính lại số mua khi nhu cầu giảm" (mục 31 câu 3) hết chờ - hàm báo phiếu đã ký của B có sẵn, A chỉ cần gọi từ
  phần tính lại; (2) nút "Nhập kho" ở Vật tư cần về (câu 6) hết chờ - link `focus=MATERIAL` đã có; (3) câu 8 (thông báo bên B còn mã PI) xong
  phía B; (4) lỗi booking thấy khi test tay 07/11 (e2e changelog 18.2, ảnh 17) không còn đường xảy ra vì nút xuất cũ đã bỏ - cần test lại luồng
  booking → kho xuất; lỗi xuất carton (ảnh 16, `PackagingIssuesService`) không đụng tới, vẫn còn.
- File Word hướng dẫn test Phần A cập nhật theo (ngày "09/11 (lần 2)"; 9.1 câu 2.5, 9.2 Đợt 2 / 10a / 4) - 21 trang, đã xem trang 20.
- BE 3040 / FE 3140 (test tay) không còn chạy sau khi máy khởi động lại - chưa bật lại.

## 39. Sửa sau buổi test tay 07/11: tính lại số mua khi nhu cầu giảm, nút Nhập kho ở Vật tư cần về, thông báo số LSX, gom lỗi giao diện + 2 file xác nhận - nhánh `sua-sau-test-tay`, đã commit + gộp + deploy production (09/11)

Người dùng: "những cái làm được ngay thì làm luôn, còn phần nào cần confirm thì báo lại tôi và làm thành file để tôi đem confirm" (sau khi IT trình
cách giải quyết lỗi test tay 07/11 - e2e changelog mục 18 - và phần "đã chốt, làm được ngay").

**Nhánh / môi trường:** `sua-sau-test-tay` ở BE (từ `main` `8a58e2b`, worktree `D:\DNA-ERP-BE-sua0911`) và FE (từ `demo` `71d68a6`, worktree
`D:\DNA-ERP-sua0911`), node_modules nối junction; DB thử `dna_erp_sua0911` (chép `dna_erp_e2e` 09/11 = production 26/10 + dữ liệu test tay);
`.claude/launch.json` thêm `be-3041-sua0911`, `fe-3141-sua0911`. Chia 4 thợ song song, không chung file (Opus review diff thật + chạy lại kiểm tra).

**1. Tính lại số mua khi nhu cầu giảm (anh Nhân chốt 07/11, mục 31 câu 3) - BE**
- Helper mới `src/common/utils/purchase-recompute.util.ts` (+ spec): ranh giới **đã ký** = PURCHASING (sau "Sếp đã duyệt") + PURCHASED; **chưa ký** =
  NEW / QUOTING / SUBMITTED / REJECTED. Dòng chưa ký: ghi số mới; nhu cầu GIẢM mà người mua đã tăng `orderQty` → `orderQty = null` + thông báo mới
  `PURCHASE_ORDER_QTY_RESET` ("Số cần mua … giảm còn … - nhập lại số mua", thêm "- phiếu đã in, cần in lại" khi SUBMITTED); tăng thì giữ `orderQty`.
  Dòng đã ký: KHÔNG sửa số; phần thêm (nếu nhu cầu tăng) vào dòng chưa ký / dòng NEW mới; nhu cầu giảm → `notifyPurchaseDemandDropped()` của B (sau
  commit). Gửi thông báo best-effort sau transaction, dedupe theo (PI, vật tư).
- 3 luồng vật tư không phải sắt (`consumable-material-purchase`, `piece-material-yield-purchase`, `material-yield-recipe-purchase`): gom mọi dòng cùng
  khoá rồi dùng helper. **Lỗi thấy khi đọc code, đã sửa:** 3 luồng này trước đây ghi đè `buyQty` lên cả dòng PURCHASING (đã ký).
- Sắt (`cutting-proposals.service.ts`): "đã chốt" đổi từ "khác NEW" thành "đã ký" (PURCHASING tính theo `effectiveOrderQty`, PURCHASED theo
  `receivedQty`); phần kế hoạch ghi vào dòng chưa ký đầu tiên (trừ số của dòng chưa ký còn lại để không đếm đúp); cùng luật xoá `orderQty`.
- **Opus sửa thêm khi review:** (a) điều kiện "nhu cầu giảm dưới số đã ký" so với số CẦN MUA lúc ký (`buyQty`), không so với số thực mua (`orderQty`
  người mua làm tròn lên) - nếu không, cần 406 mua tròn 450 thì lần tính lại nào cũng báo sai; (b) sắt: không báo khi chỉ còn dòng PURCHASED nhận vượt
  (nhận vượt là cho phép, không còn việc gì cho người mua) - cờ `alertDemandDropped`; thêm 4 ca test cho 2 điểm này.
- Thông báo mới `PURCHASE_ORDER_QTY_RESET` ở `notification-types.ts` (FE không có danh sách loại phải khai).

**2. Vật tư cần về (mục 31 câu 6, 7) - BE `materials-due` + FE `MaterialsDue`:** nút **"Nhập kho"** chỉ cho thủ kho (WAREHOUSE_STAFF, phân hệ kho, dòng
PURCHASING, đúng kho đang làm) → `?m=inbound_warehouse&p=nhap-kho&focus=SUPPLIER_ORDER:<id>` (chưa có đơn thì `MATERIAL:<id>`, link B làm 09/11);
lệnh gộp ghi "Hàng về chia trước cho …, rồi …" theo `ranksBefore` (số LSX); ô lọc kho hiện tên kho ở mọi tab (BE trả `warehouseScopeName`).

**3. Thông báo mã PI → số LSX (mục 31 câu 8):** thêm 13 loại bên Kế hoạch / Sản xuất / KCS + loại mới vào `LENH_CODE_TYPES` của B
(`notifications.service.ts`) - không viết cách riêng; bỏ 2 loại `WAREHOUSE_TRANSFER_*` (tham số là `code` mã phiếu CK, không có piCode). Tin sáng sản
xuất (`daily-jobs` `productionDigest`) dùng `displayCode` (số LSX) thay mã PI.

**4. Gom lỗi giao diện phần A (FE, 35 file):** ĐVT sắt "đoạn"; "chờ KHSX duyệt"; chữ Tạm lưu; Duyệt SKU hiện "Chờ duyệt mảnh / chi tiết" (`SkuStatusBadge`,
cùng điều kiện ô đếm); danh sách định mức cột "Khách hàng", "Đang nhập (nháp)"; định mức chi tiết giữ tab; Tạo PO nút Lưu mờ + "Còn thiếu: …"; chi tiết đơn
không lặp "X — X", thêm SL; bỏ chữ "PI" ở Tạo lệnh, Gửi QLSX, QLSX / Sếp, hàng đợi tổ QLSX (`useLenhCodeLookup` / `LenhCode`), KCS, Phôi, và 9 màn kho
(chỉ chữ, mỗi chỗ 1 dòng - phần của B, báo khi gộp); KCS phụ đề "báo lúc …", cột "Mảnh", cột "Lệnh" (Opus đổi từ "PO" thợ đặt - giá trị là số LSX);
ngày Phôi "dd/MM"; Tối ưu cắt sắt thêm tên loại sắt; kho thành phẩm chính lên đầu; đăng nhập "Database error" → lời thường.

**Kiểm tra:** BE `tsc --noEmit` sạch (trừ 2 lỗi cũ `prisma/seed-*`), `nest build` đạt, jest 10 suite 404 test (helper, cutting-proposals, 3 luồng mua,
purchase-proposal-notify, materials-due, notifications, daily-jobs) + sau sửa của Opus 5 suite 266 test đạt; FE `tsc` sạch, eslint 0 lỗi, vitest
MaterialsDue 18. **Chạy thật** (BE 3041 + FE 3141, DB `dna_erp_sua0911`, gọi 3 service tính mua cho lệnh GP-182): NN-004 chưa ký 406 + người mua tăng
500, kho có 106 → `buyQty` 300, `orderQty` bỏ, thông báo "Số cần mua NN-004 giảm còn 300 Cái - nhập lại số mua" / "GP-182: …" (số LSX); NN-005 đã ký
406 mua tròn 450 → giữ nguyên, không báo; NN-017 đã ký 406, kho có 106 → dòng giữ 406 (trước đây bị ghi đè), thông báo "GP-182: NN-017 chỉ còn cần 300
Cái, đã ký mua 406"; chạy lại lần 2 không đổi gì, không thêm thông báo / dòng. Vật tư cần về (`khovttp`, mở lại GP-182 tạm trên DB thử): nút "Nhập kho" chỉ ở
2 dòng đã ký, bấm mở Nhập kho đúng dòng (tô viền); ô lọc "Kho Phụ kiện". Tạo PO (`sales`): "Còn thiếu: Mã đơn hàng, Khách hàng, SKU", nút Lưu mờ.
Dữ liệu thử đã sửa (chỉ DB `dna_erp_sua0911`): dòng mua 150/151/154, tồn NN-004 / NN-017 = 106.

**File xác nhận (gửi người dùng; → 09/11 đã ghi đè thành bản tổng hợp 23 câu, mục 46):** `docs/xac-nhan-anh-nhan-sau-chay-thu-2026-11-09.docx` (anh Nhân: 1 carton ở Kho thành phẩm - trừ tồn tại chỗ hay
chuyển 257 mã bao bì sang kho Phụ kiện; 2 Pat / La tấm; 3 Quản lý SX bấm Bắt đầu 2 chỗ; 4 đóng gói khi chưa xuất carton; 5 Phôi báo vượt; + nhắc câu 2.1–2.4,
6 câu đồng bộ) và `docs/gui-bao-sau-chay-thu-2026-11-09.docx` (Bảo: việc A đụng phần B, bảng 11 lỗi màn Mua hàng / Kho, 4 câu: ai sửa carton, in lại
phiếu chưa ký, câu nhắc màn Xuất sắt, nhận lỗi nào). Script `.claude/tools/huong-dan-test-phan-a/build_xac_nhan_0911.py`. Không commit docx.
Báo cáo test tay: đính chính "dòng KCS tô đỏ = có hàng chờ kiểm, không phải trễ hạn" (Word + HTML dựng lại).

**Chưa làm / còn treo:** (1) chờ xác nhận: lỗi xuất carton, Pat / La tấm, ô "Bắt đầu luôn lệnh", đóng gói, Phôi báo vượt; (2) cột "Hạn" ở Tối ưu cắt sắt
cần BE thêm hạn giao của đơn (chưa có trường); (3) bỏ qua vì đụng file đang sửa dở ở thư mục chính FE (đồng bộ Phôi – Hàn): "Tổng 0 PI" ở Tổng hợp lệnh SX,
"Khung cơ khí 99%" sau khi đã xuất, chữ PI ở `core.tsx` / Hướng dẫn; (4) chữ "PI" ở Admin, Booking chưa đổi; gợi ý tiền tố "MY" cho GOPLUS chưa làm;
(5) 9 màn kho có sửa chữ "PI" - báo B (đã gộp, chưa push); (6) file Word hướng dẫn test Phần A: đã thêm mục 9 khi deploy (xem dưới).

**Commit + gộp (09/11, người dùng: "Commit + gộp"):** `git fetch` thấy B đẩy thêm Đợt 7 (BE `8289a61` ghi mảnh vào kho công đoạn cuối + chuyển mảnh
Phước An sang kho Sơn Phú An; FE `4f901e9`) - không trùng file với nhánh, không migration → `pull --ff-only` thư mục chính trước. Commit nhánh: BE
`be3ccbd` (18 file `src/`), FE `c5ef6d6` (35 file `src/`; không đưa `next-env.d.ts`, `tsconfig.tsbuildinfo`). Gộp `--no-ff`: BE `main` → `cc85d46`, FE
`demo` → `d581ab8`. FE lần đầu bị chặn vì `CuttingSolvePanel.tsx` ở thư mục chính bị đánh dấu sửa nhưng KHÔNG khác nội dung (diff 0 kể cả bỏ qua xuống
dòng - chỉ lệch CRLF) → chép phòng hờ ra scratchpad `pull-0911/CuttingSolvePanel.truoc-gop.tsx`, `git checkout --` file đó rồi gộp lại. Phần sửa dở ở
thư mục chính (BE changelog + `app.module.ts`; FE đồng bộ Phôi – Hàn) còn nguyên. Sau gộp: BE `prisma generate`, `tsc` sạch (trừ 2 lỗi cũ seed), `nest
build` đạt; FE `tsc` sạch. Chưa push (chờ người dùng). Worktree `*-sua0911` + DB `dna_erp_sua0911` giữ lại để thử tiếp.

**Deploy (09/11, người dùng: "Deploy"):** `git fetch` - `origin` không có gì mới hơn; mỗi bên chỉ đẩy 2 commit của mình, không migration (không đụng DB
production). `git push origin main` 09:37 (`8289a61..cc85d46`) → CI GitHub build / test (cả bộ) / lint **success** 09:43; Render tự dựng (không có route
mới để gọi thử không đăng nhập; `GET /api/v1/materials-due` trả 401 = BE đang chạy). `git push origin demo` 09:37 (`4f901e9..d581ab8`) → Vercel
**success** ("Deployment has completed") 09:44. Chưa thử trên production bằng tài khoản thật.
- File Word hướng dẫn test Phần A (`docs/huong-dan-test-phan-a-2026-11-05.docx`, "cập nhật 09/11 (lần 3)", 23 trang, đã xem trang mục 9): thêm **mục 9
  "Sửa sau buổi chạy thử toàn luồng 07/11"** (trước / sau, RS.1–RS.7, TCS.1–TCS.10; TCS.1–4 cần IT dựng 3 dòng mua thử), đánh số lại "Chờ chốt" → 10,
  "Ghi lỗi" → 11; bảng trạng thái thêm dòng "Sửa sau chạy thử – đã cập nhật lên hệ thống 09/11", dòng "Chưa làm" bỏ phần tính lại số mua, Đợt 11 để sau
  12 yêu cầu; 10.1 câu 2.5 + "Lệnh gộp" → đã làm; 10.2 Đợt 2, Đợt 4 cập nhật.
- Cần báo Bảo: 9 màn kho của B có đổi chữ "PI" → "lệnh" (đã lên production) + nội dung file `docs/gui-bao-sau-chay-thu-2026-11-09.docx`.

## 40. Clone production về local + xoá DB cũ; commit + gộp + push đồng bộ Phôi – Hàn và Đợt 9 phần 3; sửa tiếp "Tổng 0 PI", "Khung 99%", cột Hạn cắt sắt, tiền tố LSX - nhánh `sua-tiep-0911` đã commit + gộp + push (09/11)

Người dùng: "những việc nào làm được ngay thì thực hiện fix, clean db local, [URL production] clone data production về local"; hỏi lại chọn
"không cần sao lưu, xoá hết db local hiện tại" + "Commit + gộp cả 2"; sau đó "push đi".

**1. Dữ liệu local:** `pg_dump` 17 (container `postgres:17-alpine`, CHỈ ĐỌC) production → `backups/prod_20261109_0956_clone-ve-local.dump` (2,9 MB,
108 bảng có dữ liệu, migration mới nhất `20261109090000_booking_shipment` = trùng `main`). URL production chỉ dùng trong lệnh, KHÔNG ghi vào file / ghi
nhớ / changelog. Xoá cả 11 DB `dna_erp*` (không sao lưu, theo người dùng) → tạo `dna_erp` → `pg_restore` 17 xuất SQL → `psql` 16 (3 lỗi vô hại như mọi
lần: extension `prisma_postgres`, `transaction_timeout`) → 110 bảng, 179 migration, 48 tài khoản, 409 vật tư, **0 lệnh SX**; `prisma migrate status`
up to date; `seed:demo` (18 tài khoản demo). Các cấu hình chạy thử / worktree trỏ DB cũ (be-3031-dongbo, be-3040-e2e-tay, be-3041-sua0911, worktree dot*)
giờ trỏ DB không còn - dựng DB thử mới từ `dna_erp` khi cần.

**2. Commit + gộp:**
- Đồng bộ Phôi – Hàn đủ công đoạn (changelog QR mục 58–64, trước đây sửa dở ở thư mục chính): BE nhánh `dong-bo-du-cong-doan` `4aef498` (module
  `piece-sync-board` + `app.module.ts`, hook eslint + prettier) → gộp `main` `f75abc2`; FE `8953140` (`core.tsx`, `ThongKePagePlan.tsx`, Hướng dẫn,
  `hanThucCo`, `PieceSyncView`, `pieceSyncModel`, `piece-sync-board-api` + test) → gộp `demo` `dbc165d`. KHÔNG đưa: `e2e/golden-path.spec.ts`,
  `.env.example` (xoá), `next-env.d.ts`, `docs/quy-doi-doan-phoi.md` (bản thiết kế cũ "mock API"), `start-dev.bat`, `test/solver-real-data-new/`.
  (Lời gộp BE lần đầu gõ nhầm, sửa bằng `--amend` trước khi push.)
- Đợt 9 phần 3 (cột Excel theo file "Kế hoạch cắt sắt", changelog Đợt 9 mục 10): worktree `dot9` BE `8981f8e` (+ changelog Đợt 9), FE `c4cbaf9`
  (Hướng dẫn) → gộp `main` `94f4a9d`, `demo` `eb445aa` (tự trộn `productionPlan.ts` với phần đồng bộ, không xung đột).
- Kiểm sau gộp: BE `tsc` sạch (trừ 2 lỗi cũ seed), jest `piece-sync-board` + `deadline-changes` 8 suite 112 test, `nest build`; FE `tsc` sạch, vitest
  pieceSync / hanThucCo / Guide 39 test.
- **Push (người dùng: "push đi") 10:05:** BE `cc85d46..94f4a9d`, FE `d581ab8..eb445aa`, không migration. Khi lên: KHSX phải tải lại file Excel kế
  hoạch (file cũ bị từ chối, có câu báo). Vercel `eb445aa` **success**; Render đã dựng bản mới (route mới `GET /api/v1/piece-sync-board`
  trên production trả 401 cần đăng nhập, route không có trả 404). CI GitHub `94f4a9d` build / test / lint **success** (đọc lại 10:32 - API GitHub không đăng nhập
  từng hết 60 lượt/giờ do vòng chờ hỏi liên tục; lần sau hỏi thưa hơn).

**3. Sửa tiếp (nhánh `sua-tiep-0911` từ `main` `94f4a9d` / `demo` `eb445aa`, worktree `*-sua0911`, 2 thợ song song):**
- FE "Tổng hợp lệnh SX": chữ "PI" → "lệnh" (Tổng N lệnh, Không có lệnh nào, Chi tiết lệnh, Tiến độ cả lệnh…; `core.tsx`, Hướng dẫn - giữ 3 chỗ nói mã
  PI thật để tìm kiếm). "Công đoạn hiện tại" đổi luật (hàm thuần mới `currentStagePick.ts` + 8 test): lấy công đoạn XA NHẤT đã có số (cũ: công đoạn
  sớm nhất chưa đủ 100% → GP-182 hiện "Khung cơ khí 99%" dù đã đóng gói xong); đóng gói đủ mà chưa Kết thúc → "Đóng gói xong · chờ Kết thúc"; Kết thúc
  → Hoàn thành; lệnh BE đánh dấu Mua hàng giữ như cũ; thanh tiến độ từng công đoạn + dấu lệch bộ không đổi.
- BE + FE Tối ưu cắt sắt: ứng viên có thêm `deliveryDate` (hạn giao dòng SKU, không có thì của đơn); cột "Hạn" hiện hạn khung, chưa có thì hạn giao kèm
  chữ "hạn giao"; BE xếp theo hạn khung ?? hạn giao (đơn gấp chưa có lệnh lên trước). "sớm N ngày" / luật gộp vẫn theo hạn khung.
- FE ô Số LSX (`LsxCodeInput`, `LenhSXPage`, hàm `lsxSuggest.ts` + 7 test): gợi ý tiền tố theo số LSX gần nhất của cùng khách, chưa có thì dò tên khách
  với danh sách tiền tố (GOPLUS → GP, MEYING → MY), nhiều khớp / không khớp → để trống (không tự điền "MY"). Không gợi ý số tiếp theo.
- Kiểm: BE `tsc` sạch, jest `cutting-proposals` 11 suite 306 test, `nest build`; FE `tsc` sạch, vitest Manufacturing / utils / Guide / ProductionPlan
  23 file 247 test. Chưa chạy thử trên trình duyệt (DB local mới có 0 lệnh SX - cần dựng dữ liệu thử).

**Chưa làm:** test lại luồng booking → kho xuất (cần dữ liệu thử trên DB mới); chữ "PI" ở màn Quản trị và bảng Booking ("Tên PI" có thể là thuật ngữ
của bảng booking anh Nhân gửi - cần hỏi); dọn worktree cũ (chưa được bảo).

**Commit + deploy phần sửa tiếp (người dùng: "Commit + deploy"):** `origin` không có gì mới; commit BE `165ec11` (3 file), FE `ee2672f` (11 file, không
đưa `tsconfig.tsbuildinfo`) → gộp `--no-ff` BE `main` `0d02c71`, FE `demo` `838e45e` (không đụng phần sửa dở còn lại ở thư mục chính FE) → `tsc` 2 bên
sạch, `nest build` đạt → push 10:30 BE `94f4a9d..0d02c71`, FE `eb445aa..838e45e`, không migration. CI GitHub `0d02c71` build / test / lint **success**, Vercel `838e45e` **success** (10:38). Chưa thử trên
production bằng tài khoản thật.

## 41. Dọn worktree cũ, 3 review (chức năng / bảo mật / hiệu năng), "Văn phòng agent", test tay lần 2 (đã đi hết luồng, 38 điểm) + gọn khung "phần đồng nghiệp" ở Lệnh mua vật tư (09/11; commit + push 10/11 - mục 49)

Người dùng: "Dọn các worktree cũ, và thực hiện test lại từ đầu tới cuối… UI, UX, performance"; "mở 3 subagent review về chức năng, bảo mật và hiệu
năng rồi vẽ luồng đó ra một html"; "làm như một văn phòng… xem các agent hiện tại… thông báo trực tiếp"; "Làm tiếp test"; "chỗ này nên làm thế nào hiển
thị cho gọn" → "Sửa theo đề xuất".

**1. Dọn worktree:** gỡ 27 worktree cũ (BE + FE), chỉ còn 2 thư mục chính; phần sửa dở của 10 worktree trong `.claude/worktrees` lưu thành
`backups/worktree-cu-2026-11-09/*.patch` + `*.untracked.tar` trước khi gỡ; `node_modules` dạng liên kết gỡ bằng `rmdir` (không xoá nội dung thật), phần
`.pnpm` đường dẫn dài xoá bằng robocopy /MIR. Nhánh git giữ nguyên. `.claude/launch.json` bỏ cấu hình chết, còn `be-3040-test` (DB `dna_erp_test` =
`dna_erp` + `seed:demo`) / `fe-3140-test` / `agent-office`.

**2. 3 review chỉ đọc (3 agent chạy nền):** báo cáo đủ, CHƯA sửa gì. Nặng nhất:
- Chức năng (12 điểm): hàng đợi tổ + QR không tách xưởng (Phú An / Phước An không chạy song song cùng tổ); phiếu chuyển mảnh không kiểm mảnh đang ở kho
  nào (sổ kho mảnh âm / cộng 2 lần); 2 điểm về phân quyền kho (chi tiết để ngoài repo, xem gạch Bảo mật); ghi đóng gói không chống gửi 2
  lần; FE chỉ lấy 100 lệnh mới nhất cho màn Phôi/Hàn/Sơn/xuất kho; vật tư kho thành phẩm đi sai kho khi lệnh gộp / chọn "Kho thành phẩm 2".
- Bảo mật (11 điểm): chi tiết KHÔNG ghi ở đây vì repo công khai - bản đầy đủ chỉ giữ trong máy (`backups/review-bao-mat-chuc-nang-2026-11-09.md`,
  thư mục `backups/` đã gitignore). Kết luận chung: không có bí mật thật trong lịch sử git, SQL thô đều có tham số.
- Hiệu năng (20 điểm; DB thử gần rỗng nên phần lớn là ước lượng từ code): `/stock-quant` không phân trang + 2 truy vấn mỗi dòng; Tối ưu cắt sắt hỏi lại
  mỗi 4 giây kèm toàn bộ chi tiết 30 phương án; ghi nhật ký (audit) chạy ngoài transaction trên kết nối thứ 2 (pool 10) + lưu JSON nguyên dòng (audit 19 MB,
  87% của PlanForm là tạm lưu nháp); throttle 100/phút theo IP cho cả công ty sau 1 IP; `/floor/review` ~130 truy vấn mỗi lần; `/skus` 355 KB cho 16 SKU.
- Trang luồng 10 trạm + kết quả: `backups/test-tay-2026-11-09/luong-erp.html` (artifact claude.ai, bản tĩnh) - CHƯA gộp 3 review vào từng trạm.

**3. "Văn phòng agent" (công cụ trong máy, không thuộc sản phẩm):** `.claude/tools/agent-office/server.py` + `office.html`, cấu hình `agent-office`
cổng 3199 - đọc nhật ký jsonl các phiên Claude + agent con, mỗi agent 1 bàn (đang làm / đang nghĩ / chờ agent con / chờ người dùng / im lặng / xong, việc
vừa làm, ghi chú, báo cáo), bảng tin + thông báo; `/luong` = trang luồng có khung 3 review trực tiếp. Chỉ nghe 127.0.0.1, không trả nội dung kết quả công cụ.
`.claude/` không commit (repo công khai).

**4. Test tay lần 2 (đang làm, DB `dna_erp_test`):** đã đi SKU J55.T4 MỚI( BÀN 4) MY → KHSX duyệt định mức → Sếp duyệt SKU → Sales PO-TEST-0911 (300 bộ,
hạn giao cố ý để 02/11 đã qua) → Tối ưu cắt sắt (314 cây, hao 0,55%) → lệnh MY-313 → QLSX (Xưởng Phú An, Kho thành phẩm) → Sếp duyệt (0,9 s, 56 dòng
mua) → Mua hàng. 17 điểm ghi ở `backups/test-tay-2026-11-09/ghi-chu.md` (6 ảnh khoanh đỏ). Đáng chú ý: sau Duyệt KHSX còn phải kéo xuống cuối danh sách
bấm "Xác nhận hoàn tất" mới sang Sếp (vẫn như 07/11); nút Duyệt của Sếp cách đầu trang ~4 màn hình; ô Số LSX có chữ mẫu "MY-313" viết cứng trông như đã
điền + gợi ý tiền tố theo khách không chạy trên dữ liệu production vì Admin chưa khai tiền tố LSX; PO / lệnh trễ chỉ QLSX và Sếp thấy cảnh báo; hàng đếm
theo cái ra số lẻ (304,5 mặt bàn gỗ). Để đi tiếp bước Mua hàng: trên `dna_erp_test` đã chuyển người mua của vật tư sang 3 tài khoản thử muapsh / muavttp /
muatp (chỉ DB thử). DB thử chưa có NCC nào → bước tạo đơn đặt hàng cần thêm NCC.

**5. FE Lệnh mua vật tư - gọn khung "phần đồng nghiệp" (`LenhMuaNCCPage.tsx`, thư mục chính FE, chưa commit):**
- Trước: mỗi vật tư của người mua khác là 1 ô kèm nhãn trạng thái (đề xuất 300 bộ: 36 ô, nửa màn hình, nằm TRÊN bảng của mình). Nay: 1 dòng tóm tắt
  "Phần đồng nghiệp mua: 36 vật tư · 36 Chưa vào đơn", đặt DƯỚI phần của mình; bấm "Xem" → popup (component `Modal` dùng chung) có bảng Vật tư ·
  Quy cách · Cần mua · ĐVT chia nhóm theo trạng thái, cuộn trong hộp. (Bản đầu xổ tên nối dấu phẩy ngay tại chỗ - người dùng thấy khó đọc, đổi sang
  popup.) Chưa chia theo tên người mua (màn chỉ có mã người mua của vật tư).
- Nhãn dòng chờ duyệt tách 2 nghĩa: chưa vào đơn đặt hàng → "Chưa vào đơn"; đã vào đơn chờ phiếu ký → "Chờ Sếp duyệt" (trước ghi "Chờ Sếp duyệt" cho cả
  dòng người mua chưa làm gì - điểm 22 buổi test 07/11, đã gửi Bảo). Trạng thái gộp ở danh sách / góc phải đổi theo. `PROPOSAL_STATUS_LABELS` dùng chung
  không đổi (màn Theo dõi mua hàng / Quản trị giữ như cũ). Người dùng hỏi lại "trước để Sếp chưa duyệt mà?" → giải thích → chốt **giữ nhãn mới** (09/11).
- Kiểm: `tsc` sạch, `eslint` file sạch (màn không có test riêng); trình duyệt 1200 px + điện thoại 375 px: dòng tóm tắt + popup (37 hàng = 1 nhóm +
  36 vật tư) đúng, không tràn ngang; ảnh `backups/test-tay-2026-11-09/06-sau-sua-phan-dong-nghiep-gon.jpg`.
  Nhãn "Chờ Sếp duyệt" cho dòng đã vào đơn CHƯA thấy trên giao diện (DB thử chưa có NCC để tạo đơn).

**6. Test tay tiếp - Nhà cung cấp → Đơn đặt hàng → Sếp duyệt → Kho nhận (09/11 chiều, DB `dna_erp_test`):**
- Admin › Danh mục › Nhà cung cấp: thêm "Thép Kim Phát (thử)" (số đơn cuối 52) + 1 NCC "ngừng hợp tác". Mua hàng (muapsh) gom 2 dòng sắt →
  đơn **53/2026** đúng số; gom 18 dòng còn lại → **54/2026**, nhãn đề xuất đổi đúng "Chưa vào đơn" → "Chờ Sếp duyệt" (cả màn chi tiết lẫn danh
  sách) - xác nhận phần sửa nhãn ở mục 5. Phiếu Excel in (gọi thẳng API, đọc bằng openpyxl): đúng số đơn, dòng, MY-313, người ký Giám đốc.
  "Sếp đã duyệt" làm trên giao diện với file GIẢ (chặn POST /uploads/document ngay trong tab, không lên Cloudinary) → dòng sang "Đang mua hàng".
  Phần của muavttp (31 dòng) và muatp (5 dòng) làm bằng API cùng cách (đơn 55, 56/2026) vì giao diện giống hệt. Làm tròn Số mua bánh đá 0,3045 → 1
  được, hiện "Mua dư +0,6955".
- Kho Phôi (khopsh): 13 dòng chờ nhận. Nhập sắt hộp 100/180: lệch số phiếu giao (90) bị chặn, câu báo rõ; thiếu file thì nút khoá kèm "Còn thiếu
  ảnh…"; In phiếu nhập cấp số NK-261109-001 (chặn cửa sổ in, đọc HTML: đúng NCC, đơn 53/2026, 100/100 cây, MY-313); xác nhận → còn chờ 80, có lịch
  sử kèm 4 file. Ô "Kho nhận" trên phiếu vẫn 7 kho cũ (còn "Dây – gỗ") - chờ phần 9 kho của Bảo (hẹn 12/11), không ghi là lỗi.
- Phát hiện mới (ghi-chu.md 18–23, ảnh 07–11): (18) ô tick "Đang hoạt động" ở form NCC lệch; (19) tên NCC toàn dấu cách vẫn lưu → NCC không tên
  (FE chỉ chặn rỗng, BE `MinLength(1)` không cắt khoảng trắng), SĐT nhận cả chữ; (20) NCC trùng tên vẫn lưu, không cảnh báo → 2 dãy số đơn riêng;
  (21) form Thêm NCC bỏ tick "Đang hoạt động" vẫn ra "Hoạt động" (`createSupplier` FE không gửi `isActive`, `CreateSupplierDto` cũng không nhận -
  chỉ màn Sửa đổi được); (22) hộp Tạo đơn ghi "(vd 53/2026)" cố định dù số thật là 54, bảng chọn dòng không có "chọn tất cả"; (23) dòng phụ
  form nhận hàng hiện mã kho "Kho phoi-son-han" (`NhapKhoNhanHang.tsx` dòng 395 dùng `warehouseCode`, đã có sẵn `khoLabel`); ô "SL trên
  phiếu giao" bị đẩy sang phải khi gõ số lượng; sau khi lưu Số mua dòng nhảy chỗ; số lẻ hiện "0.3045" ở Mua hàng nhưng "0,609" ở Kho.
- Dừng giữa bước nhận vượt (nhập 90 khi còn 80) vì người dùng đang bấm trong khung trình duyệt; 1 lần trang tự sang "Vật tư cần về" chưa rõ do cú
  bấm của người dùng hay lỗi - chưa ghi là lỗi.

**7. Test tay tiếp - nhận vượt → nhận đủ 3 kho → QLSX Bắt đầu → xuất sắt → Phôi cắt → KCS (09/11 chiều):**
- Nhận vượt (UI, kho Phôi): sắt hộp 90 khi còn 80 → hộp vàng "Nhận vượt 10", lý do bắt buộc (toàn dấu cách vẫn khoá); sắt vuông nhận 1 lần 140/134.
  Máy chủ đúng: giữ chỗ cho lệnh = 180, phần vượt vào tồn tự do (kho ảo SUPPLIER âm là bút toán đối ứng, đúng). Người mua nhận báo kèm lý do.
  Hàng không phải sắt chỉ đòi 3 giấy tờ; "Từ chối nhận" bắt lý do + ảnh, có câu báo, dòng vẫn chờ, không cộng tồn.
- Nhận nốt 10 dòng kho Phôi + 14 kho Phụ kiện + 29 kho Thành phẩm bằng API (`scratchpad/pull-0911/nhan_api.py`, file giả, làm tròn lên đơn vị đếm
  như NCC giao thật) → 56/56 dòng PURCHASED. Lần chạy đầu script gửi sai trường quy đổi đơn vị nên 51 lần lỗi 400 → DB thử bỏ trống số phiếu
  NK-261109-007…057 (do script, không phải lỗi app). Bị giới hạn đăng nhập 8 lần/phút chặn 1 lần (giữ nguyên theo quyết định 15/10).
- QLSX (qlsx): bấm "Bắt đầu" có hộp xác nhận → "Đang chạy". Nút "Kết thúc" bấm được cả khi chưa bắt đầu - đúng chủ đích 31/08 (QLSX toàn quyền),
  không ghi lỗi. Thủ kho xuất sắt: MY-313 chỉ hiện sau khi QLSX Bắt đầu (đúng); phiếu XK-261109-002 180 + 134 cây in đúng, xác nhận với ảnh ký giả.
- Phôi: xác nhận nhận sắt (đếm thiếu 132/134 → "Thiếu 2 cây · kho và QLSX được báo"); báo cắt sắt hộp 1200 + 1200, sắt vuông 1188/1200 (thiếu sắt);
  "Hoàn tác" đợt cắt chạy; Gửi KCS. KCS: thêm nguyên nhân lỗi mới ngay trong hộp duyệt (DB thử chưa có danh mục lỗi), sắt hộp đạt (lỗi 10 đoạn),
  sắt vuông đạt.
- Phát hiện mới (ghi-chu.md 24–33, ảnh 12–19): (24, vừa) lần nhập làm dòng đủ số thì màn đóng ngay, mất câu "Đã nhập… nhận vượt…"
  (`NhapKhoNhanHang.tsx:78-79`); (25) bảng "Chia lần này" + phiếu nhập ghi cả số vượt cho lệnh (MY-313 140) trong khi máy chủ chỉ giữ đủ số cần;
  (26) thông báo ghi "140 Mm" cho sắt (đơn vị gốc vật tư) và chỉ có mã, không tên; (27, vừa) số mua lẻ cho đơn vị đếm sinh 14 lần "nhận vượt" giả
  (0,5 con, 0,0415 cuộn…), mỗi lần bắt lý do + báo người mua - nên làm tròn lên lúc sinh đề xuất (cùng gốc điểm 16); (28) màn đăng nhập văn phòng
  hiện nguyên "ThrottlerException: Too Many Requests" (`LoginPage.tsx:64`); (29, vừa) QLSX nhận ~56 thông báo "hàng về kho" cho 1 đơn (chuông 60),
  chỉ có mã vật tư; (30, vừa) xuất sắt 185 > 180 "còn được xuất" chỉ bị chặn ở bước Xác nhận cuối (sau in + ký), câu báo có "vật tư 109", "PI 50",
  "không đủ hứa"; ô "Dài cây" bị xoá sau khi thêm; tạo phiếu được khi trống người nhận; (31) Phôi xác nhận nhận sắt: nút bị cắt ở ~980 px, nút
  Xác nhận nhảy khi hiện cảnh báo thiếu, mỗi lần ~3 giây, mã lệnh nhảy PI-2026-001 → MY-313; (32) Phôi báo 1300 > 1200 đoạn: "Còn lại 0" màu xanh
  che phần dư (báo vượt là chủ đích, QLSX thấy ở màn duyệt - chỉ đề nghị hiện "vượt 100"); (33) KCS nhập "Không đạt" 1300 > 1200 thì ô giữ 1300,
  tóm tắt tự kẹp 1200, không báo.

**8. Test tay tiếp - Phôi đục lỗ → KCS → Hàn → KCS → Sơn → KCS (09/11 chiều):**
- Sau KCS cắt: thẻ Phôi hiện "còn thiếu 10 đoạn" (sắt hộp, do 10 đoạn lỗi) và "còn thiếu 12 đoạn" (sắt vuông, thiếu 2 cây) - đúng. SKU này Phôi
  chỉ có cắt + đục lỗ (Vật tư TP = 0). Đục lỗ: bấm Gửi KCS khi chưa nhập → "Nhập số đoạn đã đục lỗ"; gửi 1200 → KCS đạt.
- Hàn: 2 mảnh CHÂN BÀN / VIỀN NGẮN, mỗi mảnh hiện "Phôi sẵn để hàn ~1.188 / ~1.190 (ước tính) · thiếu nhất … nghẽn ở Cắt" - khớp số KCS Phôi
  (đồng bộ mảnh Phôi–Hàn mục 64 chạy đúng). Báo 1200 > 1188 phôi sẵn được lưu không hỏi - đúng chủ đích (Hàn/Sơn tự báo), không ghi lỗi.
  KCS Hàn: có lỗi thì bắt chọn nguyên nhân ("Có SL không đạt → phải chọn nguyên nhân"), danh mục lỗi riêng từng công đoạn; CHÂN BÀN 1.195 đạt /
  5 lỗi, VIỀN NGẮN 1.190 đạt. Sơn báo 1.195 + 1.190 → KCS đạt hết.
- QLSX: MY-313 "Khung cơ khí 99%", dấu ⚠ "Hàn/Sơn lệch bộ" đúng (1.195 vs 1.190); khoá "Đổi xưởng" sau khi đã xuất sắt; chuông lên 67.
- Phát hiện mới (ghi-chu.md 34, ảnh 20): danh sách Hàn/Sơn "còn 2.400 cái" (mảnh) vs bên trong "300" (sản phẩm); deadline đã qua không tô đỏ ở
  Hàn/Sơn; cảnh báo lệch bộ chỉ xem được bằng rê chuột; Sơn không có dòng "khung sẵn để sơn" như Hàn; KCS hết lô ghi "Không có dữ liệu.".

**9. Test tay tiếp - chuyển mảnh → xuất đan → nhập đan → chuyền kiểm → đóng gói → booking → xuất hàng → Kết thúc (09/11 chiều) - ĐI HẾT LUỒNG:**
- Thủ kho Phôi-Sơn-Hàn (khopsh) "Xuất theo đơn hàng" chuyển mảnh đã qua KCS sang kho Phụ kiện (1.195 + 1.190; nhập 1.200 thì ô đỏ + khoá ngay);
  kho Phụ kiện (khovttp) "Nhập nội bộ" xác nhận 2 phiếu CK-2026-001/002 (có hộp xác nhận); trước đó màn xuất đan báo "Có thể xuất 0 - chưa đủ
  mảnh đã nhận" (đúng). Xuất đan cho DAN-TEST-01: dây mang kèm 500 kg > tồn 472,68 bị chặn; xuất 1.195 + 1.190 mảnh, dây 236 + 236 kg, đinh tự
  tính 5.975 + 11.900.
- Kho Thành phẩm (khotp): nhập đan vượt số xuất bị chặn ("không được vượt quá còn phải nhận"), nhận đủ 2 mảnh; chuyền kiểm 1.195 + 1.190 (1 lỗi);
  đóng gói 300 thùng (máy chủ chỉ chặn vượt số lượng lệnh). Sales tạo booking BK-TEST-0911: nhập 310 > 300 báo "vượt số còn lại", "Lấy hết" 300,
  "Lưu & xác nhận". Kho xuất theo booking: 310 bị chặn, phiếu XK-261109-003 in đúng (Thành phẩm 1, khách MEYING, 300 bộ), xác nhận đã xuất với
  ảnh ký giả. QLSX "Kết thúc lệnh" (hộp "KHÔNG hoàn tác") → MY-313 **Hoàn thành**, 5 mốc xanh (ảnh 23).
- Phát hiện mới (ghi-chu.md 35–38, ảnh 21–22):
  - **(38, cao) Không xuất được vật tư đóng gói:** cả 6 dòng báo "fromWarehouseId và toWarehouseId không được trùng nhau". Xuất bao bì = chuyển từ
    `Material.warehouseId` sang kho thành phẩm của lệnh, nhưng 6 bao bì đang gán vào chính `thanh-pham` (DB thử từ backup production) → kho đi =
    kho đến (`packaging-issues.service.ts` postLedgerEntry → `stock-ledger.service.ts:116`). Dính chia 9 kho (phần B của Bảo). Kèm: ô số lẻ hiện
    "3.8609999999999998"; đóng gói + xuất hàng không đòi xuất bao bì trước.
  - (35, CẦN HỎI anh Nhân) đóng gói 300 thùng dù mảnh đạt chuyền kiểm chỉ đủ ~297 bộ (màn xuất bao bì cũng tính "Thực có" 297); dòng tiến độ
    hiện Khung/Đan/Chuyền kiểm 99% nhưng Đóng gói đủ.
  - (36) nhập nội bộ chỉ nhận cả phiếu hoặc từ chối, không có ô đếm thực nhận; hộp xác nhận xuất đan không nhắc dây/đinh mang kèm, vượt tồn chỉ
    báo sau khi xác nhận (câu dùng mã DAY-013); chữ cũ "Kho Vật tư thành phẩm" + mã "kho phôi-sơn-hàn"; số phiếu "CK-2026-001" khác mẫu
    NK/XK-261109-…; chuyền kiểm mỗi "Lỗi #n" tính 1 cái, không có ô số lượng.
  - (37) booking "Lưu & xác nhận" được khi trống CUT OFF + Ngày lấy cont → không hiện trên Lịch tháng, không có mốc để nhắc thiếu hàng.
- Tổng test tay lần 2: 38 điểm (ghi-chu.md), 23 ảnh; 1 chặn luồng (38), 1 cần hỏi (35); dữ liệu thử nằm trong `dna_erp_test` (MY-313 đã Kết thúc).

**10. Báo cáo test tay lần 2 (Word) - `docs/bao-cao-test-tay-lan-2-2026-11-09.docx` (chưa commit):**
- 20 trang A4, lời thường (không tên code, không tên tài khoản thử / người mua thật), 23 ảnh khoanh đỏ. Mục: tóm tắt (việc phải xử lý trước
  chạy thật: 38, 27 + 16, 24, 30, 7–8, 13), cách làm, luồng đã đi + số liệu, bảng 38 điểm (theo thứ tự luồng, tô màu mức), chi tiết theo mức
  (cao → vừa → cần hỏi → nhỏ → ghi nhận: hiện tượng + đề xuất + ảnh), phần chạy đúng, 3 câu cần anh Nhân (đóng gói theo số bộ đạt chuyền kiểm;
  làm tròn số mua hàng đếm theo cái; booking bắt CUT OFF / ngày lấy cont), phần FE đã sửa trong buổi (popup + nhãn "Chưa vào đơn" - nhắc Bảo
  khỏi sửa trùng), phần chưa test.
- Dựng bằng `docx` (npm) - script `.claude/tools/huong-dan-test-phan-a/build_bao_cao_test_lan2.js`; kiểm bằng Word thật xuất PDF + `pdf-to-png.ps1`:
  mở được, 20 trang; đã sửa ảnh quá to (27 → 20 trang) và danh sách mục 7 đánh số nối từ mục 3.

**Chưa làm:** gộp 3 review vào trang luồng; gửi báo cáo cho Bảo / anh Nhân (người dùng tự gửi); nhánh chưa đi: cắt bù 10 + 12
đoạn thiếu (xuất thêm sắt từ tồn tự do), xuất vật tư hàn/sơn cho Hàn/Sơn ("Xác nhận nhận vật tư"), Tạm dừng/Tiếp tục lệnh; báo Bảo lỗi 38 + phần
nhãn "Chưa vào đơn" đã sửa ở FE để khỏi sửa trùng.

## 42. Sửa nhóm 1 sau test tay lần 2 (~20 điểm giao diện FE, 5 thợ song song) (09/11; commit + push 10/11 - mục 49)

Người dùng chọn "Sửa nhóm 1" sau khi chia 38 điểm (mục 41) thành 4 nhóm: (1) sửa ngay - giao diện / chữ / kiểm tra nhập ở phần A; (2) đụng
file Bảo đang sửa (NCC, đơn đặt hàng, nhận hàng, xuất kho, bao bì 38) - để gửi Bảo; (3) chờ quyết (16+27, 35, 37, 29, 6, 2); (4) không cần sửa
(3, 17). Chỉ FE `D:\DNA-ERP` (nhánh `demo`), không đụng BE. Opus chia 5 phần không chung file, giao 5 `implementer-sonnet`, rồi tự review diff.

**Đã sửa (theo điểm của báo cáo test lần 2):**
- **1 + 28** `LoginPage.tsx`: hàm `describeLoginError` - 401/"Invalid credentials" → "Tên đăng nhập hoặc mật khẩu không đúng"; 429 → "Đăng nhập
  quá nhiều lần. Đợi khoảng 1 phút rồi thử lại."; mất mạng / 5xx / câu tiếng Anh khác → câu tiếng Việt. Opus sửa thêm khi review: câu TIẾNG VIỆT
  của máy chủ giữ nguyên trước khi xét 401 (tài khoản công nhân sai PIN / bị khoá tạm cũng trả 401 kèm "Sai PIN - còn N lần thử…", "…khoá
  tạm…" - bản đầu của thợ sẽ đè thành "sai mật khẩu"). Giới hạn 8 lần/phút ở BE giữ nguyên.
- **10, 11, 12** `Sales/OrderManagementPage.tsx`: ô Tổng số chỉ nhận số nguyên (chữ đỏ "Số bộ phải là số nguyên" + vào "Còn thiếu" + khoá
  Lưu); xoá / gõ khác chữ ô SKU thì bỏ chọn SKU (kèm màu dây / vải nệm); gợi ý SKU không lặp "mã — tên" khi mã = tên; hạn giao trước hôm nay
  hiện "Hạn giao đã qua" (cam) + bấm Lưu hỏi "Có dòng hạn giao đã qua - vẫn lưu?" (không chặn cứng - chưa quyết có cho đơn lùi ngày); danh
  sách PO tô đỏ hạn đã qua khi còn SKU chưa xong. Opus sửa 1 chỗ thợ làm lệch khoảng trắng (`fmtMoney =(`).
- **4, 5, 7, 8, 9** `SKUReviewPage.tsx`, `SKUDetail.tsx`: SKU có nhánh bị từ chối không còn đếm / nhãn "Chờ duyệt" - nhãn mới "Bị từ chối –
  chờ sửa" (`needsManhReview/needsDetailReview` = có dữ liệu + CHƯA có quyết định; đã soát: gửi lại thì mapper `toSingleReviewStatus` trả
  `undefined` nên SKU gửi lại vẫn vào "Chờ duyệt"); duyệt / từ chối nhánh xong tự gọi `onRefresh` để nhãn trạng thái cập nhật; hộp duyệt mảnh
  ghi đúng số nhóm có dữ liệu (bỏ "cả 5 nhóm"); dải nhắc vàng ĐẦU trang kèm nút "Xác nhận hoàn tất — Định mức mảnh / chi tiết" (cùng handler,
  không tự gửi Sếp); thanh nút Duyệt / Từ chối của Sếp dính đầu trang (`FinalReviewAction` thêm prop `inline`); bảng trống `colSpan` 6 → 5.
- **13, 14, 16** `LsxCodeInput.tsx`, `LenhSXPage.tsx`, `BossApp.tsx`: placeholder số LSX "MY"/"313" → "Tiền tố"/"Số", bấm Lưu thiếu số báo
  "Chưa nhập số LSX"; mốc / hạn giao đã qua tô đỏ + "Quá hạn N ngày" ở danh sách lệnh KHSX, hộp Gửi QLSX, màn sửa mốc (Opus sửa thêm: KHÔNG tô
  khi lệnh đã Kết thúc / PI DONE / CANCELLED - tránh báo trễ giả cho lệnh xong); câu Sếp duyệt lệnh bỏ "bắt đầu sản xuất ngay" → "Xưởng làm
  được sau khi QLSX bấm “Bắt đầu”"; "Tổng hợp chờ duyệt" của Sếp tự mở tab đầu tiên có việc (người dùng / link chọn tab thì giữ).
- **31, 32 (Phôi), 33, 34e** `XacNhanNhanSatPage.tsx`, `LenhSanXuatPhoi.tsx`, `KcsPhoiPage.tsx`, `kcsCore.tsx`: cột trạng thái 230 px, nút
  `nowrap`, cảnh báo "Thiếu/Thừa N cây" đặt dưới hàng nút + giữ chỗ (nút không nhảy), "Đang lưu…", dòng hiện "đã nhận · đang cập nhật…" ngay
  sau khi xác nhận; mã lệnh chưa tra xong hiện "…" (quá 4 giây mới hiện mã gốc) - chỉ trong màn Phôi (bọc `LenhCode` cục bộ); bảng cắt Phôi
  hiện "vượt N" (cam) khi báo dư; KCS Phôi + Hàn/Sơn: số không đạt > số đã cắt / chờ duyệt → viền + chữ đỏ, khoá "Xác nhận duyệt"; hết lô ghi
  "Không còn lô chờ kiểm."; KCS Phôi giữ tab đang đứng sau khi duyệt lô cuối.
- **34a, 34b, 34c, 32 (Hàn/Sơn), 15** `core.tsx`, `ThongKePagePlan.tsx`, `MfgApp.tsx`: Hàn/Sơn đơn vị "mảnh" ở cấp lệnh, "(bộ)" ở cấp SKU;
  hạn SKU đã qua (chưa 100%) tô đỏ + "Quá hạn N ngày"; `ConLaiCell` hiện "vượt N" (cam) thay "0" xanh ở 4 chỗ - Opus sửa thêm khi review: bảng
  SKU dùng chung cho Phôi nên "cần" phải là số CÂY (`poSummaryCay`) chứ không phải số bộ → thêm `need` vào `poSummary`/`poSummaryCay`;
  chữ "lệch bộ" hiện ngay cạnh ⚠ (3 chỗ, giữ title); "Tổng N lệnh đã duyệt"; MfgApp tải lại số đỏ work-queue mỗi lần đổi màn (`refresh` ổn định
  theo token - không lặp gọi). Nguyên nhân số đỏ "Xử lý lệnh SX" kẹt 1: thợ nghi `countNeedsAction` (đề xuất cắt DRAFT/FAILED) - Opus soát DB
  thử chỉ có 1 đề xuất APPROVED nên loại; nhiều khả năng chỉ do chưa tải lại.

**Kiểm:** `npx tsc --noEmit` toàn FE sạch; `npx eslint` 14 file: 0 lỗi, số cảnh báo từng file BẰNG bản HEAD (so `git show HEAD:file | eslint
--stdin`) - không phát sinh cảnh báo mới; `vitest run src/components/sanxuat src/modules/pages/Floor --maxWorkers=2` 86/86. Trình duyệt
(1280×800, DB thử): đăng nhập sai → câu tiếng Việt; Tạo PO 2,5 bộ → chữ đỏ + khoá Lưu, hạn 02/11 → "Hạn giao đã qua" + hộp hỏi lại (bấm Huỷ,
không tạo PO), xoá ô SKU → bỏ chọn + "Còn thiếu: SKU"; Duyệt SKU → "Chờ duyệt mảnh 0", 15 SKU "Bị từ chối – chờ sửa", bảng trống đủ ngang;
QLSX "Tổng 1 lệnh đã duyệt" + "⚠ lệch bộ"; Hàn tiêu đề "(mảnh)"; KCS Hàn "Không còn lô chờ kiểm.". Ảnh ở
`backups/test-tay-2026-11-09/sau-sua-nhom-1/`.

**Chưa xem được trên màn** (DB thử không còn lệnh / lô đang chạy - MY-313 đã Kết thúc; chỉ kiểm qua code + tsc): tô đỏ mốc ở lệnh đang chạy,
dải nhắc hoàn tất + thanh nút Sếp ở chi tiết SKU (thanh `sticky top:0` cần xem có bị header app đè không), "vượt N" ở Phôi / Hàn / Sơn, KCS
chặn số lỗi vượt, bố cục Phôi nhận sắt ở ~980 px, số LSX báo "Chưa nhập số LSX", Sếp tự mở tab có việc.

→ **Cập nhật mục 44:** đã dựng lệnh thử MY-314 và xem được trên màn mọi phần trên, TRỪ dải nhắc + thanh nút Sếp ở chi tiết SKU, "Chưa nhập
số LSX", Sếp tự mở tab có việc (vẫn chỉ kiểm qua code).

**Chưa làm:** dòng "khung sẵn để sơn" cho Sơn (→ đã làm, mục 44); mã lệnh nhảy chữ ở các màn ngoài Phôi (sửa gốc `components/LenhCode.tsx` →
đã làm phần lớn, mục 44); ~3 giây khi Phôi
xác nhận nhận sắt (lời gọi BE `receiveSteelIssue`, nghi do gửi thông báo); nhóm 2 (gửi Bảo, đầu danh sách là điểm 38) và nhóm 3 (chờ anh
Nhân). Không commit.

## 43. Kéo commit mới của Bảo "Xuất đan 2 phiếu" (BE `b2c8c48`, FE `cdc60af`) + áp migration vào DB máy (09/11)

- `git fetch` 2 repo: BE `main` +2 commit (`ba1d036` + gộp `b2c8c48`), FE `demo` +2 commit (`9577746` + gộp `cdc60af`) - "Xuất đan 2 phiếu: mảnh từ
  kho Sơn, dây/gỗ/đinh/nút từ kho Phụ kiện; mảnh không đan chuyển thẳng kho Thành phẩm". Không có commit local chưa đẩy; KHÔNG file nào vừa đổi
  trên remote vừa đang sửa dở ở máy → `git pull --ff-only` cả 2 (không stash, không commit; thay đổi nhóm 1 mục 42 + các file dở cũ còn nguyên).
- Migration `20261109120000_weaving_issue_slips` (chỉ thêm: 3 giá trị enum, cột `pieceId/weavingIssueId/weavingIssueMaterialId` ở
  `issue_slip_lines`, `pairedSlipId/weavingPointId` ở `issue_slips`, cột + chép dữ liệu cũ ở `weaving_issue_materials`, khoá ngoại / chỉ mục) →
  `prisma migrate deploy` vào `dna_erp_test` và `dna_erp` (cả 2 trên máy, đã kiểm `DATABASE_URL` là localhost) - áp xong. KHÔNG đụng DB production.
- `prisma generate` + `nest build` sạch; FE `tsc --noEmit` sạch (commit mới + phần sửa nhóm 1 không xung đột kiểu); khởi động lại BE thử 3040
  (log không lỗi). Spec của Bảo (`issue-slips` / `weaving-issues` / `warehouse-transfers`) không chạy ở máy - xem CI GitHub.
- Liên quan báo cáo test lần 2: commit này đổi luồng xuất đan (điểm 36b - hộp xác nhận / hàng mang kèm) → lần test sau phải đi lại bước xuất đan
  theo 2 phiếu mới; dữ liệu MY-313 trong `dna_erp_test` là xuất đan theo cách CŨ (trước migration).

## 44. Làm tiếp 4 việc sau test tay lần 2 (NCC 18–21, chặn xuất sắt sớm 30, mã lệnh không nhảy chữ 31, "Khung sẵn để sơn" 34d) + dựng lệnh thử MY-314 xem trên màn phần nhóm 1 (09/11; commit + push 10/11 - mục 49)

Người dùng hỏi "trong báo cáo test 9/11 còn gì có thể thực hiện ngay" → Opus liệt kê 6 việc, người dùng chọn "Làm 1–4 + 5". Opus chia 4 phần
không chung file cho thợ `implementer-sonnet` (BE + FE), một thợ nữa dựng lệnh thử bằng script; Opus review diff thật, sửa thêm, rồi tự đi màn.

**Đã sửa:**
- **18–21 Nhà cung cấp** - BE `src/modules/suppliers/` (`dto/create-supplier.dto.ts`, `dto/update-supplier.dto.ts`, `suppliers.service.ts`,
  spec): tên NCC tự bỏ dấu cách thừa đầu/cuối/giữa; tên rỗng báo "Tên nhà cung cấp không được để trống"; trùng tên (không phân biệt hoa/thường,
  bỏ qua NCC đã xoá; khi sửa thì trừ chính NCC đó) → 409 "Đã có nhà cung cấp tên "…" - kiểm tra lại, không tạo trùng"; nhận `isActive` khi
  thêm mới. FE `Admin/shared/AdminEntityPage.tsx`: ô tick "Đang hoạt động" thẳng hàng với chữ; ô bắt buộc toàn dấu cách coi như trống ("Bắt
  buộc"); `services/suppliers-api.ts` gửi `isActive` khi thêm (trước đây bỏ tick vẫn lưu thành "Hoạt động"). Opus sửa thêm khi đi màn: chữ đỏ
  "Bắt buộc" cũ không tự mất sau khi đã nhập tên - nay xoá lỗi cũ mỗi lần bấm Lưu qua được bước kiểm. Agent đổi 4 file BE sang CRLF - Opus
  đổi lại LF (repo `eol=lf`).
- **30 Xuất sắt chặn sớm** - FE `InboundWarehouse/XuatSatPage.tsx`: bấm thêm dòng mà số cây + số cây CÙNG loại sắt đã có trong phiếu đang lập
  vượt "còn được xuất" → chặn ngay tại ô, báo "Vượt số còn được xuất (N cây) - trong phiếu đang lập đã có X cây" (trước đây tới lúc Lưu phiếu
  BE mới báo); giữ ô "Dài cây" sau khi thêm dòng; gợi ý "còn N sau phiếu đang lập".
- **31 Mã lệnh nhảy chữ** - FE `components/LenhCode.tsx`: thêm `useLenhCodeState` (trả cả `loading`); khi chưa tra xong mã hiện "…" thay vì
  mã gốc rồi nhảy sang mã LSX; quá 4 giây hoặc tra lỗi thì hiện mã gốc. Bỏ lớp bọc cục bộ ở `Phoi/LenhSanXuatPhoi.tsx` (mục 42) vì gốc đã xử lý.
  **Còn nhảy chữ** ở các chỗ dùng hàm tra theo chuỗi `useLenhCodeLookup` (không qua component): `sanxuat/core.tsx` (1 chỗ), `FloorScanApp`,
  `QlsxQueue` (3 chỗ), `KcsStagePage`, `HuongDanCatPage` - chưa sửa.
- **34d "Khung sẵn để sơn"** - FE mới `components/sanxuat/sonThucCo.ts` (+ test 5 ca): số mảnh Hàn đã đạt KCS trừ số Sơn đã báo (lưu đợt + chờ
  KCS + đã đạt), không âm; lấy số Hàn qua `getProductionBatchPlan(lệnh,'HAN')`, lỗi từng lệnh thì bỏ qua. Nối vào `sanxuat/core.tsx`
  (`fetchHanSonRows`, `ThucCoNote` thêm `isSon`) → màn Sơn hiện "Khung sẵn để sơn: N mảnh". CHỈ HIỂN THỊ - không chặn Sơn báo (giữ quyết định
  Hàn/Sơn tự báo, không đối chiếu khâu trước).
- **Opus sửa thêm khi đi màn:** KCS Phôi (`Kcs/KcsPhoiPage.tsx`) + KCS Hàn/Sơn (`sanxuat/kcsCore.tsx`) - nút "Xác nhận duyệt" bị khoá (số lỗi
  vượt) trước đây vẫn trông như bấm được → làm mờ + con trỏ cấm; `ProductionPlan/LenhSXPage.tsx` - cột "Hạn hoàn thành" ở danh sách lệnh KHSX và
  đầu trang chi tiết lệnh tô đỏ + "Quá hạn N ngày" (mục 42 mới tô ở mốc), không tô khi lệnh DONE / CANCELLED.

**Dựng lệnh thử MY-314 trên DB thử `dna_erp_test`** (script ở thư mục tạm của phiên, không đưa vào repo): đơn PO-THU-0911B 10 bộ hạn 05/11 (cố
ý đã qua để xem tô đỏ) → PI-2026-002 → KHSX gửi → Sếp duyệt → QLSX bắt đầu (MY-314) → mua + nhận vật tư (đinh, dây) → xuất sắt XK-261109-004
(6 + 5 cây) → Phôi nhận 6/6 và 4/5 → Phôi cắt sắt hộp 45×695 (báo dư 5) + 40×200 → KCS Phôi đạt → Hàn VIỀN NGẮN 40 → KCS Hàn đạt 40.
Thêm vào DB thử: NCC "Thép Kim Phát (thử)" (số đơn cuối 52) + "Sắt Cũ (thử - ngừng hợp tác)", 2 lý do lỗi "(thử)".

**Xem trên màn (khung 980×700, DB thử)** - ảnh ở `backups/test-tay-2026-11-09/sau-sua-nhom-1/`:
- Phôi nhận sắt bố cục ở ~980 px (`31-phoi-nhan-sat-980px`); bảng cắt Phôi hiện "vượt 5" (`32-phoi-bao-du-vuot-5`).
- KCS Phôi / Hàn: nhập số lỗi lớn hơn số chờ duyệt → viền đỏ + nút mờ, không bấm được (`33-kcs-chan-so-loi-vuot`).
- Hàn: "(bộ)" ở cấp SKU + "Quá hạn 20 ngày" (`34ab-han-bo-qua-han`); Sơn: "Khung sẵn để sơn: 40 mảnh" (`34d-son-khung-san-de-son`).
- Xuất sắt: thêm dòng vượt → "Vượt số còn được xuất (0 cây)", ô Dài cây giữ nguyên (`30-xuat-sat-chan-som`).
- KHSX: mốc tô đỏ + đầu trang "05/11/2026 Quá hạn 4 ngày" (`14-khsx-moc-qua-han`).
- NCC (admin): ô tick thẳng hàng; tên toàn dấu cách → "Bắt buộc"; "  thép  kim phát (THỬ) " → 409 báo trùng tiếng Việt
  (`18-21-ncc-trung-ten`); thêm NCC bỏ tick "Đang hoạt động" → lưu thành "Ngừng hợp tác" (`18-21-ncc-them-ngung-hop-tac`), rồi xoá NCC thử đó.

**Kiểm:** FE `npx tsc --noEmit` sạch; `npx eslint` 10 file đã đổi: 0 lỗi (chỉ cảnh báo `any` / biến thừa có sẵn); `vitest run
src/components/sanxuat src/components/LenhCode --maxWorkers=2` 12/12 (gồm 5 ca `sonThucCo`). BE `jest suppliers.service.spec.ts --maxWorkers=2`
9/9; `nest build` + khởi động lại BE thử 3040 (409 trên màn đến từ bản mới). File BE + changelog đã về LF.

**Ghi nhận khi dựng lệnh:** script ban đầu gửi sai tên trường khi nhận hàng → BE trả 400 nhiều lần, và số phiếu NK-261109-007…057 bị bỏ qua
(số phiếu được lấy trước khi kiểm dữ liệu) - chỉ trên DB thử; nghi phiếu nhập lỗi vẫn "ăn" số → số phiếu thật có thể nhảy cóc. Thuộc phần
phiếu của Bảo - chưa soát code, nên hỏi Bảo cùng nhóm 2.

**Chưa xem được trên màn** (chỉ kiểm qua code + tsc): dải nhắc hoàn tất + thanh nút Sếp ở chi tiết SKU (7/8 - DB thử không có SKU đang chờ
duyệt), "Chưa nhập số LSX" (13), Sếp tự mở tab có việc (16b); mã lệnh không nhảy chữ (31) chưa đo được bằng mắt (chỉ thoáng lúc tải).
→ **Cập nhật mục 45:** đã xem được 7/8, 13, 16b trên màn (sửa tạm DB thử rồi trả lại).

**Chưa làm / còn treo:** các chỗ `useLenhCodeLookup` còn nhảy chữ (liệt kê ở trên → đã sửa ở gốc, mục 45); nhóm 2 gửi Bảo (đầu danh sách là 38 - xuất bao bì trùng
kho, mức cao; 22, 23–25, 26, 36a; 36b/36c phải test lại vì luồng xuất đan mới - mục 43) + ghi nhận số phiếu NK ở trên; nhóm 3 chờ quyết (anh
Nhân: 16+27, 35, 37; khác: 29, 6, 2). Lệnh MY-314 để nguyên trên DB thử (đang chạy) cho lần test sau. Không commit.

## 45. Hết nhóm 1 sau test tay lần 2: mã lệnh không nhảy chữ ở mọi màn, đo lại "~3 giây" Phôi nhận sắt (không tái hiện), xem trên màn 7/8, 13, 16b + bỏ nút Sếp trùng, nới ô tiền tố LSX (09/11; commit + push 10/11 - mục 49)

Người dùng: "thực hiện hết nhóm 1". Rà lại bảng nhóm 1 (điểm 1, 28, 4–5, 7–9, 10–12, 13, 14–15, 16 phần chữ, 31–34): phần code đã xong ở
mục 42 + 44, còn 3 việc - mã lệnh còn nhảy chữ ở các chỗ dùng hàm tra theo chuỗi, "~3 giây" mỗi lần Phôi xác nhận nhận sắt (điểm 31), và 3 chỗ
chưa xem được trên màn (7/8, 13, 16b). Việc nhỏ (≤ 4 file, sửa vài dòng) nên Opus tự làm, không giao thợ.

**Đã sửa (FE `D:\DNA-ERP`):**
- **31 - mã lệnh nhảy chữ, phần còn lại** `components/LenhCode.tsx`: hàm `useLenhCodeLookup` (dùng ở `sanxuat/core.tsx` tiêu đề "Lệnh …",
  `FloorScanApp`, `QlsxQueue` 3 chỗ, `KcsStagePage`, `HuongDanCatPage`) nay cũng trả "…" khi mã PI đang tra, giống `<LenhCode>` ở mục 44 - sửa ở
  gốc, không phải đụng 5 file trên. Chỉ hiện "…" cho mã nằm trong danh sách hook đã hỏi (mã ngoài danh sách không bao giờ được tra → trả nguyên,
  tránh "…" mãi); tra lỗi mạng → mã gốc; bộ mã quá 4 giây chưa xong → mã gốc. Đã soát các chỗ dùng: chỉ để hiển thị / ghép câu xác nhận lúc
  bấm (lúc đó đã tra xong); `HuongDanCatPage` thật ra truyền mã PO nên không đổi gì.
- **8 - nút Sếp trùng** `ProductionPlan/SKUDetail.tsx`: khi SKU chờ Sếp, thanh "Từ chối / Duyệt" dính đầu trang (mục 42) và bộ nút cũ cuối
  trang cùng hiện → cuộn xuống cuối thấy 2 bộ nút. Nay lúc chờ Sếp chỉ còn thanh đầu trang; cuối trang chỉ còn nhãn "✓ Đã duyệt" khi đã duyệt.
- **13 - ô tiền tố LSX** `components/LsxCodeInput.tsx`: chữ mẫu "Tiền tố" bị cắt ("Tiền tí") vì ô rộng 64 px → 76 px (bằng ô chọn tiền tố).

**Điểm 31 "~3 giây" - đo lại, không tái hiện, không sửa:**
- Gọi thẳng API nhận sắt trên DB thử (đưa tạm đợt 34, 35 của MY-314 về "chờ nhận", gọi, rồi trả đúng giá trị cũ): 30 ms (đủ cây) và 64 ms
  (thiếu cây - có gửi thông báo lệch). Tải lại danh sách sắt 35 ms.
- Bấm trên màn (đợt 35, đếm 4/5): nút "Đang lưu…" ~0,1 s, ~0,2 s sau dòng đã hiện "Nhận 4/5 cây". Ghi nhận phụ: sau khi nhận, màn tải lại 3
  danh sách 2 lần (1 lần do màn tự gọi, 1 lần do tin realtime ~0,4 s sau) - thừa nhưng nhẹ (≤ 60 ms mỗi lần), chưa sửa.
- Nhiều khả năng lần test trước chậm do khung trình duyệt bị ẩn (trang chạy nền, hẹn giờ bị dồn) hoặc máy đang bận, không phải do code. Phụ
  tác dụng trên DB thử: thêm 2 thông báo "nhận lệch" của đợt 35.

**Xem trên màn (DB thử, sửa tạm rồi trả lại đúng giá trị cũ)** - ảnh ở `backups/test-tay-2026-11-09/sau-sua-nhom-1/`:
- **7** (KHSX): tạm đặt nhóm mảnh của SKU 108 thành "đã duyệt" → đầu chi tiết SKU hiện dải vàng "Bước tiếp theo: bấm nút Xác nhận hoàn tất…" kèm
  nút "Xác nhận hoàn tất — Định mức mảnh" (`07-sku-dai-nhac-xac-nhan-hoan-tat`); không bấm. Trả lại "bị từ chối" (giữ lý do, giờ duyệt cũ).
- **8** (Sếp): tạm đặt SKU 109 "chờ Sếp duyệt" → thanh "SKU đang chờ Sếp duyệt · Từ chối · Duyệt" dính đầu vùng cuộn, cuộn 1.500 px vẫn ở trên
  và không bị đầu trang che (`08-sep-thanh-duyet-dinh-dau-trang-truoc-bo-trung` - thấy 2 bộ nút; `08-sep-thanh-duyet-dinh-dau-trang` - sau khi bỏ
  trùng còn 1). Trả lại "đang làm định mức".
- **16b** (Sếp): tạm đặt dòng lệnh MY-314 "chờ Sếp duyệt" (SKU mới = 0) → vào "Tổng hợp chờ duyệt" tự mở tab "Lệnh sản xuất 1"
  (`16b-sep-mo-tab-co-viec`; danh sách bên trong trống là do chỉ sửa tạm 1 cột, không phải lỗi). Trả lại "đã duyệt".
- **13** (KHSX): tạm xoá số LSX của MY-314 → ô "Tiền tố / Số", bấm Lưu khi trống số → "Chưa nhập số LSX" (`13-so-lsx-chua-nhap`); thấy chữ mẫu
  bị cắt → nới ô (ở trên), đo lại chữ 50 px / ô 58 px. Trả lại số MY-314. Không có tiền tố gợi ý vì Admin chưa khai danh sách tiền tố (việc dữ
  liệu đã ghi ở nhóm 4).
- **31 mã lệnh:** chưa bắt được trên màn - các màn dùng hàm này đều nằm sau 1 màn đã tra sẵn mã (bộ nhớ tạm 2 phút), còn "Hướng dẫn cắt" dùng
  mã PO. Kiểm qua code + tsc + test.

**Kiểm:** FE `npx tsc --noEmit` sạch; `eslint` 4 file đổi ở mục này: 0 lỗi, số cảnh báo bằng bản HEAD; `vitest run src/components
src/modules/pages/Floor --maxWorkers=2` 97/97. Không đụng BE. File FE giữ CRLF như cả repo.

**Nhóm 1 coi như xong.** Còn lại ngoài nhóm 1: nhóm 2 gửi Bảo (38 đầu danh sách + số phiếu NK nhảy cóc - mục 44), nhóm 3 chờ quyết (anh Nhân:
16+27, 35, 37; khác: 29, 6, 2), nhóm 4 việc dữ liệu (Admin khai tiền tố số LSX trước khi chạy thật). Không commit.

## 46. File Word tổng hợp mọi câu chờ anh Nhân chốt (23 câu + 1 xin dữ liệu) - ghi đè file xác nhận 09/11 (09/11)

Người dùng: "những gì cần hỏi Nhân hãy list tất cả" → Opus gom từ file hỏi 04/11, file xác nhận 09/11 (mục 39), báo cáo test tay lần 2
(mục 41) và các chỗ đang làm theo mặc định trong changelog; bỏ câu anh Nhân đã trả lời (số LSX trùng → thêm đuôi, tính lại số mua khi nhu cầu
giảm = câu 2.5, chiều dài chuẩn). Người dùng: "Soạn file Word".

**File:** ghi đè `docs/xac-nhan-anh-nhan-sau-chay-thu-2026-11-09.docx` (theo ghi nhớ: sửa thẳng file cũ, không tạo bản 2; bản trước chép phòng
hờ ở thư mục tạm của phiên). 5 trang A4, Arial, lời thường, mỗi câu có đề xuất IT (chữ xanh) + ô ☐ + chỗ ghi ý kiến. Script mới
`.claude/tools/huong-dan-test-phan-a/build_xac_nhan_anh_nhan_tong_hop.py` (cùng khuôn `build_xac_nhan_0911.py`; chạy với docx mẫu KHÁC file ra).
Không commit docx.

**Nội dung:** câu 1–5 GIỮ NGUYÊN số / thứ tự như bản trước (lỡ anh Nhân đã trả lời bản cũ thì vẫn khớp), 3 câu gấp tô đỏ ở đầu file:
- Phần 1 (sau chạy thử 07/11): 1 carton ở Kho thành phẩm **[GẤP]** (= điểm 38 test lần 2, đang kẹt mọi lệnh đóng ở Kho thành phẩm); 2 Pat / La
  tấm; 3 Quản lý SX bấm Bắt đầu 2 chỗ; 4 đóng gói - gộp thêm điểm 35 (300 thùng khi mảnh đạt chuyền kiểm chỉ đủ ~297 bộ), 4 lựa chọn; 5 Phôi
  báo vượt - ghi rõ IT đã làm theo đề xuất A ở bản thử, chỉ cần xác nhận.
- Phần 2 (sau test tay lần 2, câu mới): 6 làm tròn lên số mua vật tư đếm cái / cuộn **[GẤP]** (điểm 16 + 27); 7 tồn đủ vẫn mua phần hao (câu
  "hỏi anh Nhân" từ review 04/11 - không thấy ghi đã hỏi); 8 booking bắt buộc CUT OFF hoặc Ngày lấy cont (37); 9 gộp thông báo "hàng về kho"
  (29); 10 bắt buộc lý do từ chối SKU (6 - DB 26/10: cả 15 SKU bị từ chối chỉ ghi lý do "."); 11 đơn có hạn giao đã qua - giữ cảnh báo hay
  chặn (mục 42); 12 chữ "Tên PI" ở Lịch xuất hàng (mục 40 - có thể là PI của khách, không có đề xuất IT); 13 câu giới thiệu màn đăng nhập
  (2 - ghi "có thể cần Sếp duyệt").
- Phần 3 (file 04/11 chưa trả lời, dạng bảng có ô Đồng ý / Khác): 14–19 = 1.1–1.6 đồng bộ Phôi – Hàn theo mảnh (17 = 1.4 ghi "IT đã làm
  theo cách này") + lưu ý NV định mức rà công đoạn Tán / Dập; 20–22 = 2.1–2.3 (ghi "đang chạy"); 23 = 2.4 xưởng dự kiến lúc tính cắt
  **[GẤP]** (phần tính sắt cần mua theo xưởng đang chờ).
- Phần 4: xin danh sách tiền tố số LSX theo khách để Admin khai.
- Không đưa: phần máy cắt (để sau khi xong + test hết 12 yêu cầu theo ghi nhớ); câu cho Bảo (số phiếu NK nhảy cóc, nhóm 2).

**Kiểm:** XML hợp lệ; mở bằng Word thật → PDF 5 trang → xem cả 5 ảnh trang: không tràn bảng, câu không bị cắt giữa trang (hàng `cantSplit`).

**Chưa làm:** chưa gửi (người dùng tự mang đi hỏi); khi có câu trả lời → cập nhật kế hoạch + làm theo.

## 47. Pat làm như chân nhôm - điều tra: Pat / Sắt phi (cắt) rơi khỏi tính mua vì chỉ đếm dòng tick "Đan"; vướng tồn Pat ảo - CHỜ người dùng chọn cách, chưa sửa code (09/11)

Người dùng trả lời câu 2 (Pat / La tấm) của file hỏi anh Nhân: "PAT làm tương tự với chân nhôm". Opus đọc code + DB thử (dữ liệu 26/10):
- Pat và chân nhôm cùng một cơ chế: nhóm con Sắt "Vật tư thành phẩm" trong định mức mảnh + công thức "1 đơn vị nguyên liệu ra N cái" (bảng công thức:
  chân nhôm ← thanh nhôm 161 / 12 / 193; 14 loại Pat ← La tấm; Sắt phi 4/6/8 (cắt) ← Sắt phi theo kg). Chưa định mức nào dùng chân nhôm.
- Cả tính mua nguyên liệu (`MaterialYieldRecipesService.getProductionDemand` → `MaterialYieldRecipePurchaseService`) lẫn danh sách cắt + tiến độ
  của Phôi (`ProductionBatchesService.getMaterialYieldPlanBatch`) chỉ đếm dòng `PieceMaterialItem.includeInWeaving = true` (ô "Đan" ở màn định mức).
  Cả 16 loại vật tư (Pat + Sắt phi cắt, ~100 dòng) đều KHÔNG tick → không sinh dòng mua La tấm / Sắt phi, Phôi không thấy để cắt.
- Vướng khi bỏ điều kiện tick: Phôi cắt xong + KCS đạt công đoạn cuối → cộng tồn vật tư ra (`finalizeRecipeOutputIfLastStepComplete`); chân nhôm
  rời tồn ở xuất đan, Pat (hàn vào khung) không có bước nào trừ → tồn ảo tăng, lần tính mua sau trừ tồn đó (`onHandOutputQty`) → mua THIẾU La tấm.
- Đề xuất cho người dùng: (1) dòng không tick Đan → KCS đạt thì ghi luôn "đã dùng cho Hàn" (vào rồi ra, tồn không đổi, như đoạn sắt Phôi → Hàn) -
  hoặc vào tồn + phiếu chuyển sang Hàn (đụng phần kho của B); (2) áp cho mọi dòng Vật tư thành phẩm (ô Đan chỉ còn nghĩa "đi kèm xuất đan") -
  hoặc chỉ Pat. Người dùng chưa hiểu câu hỏi trong hộp chọn → đã giải thích lại bằng ví dụ (lệnh A cắt 3.200 Pat, lệnh B không mua La tấm).

**Chưa làm:** chờ người dùng chọn; chưa sửa code; file hỏi anh Nhân câu 2 chưa đánh dấu "đã chốt".

## 48. Trả lời file Bảo hỏi "Đổi xưởng khi lệnh đã có phương án cắt / đã giữ sắt" (4 câu) - file Word đã điền (10/11)

Người dùng gửi file Bảo hỏi (`Downloads\CAU_HOI_SANG_DOI_XUONG_10-11-2026.docx`, 4 câu, kèm phần anh Nhân đã chốt 10/11: đổi xưởng được khi chưa
xuất sắt; đổi xong phương án cắt "cần kiểm lại", KHSX kiểm / tính lại rồi bấm "Đã kiểm", trước đó cấm chuyển / xuất sắt; dòng mua chưa về đổi
nơi nhận; sắt đã giữ chuyển bằng phiếu nhưng phải tính lại). Opus đối chiếu code rồi người dùng: "xuất ra file word".

**Sự thật trong code (để trả lời):** `changeWorkshop()` đang chặn khi đã xuất sắt / xuất vật tư / giữ chỗ hoặc đang mua vật tư kho Phôi-Hàn (chặn
tạm Đợt 7 của B). Đã có đường "Tính lại" cho lệnh có phương án APPROVED: phương án mới không tự duyệt (`autoApproveBlockReason` ca b), KHSX duyệt
tay → `approve()` đánh SUPERSEDED bản cũ + `releaseByRef` giữ chỗ cũ + giữ chỗ lại theo kho Phôi của xưởng (`WorkshopWarehouseResolver`) + tính
lại dòng mua sắt (`planPurchaseRecompute`: chưa ký sửa số, đã ký giữ + `notifyPurchaseDemandDropped`). Bảng `Workshop` chưa có chiều dài chuẩn
(Đợt 8 chưa làm).

**Phát hiện:** đề xuất A câu 2 của B ("Đã kiểm" = duyệt phương án mới) + luật anh Nhân "chưa Đã kiểm thì chưa chuyển sắt" → lúc duyệt, sắt còn ở kho
xưởng cũ, kho xưởng mới thấy 0 → đề xuất mua thêm đúng số sắt đó (mua trùng).

**Đã trả lời (file `docs/cau-hoi-sang-doi-xuong-10-11-2026-TRA-LOI.docx`, 3 trang, chữ xanh đậm "Sang:", lời thường; script
`.claude/tools/huong-dan-test-phan-a/tra_loi_bao_doi_xuong_1011.py` - chỉ sửa document.xml của file gốc, bản gốc trong Downloads giữ nguyên):**
- Câu 1 ☒ A: A làm cờ + nút "Đã kiểm" + thông báo; A bật cờ ngay trong lúc đổi xưởng (cùng lần lưu) - B không cần gọi hàm, chỉ đọc cờ; chỉ bật
  khi lệnh có phương án đã duyệt; tên cờ báo B khi làm xong.
- Câu 2 ☒ B (hiện tại): đã có đường tính lại (mô tả như trên); chưa chọn A vì mua trùng. Hiện 2 xưởng cùng chiều dài → KHSX xem lại, "Đã kiểm" giữ
  nguyên, thủ kho chuyển sắt KÈM giữ chỗ sang kho mới. Khi phải tính lại thật (sau Đợt 8): tính lại để xem → "Đã kiểm" → chuyển sắt → duyệt
  phương án mới → chỉ mua phần thiếu; xuất sắt chờ phương án mới được duyệt.
- Câu 3 ☒ A: B làm phần kho + mua ngay; Đợt 8 ~9 ngày công, ngày cụ thể báo sau (người dùng sửa nếu có ngày); chốt 10/11 gỡ được chỗ Đợt 8 chờ.
- Câu 4 ☒ A + 3 ý: hàm của B chạy trong cùng giao dịch đổi xưởng (lỗi thì huỷ cả), thông báo gửi sau khi lưu; B gỡ chặn tạm Đợt 7; cờ do A bật.

**Kiểm:** XML hợp lệ; Word thật → PDF 3 trang, xem cả 3 ảnh trang (4 ô ☒, chữ trả lời không tràn khung). Không commit docx.

**Liên quan:** chốt 10/11 trả lời gần hết câu 23 (= 2.4 "xưởng dự kiến") của file hỏi anh Nhân (mục 46) - chỉ còn ý "KHSX tính trước theo xưởng mặc
định Phú An" chưa nói rõ; lần cập nhật file sau đánh dấu câu 23 + câu 2 (Pat). **Chưa làm:** chưa gửi Bảo (người dùng tự gửi); chưa code phần cờ /
nút "Đã kiểm" (việc của A sau khi Bảo đồng ý).

## 49. Commit + push phần sửa sau test tay lần 2 (mục 41.5, 42, 44, 45) + changelog; che chi tiết review bảo mật vì repo công khai (10/11)

Bối cảnh: máy mới (khôi phục từ bản zip chép máy). Cùng ngày đã commit + push Việt hoá thông báo lỗi (BE `3a4afd2`, FE `c12ca3e`) và 2 lỗi
phát hiện khi kiểm thử E2E trên trình duyệt (BE `3368dc5` quyền KCS, FE `4863a9d` lệch cột hạn giao) - xem
`docs/changelog-2026-11-10-viet-hoa-thong-bao-loi.md`, `docs/changelog-2026-11-10-sua-loi-kiem-thu-e2e.md`. Người dùng hỏi phần còn chưa commit
gồm gì → chính là các mục 41.5, 42, 44, 45 (đã kiểm từ 09/11, chưa từng commit) → "Commit + push".

**Đã commit:**
- FE `330fda0` "Sửa sau test tay lần 2 (09/11)" - 21 file (gồm file mới `components/sanxuat/sonThucCo.ts` + test: `core.tsx` import file này,
  thiếu thì build gãy).
- BE `2519679` "Nhà cung cấp: chuẩn hoá tên, chặn trùng tên, nhận isActive khi thêm" - `src/modules/suppliers/` (4 file).
- BE commit docs này: changelog phần A (mục 4–49), changelog tem QR (mục 28.7, 58–64.1), kế hoạch phần A, dòng trạng thái 4 changelog đợt nhỏ,
  dòng trạng thái 2 changelog 10/11.

**Trước khi commit:** FE `tsc --noEmit` sạch; eslint 21 file 0 lỗi; `vitest run src/components src/modules/pages/Floor
src/modules/pages/ProductionPlan src/modules/pages/Sales src/services` 18 file / 185 test xanh. BE jest `src/modules/suppliers` 9/9; `tsc` không lỗi
trong `src`. FE `.env.example` đang bị xoá (bản zip chép máy không có file này) → khôi phục từ git, không commit việc xoá.

**Rà docs trước khi đưa lên repo công khai:** không có mật khẩu / chuỗi kết nối DB / khoá / IP nội bộ (chỉ `127.0.0.1` và 2 URL công khai
Render / Vercel vốn đã có trong `.env.example`). Đã che: (1) gạch "Bảo mật" và 2 ý phân quyền kho trong gạch "Chức năng" của mục 41 - bản đầy đủ
chỉ giữ trong máy ở `backups/review-bao-mat-chuc-nang-2026-11-09.md` (`backups/` gitignore); (2) tên riêng của Giám đốc → "Sếp" (theo tiền lệ
changelog Đợt 4); (3) tên đăng nhập 3 nhân viên Mua hàng ở mục 41.4.

**Cố ý không commit (FE):** `next-env.d.ts` (Next.js tự sinh lại khi chạy dev), `tsconfig.tsbuildinfo` (file tạm của tsc), `pnpm-lock.yaml` +
`pnpm-workspace.yaml` (FE dùng npm), `e2e/golden-path.spec.ts` (đổi tên khách thử), `docs/quy-doi-doan-phoi.md` (bản thiết kế quy đổi cây → đoạn,
người dùng chưa chọn). Các file chỉ giữ trong máy như cũ: `CLAUDE.md`, `AGENTS.md`, `.claude/`, docx / pdf / xlsx báo cáo, `docs/business/`.
