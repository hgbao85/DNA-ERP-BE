# Changelog 2026-09-30 — Solve trước → tạo PI (KHSX tính cắt sắt trước, QLSX/Sếp duyệt số thật) + UI/UX + KHSX đổi ngưỡng hao hụt mặc định + bỏ ngưỡng riêng của Sắt

> Trạng thái: **ĐÃ LÀM + ĐÃ LIVE-TEST** (BE + FE, local). Chưa deploy. Việc còn treo ở mục 7.
> Bối cảnh/đánh giá trước đó: `changelog-2026-09-30-review-dua-solve-len-khsx.md`.

## 1. Yêu cầu

Người dùng: đưa Solve lên trước — KHSX bấm tính ở "Tối ưu cắt sắt", **xong mới từ đó tạo PI**, QLSX/Sếp
duyệt đúng số đó; KHSX xem được tiến độ solve như admin. Mọi chức năng cũ của màn "Tối ưu cắt sắt"
(bảng ước tính, gợi ý gộp, chế độ đặc cách, chiều dài cây theo quy cách) **giữ nguyên**.

## 2. Luồng mới

1. KHSX tick SKU → **"Tính phương án cắt"** (`POST /cutting-batch-solve`) → `CuttingProposal` CALCULATING
   **chưa có PI/PO**, kèm ảnh chụp đầu vào (`CuttingProposalItem`: SKU, số lượng, BOM revision ACTIVE
   lúc tính) + `solverOptions` (thông số đợt). Solver chạy nền qua hàng đợi FIFO sẵn có.
2. Tính xong → DRAFT, **không tự duyệt, không đụng kho/mua**; báo đích danh người bấm
   (`CUTTING_SOLVE_DONE` / `CUTTING_SOLVE_FAILED` kèm lý do).
3. Tạo PI (`/production-invoices/merge` hoặc `/items/:id/claim-solo`, **bắt buộc `cuttingProposalId`**)
   chỉ khi qua cổng: không loại sắt nào vô nghiệm/vượt ngưỡng/hết giờ, **chưa lỗi thời** (SKU vẫn chưa
   gom, số lượng không đổi, BOM ACTIVE vẫn đúng revision đã tính), tập SKU khớp tuyệt đối. Thông số cắt
   của PI lấy từ chính lượt tính (không nhận lại từ client).
4. QLSX → Sếp duyệt. Sếp duyệt: kiểm lại lỗi thời + vật tư đã có Kho **trước** khi ghi APPROVED → tạo
   PO **ghim revision đã tính** → `approve()` phương án có sẵn (giữ chỗ tồn + đề xuất mua) → 2 nguồn mua
   VTTP/tiêu hao. **Không gọi solver lần 2.**
5. QLSX/Sếp từ chối: gỡ phương án khỏi PI (SUPERSEDED, `productionInvoiceId=null`) trước khi xoá PI (tránh
   lỗi FK); SKU về "chưa gom" như cũ, KHSX tính lại.
6. PI theo luồng cũ (chưa có phương án) vẫn duyệt như trước (solver chạy sau khi Sếp duyệt).

## 3. Thay đổi

**BE (DNA-ERP-BE)**
- `prisma/schema.prisma` + migration `20260930010000_cutting_proposal_pre_pi` (thuần cộng thêm): bảng
  `cutting_proposal_items`, cột `cutting_proposals.solverOptions`.
- `cutting-proposals.service.ts`: `requestForBatch`, `getBatchSolves`, `assertReadyForInvoice`,
  `assertReadyForApproval`, `attachToInvoice`, `releaseForInvoice`, `findPreSolvedForInvoice`,
  `invoiceReadinessReason` (cổng + lỗi thời), `buildBatchJob`, tách `aggregateDemand` dùng chung với
  `buildInvoiceJob`; `runSolverAndSave(preInvoice)` bỏ tự duyệt + thông báo; `approve()` chặn phương án
  tính trước khi Sếp chưa duyệt PI; `computeDisplayStatus` coi DRAFT tính trước là bình thường;
  `countNeedsAction` loại lượt tính trước (việc của KHSX, không phải QLSX).
- `production-invoices.service.ts`: `mergeItems/claimSolo` đổi chữ ký (gate + gắn phương án);
  `approveItem/approveBatch/retryProductionOrder` có nhánh phương án tính sẵn (`finalizePreSolvedProposal`);
  4 chỗ xoá PI gọi `releaseForInvoice`; `computeNonSteelPurchaseProposals` gom 2 trigger mua dùng chung;
  PI response có `cuttingPlan {proposalId,status,totalBars,wastePercentage}`.
- `production-orders.service.ts`: `createFromApproval(…, pinnedBomRevisionId?)`.
- Controller: `POST /cutting-batch-solve` (CREATE + role KHSX), `GET /cutting-batch-solves`.
- Quyền: KHSX thêm `CUTTING_PROPOSAL:CREATE` (**production phải chạy `npm run seed`**).
- Thông báo mới: `CUTTING_SOLVE_DONE`, `CUTTING_SOLVE_FAILED`. DTO `merge`/`claim-solo` chỉ còn
  `cuttingProposalId` (+ danh sách SKU).

**FE (DNA-ERP)**
- `GomDotCatPage.tsx`: 2 nút cũ → **"Tính phương án cắt (N SKU)"** (đổi thành "Tính lại" khi đã có kết quả);
  poll 4s khi đang tính; chữ hướng dẫn "chờ duyệt tay / chạy sau khi Sếp duyệt" sửa lại.
- Mới `CuttingSolvePanel.tsx` (tiến độ + bảng kết quả từng loại sắt + nút tạo lệnh chỉ bật khi `ready`, nêu
  lý do khi chưa + lịch sử lượt tính) và `CuttingPlanNote.tsx` (tóm tắt + chi tiết phương án ở màn duyệt
  của QLSX/Sếp, 2 vị trí trong `LenhSXPage.tsx`). `cutting-batch-api.ts`, `production-invoices-api.ts` cập nhật.

## 4. Kiểm tra

- BE: `tsc` sạch (trừ lỗi cũ ở mục 6), `eslint` sạch file đã đổi, **jest 1316/1316** (thêm ~50 test: chụp ảnh +
  supersede, chặn CALCULATING trùng, cổng vô nghiệm/vượt ngưỡng/lỗi thời/lệch tập, approve chặn sớm,
  runSolver không tự duyệt + thông báo, duyệt/từ chối/retry PI có phương án, `cuttingPlan`).
- FE: `tsc` sạch, eslint 0 lỗi, vitest 58/58.
- **Live-test (DB local + solver thật localhost:18080 + UI), log BE không có ERROR/WARN:**
  - Gộp 2 SKU (BAN-J55×20 + GHE-J55×30): tính ~151s → 246 cây, 0,271%, `ready:true`, thông báo tới KHSX,
    **0 đề xuất mua/giữ chỗ** trước khi duyệt. Cổng: sai tập SKU → 409; body cũ thiếu id → 400; duyệt tay sớm → 409.
  - Tạo PI-2026-014 → QLSX → Sếp `approve-batch`: 201 trong ~0,4s, **đúng 1 phương án (#23) cho PI, không có lượt
    solver thứ 2**, PO ghim revision 1/13 đúng ảnh chụp, đề xuất mua #11 khớp số solver (HOP-50X50: 9 cây −
    7 tồn = mua 2).
  - SKU đơn (Bàn 8 Meiying): bấm Tính lần 2 khi đang chạy → 409 chặn; đổi số lượng trong DB → `ready:false`
    "Số lượng đã đổi…" và tạo PI bị chặn; khôi phục → tạo PI-2026-015 OK; **QLSX từ chối → PI xoá không lỗi FK**,
    phương án #24 SUPERSEDED, SKU về "chưa gom".
  - Đường cũ (PI-2026-013 tạo trước): Sếp duyệt → solver chạy sau duyệt, tự duyệt (#25 APPROVED).
  - UI thật: KHSX tick → Tính → bộ đếm giây + tự cập nhật → bảng kết quả (6m / `4m22 đặt riêng`) → Tạo lệnh
    → chuyển sang "Lệnh sản xuất mới"; Sếp thấy "Phương án cắt đã tính 24 cây · 0,40%" + chi tiết ở danh sách
    lẫn hộp thoại xác nhận → Duyệt → phương án #26 APPROVED, đề xuất mua #13 (VUONG-20X20 mua 3 × 4220mm).
- Dữ liệu test còn lại trong DB local: đơn LT-SOLVE-1/2, PI-2026-014/015, phương án #23-26, đề xuất mua #11/#13.

## 4b. Tối ưu UI/UX màn "Tối ưu cắt sắt" (cùng ngày, theo yêu cầu "đơn giản, dễ dùng cho công nhân")

Quyết định: **không tạo màn/menu mới** — tách ngay trong màn hiện có (mỗi việc một chỗ, đúng thói quen ERP
"chọn → theo dõi → tạo chứng từ"):
- **2 tab**: "Chọn và tính" | "Kết quả đã tính (n · xong)". Bấm Tính → tự chuyển sang tab kết quả. Vào lại màn
  (kể cả từ thông báo "đã tính xong") mà đã có lượt tính → mở thẳng tab kết quả, thẻ mới nhất mở sẵn.
- **Thẻ theo từng lượt tính** (thay khối gắn với tổ hợp đang tick): tick khác đi không còn làm kết quả biến mất;
  tạo lệnh lấy SKU từ chính lượt tính. Thẻ viền xanh + nút "Tạo lệnh sản xuất" **chỉ hiện khi tạo được**; chưa được
  thì hiện lý do (vàng) + "Quay lại chỉnh" thay vì nút mờ.
- **Thanh hành động cố định ở đáy** (sticky): "Đang chọn N SKU · chưa tính" + nút Tính luôn thấy; "Chế độ cắt" thu
  gọn thành 1 chip (không tự bung khi vượt ngưỡng nữa, chỉ nhắc 1 dòng).
- Chú thích dài về dấu ≥/? rút còn 2 câu; phụ đề sửa cho đúng luồng mới; thời gian giải hiện 1 chữ số thập phân;
  đang tính có ghi "lượt khác đang chạy thì xếp hàng".
- Live-test lại trên UI thật: gộp BAN-8-MEIYING + GHE-TINH-YEU → tab kết quả tự mở, tải lại trang vẫn đúng tiến độ,
  xong (giải 454s) → bấm "Tạo lệnh sản xuất (gộp 2 SKU)" → PI-2026-016 (phương án #27, 73 cây, 0,253%), log BE sạch.
- Chưa làm: số nhỏ trên menu "Tối ưu cắt sắt" (cần thêm 1 request ở app shell), hiện "xếp sau N lượt" (cần BE trả
  vị trí hàng đợi), link thông báo mở đúng thẻ (hiện mở tab kết quả với thẻ mới nhất).

## 4c. KHSX tự đổi ngưỡng hao hụt mặc định (cùng ngày) — **ĐÃ BỎ khỏi giao diện KHSX ở mục 4g** (BE endpoint còn, không UI nào gọi)

Yêu cầu người dùng: "tôi sợ không phải là lâu mà sợ không ra kết quả tôi cần" → KHSX phải tự nới được
ngưỡng ngay khi thấy loại sắt bị chặn, không phải nhờ Admin. (Đính chính so với câu trả lời sớm trong phiên:
`SystemConfigPage` KHÔNG có ô này — trước đây chỉ sửa được qua API/DB.)

- **BE**: `GET /system-config/cutting-defaults` (CUTTING_PROPOSAL:VIEW) và
  `PUT /system-config/cutting-defaults/max-waste` (CUTTING_PROPOSAL:CREATE + role KHSX/ADMIN). Cố ý KHÔNG cấp
  `SYSTEM_CONFIG:UPDATE` cho KHSX (sẽ mở luôn sửa thông tin công ty, chiều dài cây, thời gian solver...). Chỉ ghi đúng
  cột `solverMaxWastePercentage`, giá trị 0,01-100. Không cần Sếp duyệt trước; thay bằng: `SystemConfig` vào
  `AUDITED_MODELS` (AuditLog ghi ai đổi, cũ → mới) + thông báo `CUTTING_WASTE_DEFAULT_CHANGED` cho Sếp + QLSX (kèm lý
  do tuỳ chọn). Giá trị không đổi → không ghi, không báo. Chỉ áp cho loại sắt CHƯA có ngưỡng riêng và các lượt tính
  từ sau (lượt đã tính giữ nguyên).
- **FE** (`GomDotCatPage.tsx`, tab "Chọn và tính"): thanh "Ngưỡng hao hụt mặc định 1% — cho loại sắt chưa có ngưỡng
  riêng [Đổi]"; ô nhập + lý do + gợi ý "Đợt đang chọn cần ≥ X% (loại sắt) — dùng số này"; cảnh báo khi > 3%; lưu xong
  báo "Đã đổi a% → b%. Đã báo Sếp và QLSX." và tải lại bảng ước tính. Nhắc rõ: chỉ nới cho MỘT đợt gấp thì dùng "Chế độ
  cắt" (đặc cách, Sếp duyệt).
- **Kiểm tra**: jest 1324/1324 (thêm 8 test service: chỉ ghi đúng 1 cột, thông báo, không đổi thì bỏ qua, lỗi thông báo
  không phá, 404), tsc/eslint sạch, vitest 58/58. **Live-test**: khsx đọc 1% → sales 403 ("thiếu quyền"), qlsx 403
  ("role"), giá trị 0/150/"abc" → 400, khsx đổi 1,5 OK, đổi lại 1,5 → không ghi/báo thêm; AuditLog `1 → 1.5` kèm userId; Sếp
  + QLSX nhận thông báo, KHSX (người đổi) không bị báo thừa; bảng ước tính đổi ngưỡng theo. Trên UI: đổi 1,5 → 2,5 bằng gợi ý
  → SAT-PHI-4 (2,41%) hết "vượt ngưỡng". Solve thật cho GHE-J55×25: cả 7 loại sắt áp ngưỡng 2,5%, **SAT-PHI-4 ra 13 cây/2,41%**
  (trước đó bị chặn ở 1,5%), `ready:true`. Đã khôi phục 1% cho DB local (tạo thêm 1 dòng audit + 1 thông báo).
- Lưu ý: FE dev server từng trả 404 cho /login do tiến trình cũ giữ cổng 3000 — khởi động lại là hết, không liên quan code.
- Chưa làm: chặn/nhắc khi KHSX đổi nhiều lần liên tiếp (chưa thấy cần), màn xem lịch sử đổi ngưỡng cho KHSX (Admin xem
  qua Audit log), bỏ hẳn "ô tự tính" trên `SystemConfigPage` (Admin vẫn sửa được qua PUT /system-config).

## 4d. "Vượt ngưỡng" không chặn tạo lệnh nữa — chỉ cảnh báo người duyệt (cùng ngày)

Người dùng chất vấn: "KHSX được toàn quyền nhập hao hụt mà chặn làm gì?" và "Admin chỉ để xử lý sự cố" → đúng: KHSX
tự nâng ngưỡng được (mục 4c) nên chặn ở cổng tạo lệnh là rào giả (nâng số là qua) mà QLSX/Sếp không thấy gì.
- **BE** (`cutting-proposals.service.ts`): `invoiceReadinessReason` chỉ còn chặn khi (a) đang tính/lỗi, (b) có loại sắt
  KHÔNG có cách cắt nào (vô nghiệm/hết giờ - không có số cây để mua), (c) lỗi thời. Vượt ngưỡng → `ready:true` kèm
  `invoiceReadiness.warning`; `displayStatus` OK (không "Cần xử lý"); thông báo `CUTTING_SOLVE_DONE` ghi chú "(có loại sắt
  vượt ngưỡng)"; PI response `cuttingPlan.hasOverThreshold`. Đường CŨ (`autoApproveBlockReason`, solver chạy sau khi Sếp
  duyệt) giữ nguyên chặn tự duyệt vượt ngưỡng.
- **FE**: khung vàng "Lưu ý" ở thẻ kết quả (KHSX), nhãn đỏ "Có loại sắt VƯỢT NGƯỠNG hao hụt" ở `CuttingPlanNote` (QLSX/Sếp);
  chữ hướng dẫn ở "Chế độ cắt" sửa cho đúng.
- Live-test: ép cờ vượt ngưỡng lên phương án #28 → `ready:true` + warning → tạo PI-2026-017 OK → Sếp thấy nhãn đỏ trên UI.

## 4e. Bỏ ô % hao hụt của vật tư nhóm Sắt (Admin), review 2 category mới (cùng ngày)

Yêu cầu: Admin > Vật tư — nhóm **Sắt** (`STEEL_BAR`, qua solver) bỏ hẳn ô nhập % hao hụt để KHSX toàn quyền; nhóm **Sắt tự
tính** (`SAT_TU_TINH`, không qua solver) và các nhóm khác giữ nguyên.
- **Review commit DEC79-82** (BE `2d98add`, FE `cc171a3`): thêm nhóm hệ thống thứ 7 `SAT_TU_TINH` (seed "nhận nuôi" nhóm tên
  "Sắt tự tính", tiền tố `STT`) + chức năng "Sửa hao hụt hàng loạt" (`PATCH /materials/bulk-waste` + modal). Nhóm hoạt động đúng
  (đã `npm run seed` local: có nhóm id 7). Phát hiện: (1) bulk ghi `maxCuttingWastePercentage` cho Sắt → nay chặn; (2) `updateMany`
  của bulk **không vào AuditLog** (extension chỉ bắt create/update/delete từng dòng) — chưa sửa; (3) **`purchaseWastePercentage`
  (ô % hao hụt của Sắt tự tính và mọi nhóm khác) CHƯA được luồng mua nào đọc** (grep: chỉ materials.service/dto) — nhập vào chưa có
  tác dụng lên số lượng đề xuất mua; xem mục 7.
- **BE**: `resolveWasteFields` bỏ qua `maxCuttingWastePercentage` với Sắt; API trả luôn `null` cho field này; solver KHÔNG còn gửi
  `max_waste_percentage_by_material`; ước tính/preview/hiển thị chỉ dùng ngưỡng chung `SystemConfig.solverMaxWastePercentage`
  (dữ liệu cũ trong cột `materials.maxCuttingWastePercentage` giữ nguyên nhưng không code nào còn đọc — không migration xoá để
  khỏi mất dữ liệu; schema.prisma ghi rõ "đã bỏ khỏi luồng"). Bulk: chọn nguyên nhóm Sắt → 400 "KHSX quyết định"; chọn tay lẫn Sắt →
  bỏ qua Sắt, trả `{updated, skippedSteel}`.
- **FE**: form vật tư bỏ ô "Ngưỡng hao hụt cắt cho phép"; cột "% hao hụt" chỉ còn "% · mua"; modal hàng loạt loại Sắt khỏi danh sách và
  khoá nhóm Sắt, thêm ghi chú giải thích; `materials-api` không gửi ngưỡng cắt nữa.
- **Kiểm tra**: jest 1333/1333 (viết lại 11 test cũ mô tả ngưỡng riêng + thêm test mới), vitest 61/61, tsc/eslint sạch. **Live-test**:
  tạo Sắt tự tính với 3% lưu đúng; tạo Sắt gửi 4% → bị bỏ qua (`cắt:null, mua:null`); bulk nhóm Sắt → 400; bulk Sắt tự tính OK;
  chọn tay lẫn → `{updated:1, skippedSteel:1}`; đặt 5% cũ trong DB cho SAT-PHI-4 → bảng ước tính vẫn dùng 1% (không ghi đè). UI:
  form Sắt không còn ô %, form Sắt tự tính còn "% dự trù hao hụt khi mua", modal hàng loạt chỉ liệt kê Sắt tự tính.
- Dữ liệu test local: đã xoá 2 vật tư test; còn PI-2026-017 (chờ Sếp, phương án #28) + đơn LT-SOLVE-4.

## 4f. Tính lại theo chế độ khác + ô hao hụt đơn giản (cùng ngày)

- **Vấn đề**: thẻ kết quả không có đường "tính lại theo chế độ khác"; bấm Tính lần nữa thì lượt cũ bị thay ngay → tính lại ra kết quả xấu là mất luôn kết quả tốt. Thanh "Ngưỡng mặc định … Đổi + lý do" rườm rà.
- **BE**: `requestForBatch` GIỮ lượt DRAFT dùng được (tối đa 3 thẻ/tổ hợp: lượt cũ dùng được thứ 3 trở đi bị SUPERSEDED), chỉ dọn lượt FAILED và lượt vô nghiệm.  (lúc tạo PI) đánh SUPERSEDED mọi lượt chưa gắn PI khác có chung SKU (qua `CuttingProposalItem`). Câu "không tạo được" sửa cho khớp UI ("nâng ô Hao hụt sắt tối đa, đổi chế độ cắt hoặc gộp thêm SKU").
- **FE `GomDotCatPage`**: thanh "Ngưỡng mặc định … Đổi" thay bằng MỘT ô "Hao hụt sắt tối đa (%)" (nhập dấu phẩy "1,0"; hợp lệ 0,01–100). Rời ô/Enter/bấm Tính là tự lưu thành ngưỡng mặc định (BE vẫn ghi audit + báo Sếp/QLSX; không cần lý do), hiện "Đã lưu 0,05% → 1,0%"; có chip gợi ý "Đợt đang chọn cần ≥ X%". Bấm Tính tự chờ lưu xong rồi mới gửi solver. **2 chế độ cắt (Bình thường / Chấp nhận hao hụt cao hơn (đơn gấp) + lý do + Sếp duyệt) được GIỮ NGUYÊN.**
- **Sai sót trong lúc làm (đã sửa)**: ban đầu hiểu nhầm "đơn giản chỗ nhập hao hụt" thành bỏ luôn 2 chế độ cắt và tự thêm ô tick "Chỉ dùng cây chuẩn" không ai yêu cầu; người dùng chỉ ra → khôi phục 2 chế độ như cũ, bỏ ô tick tự thêm ("chỉ giữ chiều dài đã định" vẫn nằm trong chế độ "Chấp nhận hao hụt cao hơn" như trước).
- **FE `CuttingSolvePanel`**: mỗi thẻ có dòng "Cài đặt đã dùng: hao hụt tối đa X% · chế độ: bình thường/chấp nhận hao hụt tới Y% · …" và nút **"Tính lại với chế độ khác"** → về tab "Chọn và tính", tick lại đúng SKU của lượt đó, điền lại chế độ/% xin/lý do/chiều dài cây đã dùng. Lượt cũ còn nguyên để so sánh.
- **Lỗi bắt được khi live-test**: nút Tính bị khoá lúc đang lưu ô hao hụt → mất click (khoá giữa mousedown và mouseup). Đã bỏ điều kiện khoá này (handleSolve tự chờ lưu). Sau sửa: gõ 1 → bấm Tính ngay → PUT max-waste rồi POST solve, chuyển tab kết quả.
- **Kiểm tra**: jest cutting-proposals+production-invoices+system-config+materials 400/400 (chưa chạy lại toàn bộ BE); FE tsc sạch, eslint 0 lỗi (1 warning cũ set-state-in-effect), vitest 61/61. Live-test (khsx): tính lại từ thẻ cũ ra thẻ "Cần xử lý" mà thẻ cũ dùng được vẫn còn (tab "3 · xong"); ô lưu 0,05→1,0→15,0→1 đúng; sau khôi phục mở "Chế độ cắt" thấy đủ 2 chế độ. **Chưa live-test lại sau khôi phục**: chọn "Chấp nhận hao hụt cao hơn" + Tính, và nút "Tính lại" điền lại chế độ đó.
- **Rà UI sau khôi phục (người dùng gửi ảnh, 4 vấn đề — đã sửa, chọn phương án A: ô trên = mức chung, mode 2 = đợt gấp Sếp duyệt riêng)**:
  1. Khối "Chế độ cắt" bung trong thanh Tính cố định → thanh cao 496px/707px, che hết bảng SKU. Nay khối nằm ở đầu trang ngay dưới ô hao hụt (luồng trang thường); thanh dưới chỉ còn tóm tắt "Chế độ: …" + nút Tính (86px).
  2. Hai chỗ nâng ngưỡng trùng nhau → viết lại chữ: ô trên "Mức chung cho mọi lượt tính từ giờ — không cần Sếp duyệt"; mode 2 "Dùng cho đợt gấp: xin Sếp duyệt riêng, CHỈ áp cho đợt này (không đổi ô Hao hụt sắt tối đa)"; khung cảnh báo nói rõ 2 lựa chọn.
  3. Bỏ chữ lỗi thời "Vượt cả mức đã xin thì hệ thống vẫn chặn" và "Sếp duyệt lệnh sản xuất là chấp thuận luôn".
  4. Lỗi hiện quá sớm + nút Tính mờ không giải thích → nút KHÔNG khoá vì thiếu lý do; bấm Tính khi thiếu thì mở khối, cuộn tới ĐÚNG ô cần điền (không để thanh dưới che) và hiện lỗi đỏ (ở ô + ở thanh dưới); lỗi chỉ hiện sau lần bấm đó.
  Live-test: mode 2 + bấm Tính thiếu lý do → không gọi solver, ô lý do không bị thanh che; điền "Test giao gấp" → solve chạy, thẻ ghi "chế độ: chấp nhận hao hụt tới 1,9% (đơn gấp) · giữ chiều dài đã định". FE tsc sạch, eslint 0 lỗi, vitest 61/61.
- **Đổi ý ở 4g/4h**: ô hao hụt trên màn KHSX bị khoá (4g); mode 2 không còn ô nhập % (4h).
- **Chưa xử lý**: dòng tóm tắt thẻ hơi lặp ("hao hụt tối đa 1.9% · chế độ: chấp nhận … 1.9%"); thông báo cũ đã lưu trong DB vẫn chứa câu nhắc "Chế độ cắt" (thông báo mới đã dùng chữ mới).

## 4g. Ô "Hao hụt sắt mặc định tối đa" chỉ đọc; hao hụt cao hơn chỉ qua "Chấp nhận hao hụt cao hơn" (cùng ngày)

- **Yêu cầu (người dùng)**: ô hao hụt trên màn KHSX phải bị khoá và đặt tên "Hao hụt sắt mặc định tối đa"; ai cần hao hụt cao hơn thì chọn "Chấp nhận hao hụt tới …" (Sếp duyệt riêng). Đảo lại quyết định 4c/4f ("KHSX toàn quyền nhập hao hụt mặc định") - đây là quyết định mới nhất của người dùng.
- **FE `GomDotCatPage`**: ô chỉ đọc (`disabled`), hiển thị mức mặc định từ `GET /system-config/cutting-defaults`; bỏ toàn bộ logic gõ/lưu/chip gợi ý/thông báo "Đã lưu"; Tính không còn chờ lưu. Chữ 2 chế độ + khung cảnh báo đổi cho khớp ("không đổi mức mặc định"). `updateMaxWastePercentage` không còn nơi nào gọi ở FE.
- **BE**: chỉ đổi câu báo "không tạo được" (bỏ nhắc ô/tick không còn tồn tại → "chọn chế độ Chấp nhận hao hụt cao hơn hoặc gộp thêm SKU"). Endpoint `PUT /system-config/cutting-defaults/max-waste` (KHSX/ADMIN) + audit + thông báo `CUTTING_WASTE_DEFAULT_CHANGED` GIỮ NGUYÊN nhưng không còn UI gọi.
- **HỆ QUẢ CHƯA GIẢI QUYẾT**: màn Admin > Cấu hình hệ thống (`SystemConfigPage.tsx`) KHÔNG có ô `solverMaxWastePercentage` (chủ đích cũ: "thuộc nghiệp vụ cắt sắt"), nên hiện KHÔNG còn đường nào trên giao diện để đổi mức mặc định 1% (chỉ gọi API/DB). Chờ người dùng chốt: thêm ô vào Admin (hợp nguyên tắc "Admin xử lý việc hiếm"), hay để cố định.
- **Kiểm tra**: FE tsc sạch, eslint 0 lỗi, vitest 61/61; live-test: ô hiển thị "1,0", `disabled`, nhãn "Hao hụt sắt mặc định tối đa (%):", khung chế độ cắt hiện chữ mới. Chưa chạy lại jest BE (chỉ đổi 1 chuỗi thông báo, không có spec nào kiểm chuỗi đó).

## 4h. "Chấp nhận hao hụt cao hơn" bỏ ô nhập % — không đặt trần, Sếp duyệt trên kết quả thật (cùng ngày)

- **Yêu cầu (người dùng)**: đã chấp nhận hao hụt cao hơn 1% rồi thì không cần nhập số nữa.
- **Quyết định**: mode 2 = "không đặt trần hao hụt cho riêng đợt này" (+ lý do bắt buộc + Sếp duyệt như cũ). Lý do bỏ được số: Sếp duyệt trên KẾT QUẢ THẬT đã tính (thấy % hao hụt từng loại), nên con số "xin tới X%" chỉ là dự đoán thừa. BE vẫn cần 1 con số nên FE gửi `solverMaxWastePctOverride = 100` (trần tối đa hợp lệ) = quy ước "không trần" (hằng `NO_CEILING_PCT`); KHÔNG đổi schema/DTO.
- **FE**: bỏ ô nhập %, state/validate/tự điền %, gợi ý "≥ X%" thành 1 dòng thông tin ("Ước tính đợt này cần ≥ 1,9% (…); số thật hiện sau khi tính"); lý do vẫn bắt buộc. `CuttingSolvePanel`: tóm tắt thẻ "chế độ: chấp nhận hao hụt cao hơn (đơn gấp, không đặt trần)" (không in "hao hụt tối đa 100%"). `LenhSXPage` (Sếp): callout "Xin hao hụt tới 100%" → "Chấp nhận hao hụt cao hơn mức mặc định — không đặt trần, xem % hao hụt thật ở khối phương án cắt"; PI cũ có % thật (<100) hiển thị như cũ.
- **Hệ quả bắt được khi live-test và đã xử lý**: trần 100% làm solver KHÔNG bao giờ đánh dấu "vượt ngưỡng" → dòng SAT-HOP-20X20 hao 14,85% hiện "Đạt" xanh, thẻ ghi "ngưỡng 100%", Sếp mất cảnh báo đúng ở đợt hao hụt cao nhất. Sửa: (1) BE `saveSuccess` nhận mức mặc định và với lượt TRƯỚC PI đặt `hasOverThreshold = solver đánh dấu HOẶC hao hụt dòng > mức mặc định` (luồng cũ có PI giữ nguyên để không đổi hành vi tự duyệt cũ); (2) FE bảng kết quả dùng `normalWastePctThreshold`/`usedWasteOverride` (BE đã có sẵn ở DTO): nhãn "ngưỡng 1%" thay vì 100%, dòng lọt nhờ đơn gấp ghi vàng "Cao hơn mức mặc định" thay vì "Đạt". Thẻ hiện dòng lưu ý "vượt ngưỡng… QLSX/Sếp sẽ thấy cảnh báo".
- **Kiểm tra**: jest cutting-proposals 170/170 (thêm 2 test: hao hụt > mặc định khi trần 100% → hasOverThreshold=true; trong mức mặc định → false); BE tsc sạch (trừ lỗi cũ seed); FE tsc sạch, vitest 61/61. Live-test (khsx): mode 2 không còn ô số; bỏ lý do → chặn + lỗi đúng chỗ; điền lý do → solver chạy, 32 cây/1,41%, 2 dòng "Cao hơn mức mặc định", dòng lưu ý cho Sếp hiện.
- **Rủi ro nói rõ**: không có trần nên solver có thể trả phương án hao hụt cao (vd 14,85% ở 1 loại) - bù lại KHSX thấy số thật trước khi tạo lệnh và Sếp thấy lại lúc duyệt. Chưa live-test tới bước Sếp duyệt PI tạo từ đợt này (callout mới ở `LenhSXPage` chỉ mới qua tsc/lint, chưa xem trên màn). Các thẻ kết quả giống hệt nhau (cùng cài đặt) vẫn được giữ đến giới hạn 3 thẻ.

## 4i. Bài e2e (Playwright) cho luồng mới — 2026-10-01

- **Làm gì**: thêm `e2e/solve-truoc-tao-lenh.spec.ts` + `e2e/helpers.ts` ở repo FE (DNA-ERP). Luồng kiểm: Sales tạo đơn 2 SKU (API) → KHSX chọn 2 SKU, bấm Tính, đợi kết quả, "Tạo lệnh sản xuất (gộp 2 SKU)", Gửi QLSX (UI) → QLSX thấy "Phương án cắt đã tính", chọn kho, gửi Sếp (UI) → Sếp "Duyệt cả đợt" (UI) → kiểm bằng API: PI đã duyệt, `cuttingPlan.proposalId` đúng lượt đã tính, số cây khớp, phương án APPROVED gắn đúng PI, 2 lệnh sản xuất KHÔNG có phương án cắt riêng (= solver không chạy lại), đúng 1 đề xuất mua sinh từ phương án đó.
- **Vì sao**: bài cũ `golden-path.spec.ts` chỉ đi luồng CŨ (Sếp duyệt rồi mới solver chạy) nên không chứng minh được luồng mới.
- **Sửa nhỏ ở app để test bám được (và có ích cho người dùng)**: thẻ kết quả ở `CuttingSolvePanel` thêm mã đơn ("đơn E2E-…") vì 2 đơn cùng SKU cho ra 2 thẻ trùng tên; thêm `data-solve-id`; hộp duyệt của Sếp trước đây còn ghi "tính phương án cắt chung một lần" (sai với luồng mới) → "dùng chung phương án cắt đã tính bên dưới" khi PI có phương án.
- **Kết quả**: chạy 2 lần liên tiếp đều qua (24s, 18s) trên BE/FE local + solver thật ở cổng 18080. FE tsc sạch, eslint 0 lỗi, vitest 61/61.
- **Gặp khi viết (đã xử lý trong test)**: (1) màn tự nhảy sang tab "Kết quả đã tính" sau khi tải xong nếu đã có lượt tính cũ → bấm "Chọn và tính" quá sớm bị nhảy ngược; test bấm lại tới khi bảng hiện (nếu người dùng thật gặp thì cũng khó chịu - xem mục chưa làm). (2) BE giới hạn 100 yêu cầu/phút nên đăng nhập lần thứ 4 bị "Too Many Requests"; `uiLogin` chờ 30s rồi thử lại.
- **Chưa làm / lưu ý**: bài chỉ phủ đường thuận (chế độ Bình thường, gộp 2 SKU). Chưa phủ: claim-solo 1 SKU, chế độ "chấp nhận hao hụt cao hơn", nút "Tính lại", phương án lỗi thời, từ chối. Bài để lại dữ liệu (đơn, PI, lệnh, đề xuất mua) trong DB local sau mỗi lần chạy. `golden-path.spec.ts` HIỆN ĐANG HỎNG từ trước (không do việc này): bước 1 tìm khách "MEIJING" và SKU "test" không còn trong DB sau lần reset 2026-09-17 → cần sửa dữ liệu mẫu của bài đó riêng. Tự nhảy tab ở trên: nên cân nhắc chỉ tự mở tab kết quả khi có lượt đang chạy/vừa xong, không phải mọi lúc có lượt cũ.

## 5. Quyết định / lưu ý

- **KHSX giờ là người chờ solver** (trước đây chạy nền sau Sếp duyệt nên không ai chờ). Hàng đợi solver là
  FIFO **toàn cục 1 lượt/lần**: lượt của KHSX phải xếp sau lượt cũ đang chạy (quan sát thật: #26 chờ #25 ~4
  phút). Ngân sách giây/loại sắt vẫn là mức tối đa an toàn (`autoTimeLimitSeconds`) — nếu thấy chờ lâu cần hạ.
- `buildOverrideEvidence` vẫn tính từ số ƯỚC TÍNH (`previewBatch`) lúc tạo PI, chưa đổi sang số solver thật
  (kế hoạch ban đầu ghi ngược lại) — số thật đã hiện ở `cuttingPlan`, nên bằng chứng ước tính là thừa dần.
- KHSX có `CUTTING_PROPOSAL:CREATE` nên gọi được nút "Tính lại" cũ của phương án theo luồng cũ (FE không hiển
  thị nút đó cho KHSX; cổng `autoApproveBlockReason` vẫn chặn trừ kho/mua trùng).

## 6. Phát hiện ngoài phạm vi (chưa sửa)

- `prisma/seed-real-products.ts:150` và `seed-ghe-j55-full-bom.ts:152` lỗi `tsc` (`factoryCode` không còn
  unique từ migration `20260925100000_drop_mfg_product_factory_code_unique`) — seed chưa cập nhật.
- `npm run seed` local dừng ở upsert admin (`username` trùng do reset DB 09-17); phần đồng bộ role/quyền chạy trước
  đó nên vẫn có hiệu lực (đã xác nhận KHSX có `CUTTING_PROPOSAL:CREATE`).

## 7. Chưa làm / còn treo

- Chưa deploy; production cần `prisma migrate deploy` (tự chạy trong entrypoint) + `npm run seed`.
- Chưa có test FE cho `CuttingSolvePanel`/`CuttingPlanNote`; e2e Playwright chưa chạy lại (không có spec nào
  gọi 2 nút cũ/`merge`/`claim-solo`).
- Tiến độ **theo từng loại sắt** chưa có (solver trả 1 lần duy nhất; cần đổi DNA-DEXUAT).
- Đề xuất cải thiện UI/UX của màn (chưa làm, chờ người dùng chốt) — xem trao đổi ngày 2026-09-30.
- Ô % hao hụt mặc định cho KHSX: **đã làm** (mục 4c), ô nhập đã đơn giản hoá + nút "Tính lại với chế độ khác" (mục 4f).
- **Chờ quyết**: nối `Material.purchaseWastePercentage` vào tính số lượng mua (hiện ô nhập của Sắt tự tính chưa có tác dụng) - vd `PieceMaterialYieldPurchaseService`: `bars = ceil(cần / piecesPerBar × (1 + %/100))`. Đụng số lượng đặt mua nên cần người dùng xác nhận công thức.
- Bulk "Sửa hao hụt hàng loạt" (`updateMany`) chưa ghi AuditLog.
- ~~Production: chạy `npm run seed` để có nhóm `SAT_TU_TINH` + quyền KHSX.~~ **ĐÃ CHẠY 2026-10-01** theo yêu cầu người dùng (email `admin@dna-erp.local`, username `sysadmin`, mật khẩu ngẫu nhiên không dùng vì tài khoản đã tồn tại): in "Seed complete. Roles synced: 14. Warehouses synced: 7". Đối chiếu ảnh chụp quyền trước/sau: **chỉ thêm `PRODUCTION_PLANNER|CUTTING_PROPOSAL:CREATE`, không mất quyền nào**; nhóm `SAT_TU_TINH` đã có sẵn từ trước. Lần chạy đầu bị hệ thống chặn (chưa có quyền ghi production); chạy được sau khi người dùng yêu cầu lại. Xoay khóa kết nối production vẫn nên làm (đã lộ trong chat). Tài khoản `qa_spec_steel_tmp@example.test` xuất hiện giữa hai lần chụp là do người khác tạo, không phải seed.
