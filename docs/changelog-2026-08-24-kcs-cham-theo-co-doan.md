# Changelog 2026-08-24 — KCS chấm Phôi THEO TỪNG CỠ ĐOẠN, chỉ Đạt/Không đạt, Phôi tự bù ngoài hệ thống

> Trong ngày có 3 vòng thiết kế cho cùng 1 tính năng, cả 2 vòng đầu chưa từng lên production:
> **Vòng 1** thêm hẳn `QcReviewSegment.fixedQty` (bộ đếm mutable) + API `report-fix` để Phôi "báo đã
> sửa xong" bằng tay. **Vòng 2** bỏ field đó, cho Phôi cắt bù qua CHÍNH `recordCutBatch` (mở lại
> được dù đã `QC_PASSED`), dùng sắt kho đã cấp cho đúng đợt đó. **Vòng 3 (bản CUỐI, đang chạy)**:
> Sếp chốt lại nghiệp vụ khác hẳn — việc bù KHÔNG liên quan gì tới sắt kho cấp (Phôi tự kiếm ngoài
> thực tế), và bỏ hẳn khái niệm "lỗi sửa được" — chỉ còn 2 kết quả Đạt/Không đạt. Changelog này ghi
> lại đúng trạng thái CUỐI (vòng 3).

## Vấn đề trước khi sửa

KCS duyệt Phôi theo CẢ CÂY (`QcReview.failedQty` là số cây), không biết chính xác CỠ ĐOẠN nào lỗi —
Phôi không có cách nào tự sửa/bù đúng phần bị lỗi, chỉ có 2 lựa chọn thô: cả lô đạt hoặc cả lô phải
làm lại qua cơ chế `reworkOfId` cũ (sinh hẳn 1 `SteelIssue` con).

## Hướng đã chọn (vòng 3, bản cuối)

**KCS chấm THEO TỪNG CỠ ĐOẠN, CHỈ 2 kết quả: Đạt / Không đạt** (`QcReviewSegment`, 1 dòng/cỡ đoạn
không đạt trong 1 lần duyệt). Đợt đóng `QC_PASSED` ngay. Lỗi nhẹ (giũa/nắn lại tại chỗ được) xem
như KHÔNG PHẢI lỗi — KCS không liệt kê, đợt đi tiếp bình thường; "không đạt" chỉ còn nghĩa duy
nhất: đoạn hỏng thật, phải bù bằng sắt mới.

**Phôi tự bù bằng sắt kiếm ngoài thực tế — KHÔNG đụng cây sắt kho đã cấp, KHÔNG qua
`recordCutBatch`.** Bù xong bấm "Bù đủ", CHỜ KCS duyệt lại mới tính là đạt:

- `SteelIssuesService.recordCutBatch()` trở lại CHỈ chạy khi `RECEIVED` (gỡ nhánh cho phép
  `QC_PASSED` đã thử ở vòng 2) — việc bù không còn đi qua đây.
- `QcReviewsService.reportSegmentDone(steelIssueId, segmentSpecId)` (mới): Phôi bấm "Bù đủ" cho 1
  cỡ đoạn — set `phoiReportedAt`, KHÔNG tự cộng `resolvedQty` (sản lượng chỉ tính sau khi qua kiểm).
- `QcReviewsService.recheck(steelIssueId, dto)` (mới): KCS duyệt lại theo lô, mỗi cỡ đoạn nhập
  `remainingFailedQty` (0 = đạt hết). Cộng đúng phần vừa đạt vào `resolvedQty`; còn hỏng thì
  `phoiReportedAt` reset về `null` để Phôi báo lại lượt mới cho đúng phần còn lại.
- `getPhoiProgress()`: **sửa 1 lỗi ERP phát hiện ở vòng 2** — "Đã cắt" (`done`) trước bị TRỪ THẲNG
  lỗi vào, làm mâu thuẫn với "Lịch sử đợt đã nhập" (sổ ghi 8 đoạn, bảng hiện 5) và với chính phương
  trình cân bằng vật chất mà `recordCutBatch` dùng số 8 để kiểm. Nguyên tắc ERP đúng: **số đã ghi
  nhận không bao giờ bị sửa, chỉ được phân loại**. Bản cuối: `done` trả nguyên số THÔ (bất biến),
  thêm trường `failed` riêng = `Σ(failedQty - resolvedQty)` (outstanding, GIẢM DẦN khi KCS duyệt lại
  xác nhận đạt). FE tự tính `Còn lại = required - (done - failed)`.

FE: cột **"Lỗi"** trong bảng Cần/Đã cắt/Còn lại giờ hiện đúng outstanding hiện tại (không phải nhãn
lịch sử cố định như vòng 2) kèm nút **"Bù đủ"**/nhãn "chờ KCS duyệt lại". `CutBatchPanel` vẫn mở
được cho đợt `QC_PASSED` còn lỗi (để Phôi thấy mà bấm), nhưng ẩn HẲN phần nhập đợt cắt (ô "Nhập đợt
này", "Số cây đã dùng", "Mẩu nguyên", nút "Lưu đợt cắt"/"Gửi KCS") — chỉ còn bảng số liệu + nút
"Bù đủ". Bên KCS Phôi: badge "chờ duyệt lại · N đoạn" + nút "Duyệt lại" mở modal nhập số còn hỏng
theo từng cỡ.

## Vì sao bỏ 2 vòng trước

- **Vòng 1 → vòng 2**: "Đã sửa"/"Còn lỗi" (field `fixedQty` riêng) và "Đã cắt"/"Còn lại" cùng thể
  hiện 1 sự thật vật lý (cắt thêm bao nhiêu đoạn) — giữ cả 2 là bắt nhập 2 lần cho cùng 1 việc.
- **Vòng 2 → vòng 3**: Sếp chốt việc bù không liên quan gì tới cây sắt đã cấp (Phôi tự kiếm sắt
  ngoài thực tế để chắp vá) — nên bỏ hẳn đường cắt bù qua `recordCutBatch`. Và vì lỗi "sửa được"
  (giũa/nắn lại tại chỗ) xử lý giống hệt "không đạt" (Phôi tự lo → báo → KCS duyệt lại), tách 2 loại
  trong phần mềm là vô nghĩa — gộp còn đúng 1 kết quả "không đạt".

## Phạm vi CHỦ ĐỘNG không làm

Ý tưởng "Phế → Kho cấp lại sắt" (từng định làm ở vòng 1/2) **bỏ hẳn** — vì Phôi tự kiếm sắt bù nên
không còn gì để Kho duyệt. `XuatSatPage.tsx` (Kho), `kcsCore.tsx` (Hàn/Sơn),
`reviewProductionBatch()` (nhánh Hàn/Sơn) — không đụng.

## Đã sửa (trạng thái cuối)

| File | Thay đổi |
|---|---|
| BE `prisma/schema.prisma` | `QcReviewSegment` thêm `resolvedQty` (mặc định 0, chỉ KCS ghi) + `phoiReportedAt` (`DateTime?`). `failedQty` giữ BẤT BIẾN. 3 trạng thái (chờ Phôi/chờ KCS/xong) suy từ 2 cột này, không cần enum riêng |
| BE `prisma/migrations/20260824010000.../20260824020000.../20260824030000_qc_review_segment_recheck/` | Tạo bảng → drop `fixedQty` (vòng 2) → thêm `resolvedQty`+`phoiReportedAt` (vòng 3) |
| BE `qc-reviews/dto/qc-recheck.dto.ts` (mới) | `QcRecheckDto` — `segments[]` (`segmentSpecId`, `remainingFailedQty` ≥ 0) |
| BE `qc-reviews/dto/qc-review-response.dto.ts` | `QcReviewSegmentResponseDto` thêm `resolvedQty`, `phoiReportedAt` |
| BE `qc-reviews/qc-reviews.service.ts` | Thêm `reportSegmentDone()` + `recheck()`. `review()` không đổi logic, chỉ sửa doc comment. `reviewProductionBatch()` (Hàn/Sơn) không đổi |
| BE `qc-reviews/qc-reviews.controller.ts` | 2 route mới: `POST steel-issues/:id/qc-segments/:segmentSpecId/report-done` (`@RequireMfgRole(PHOI)`), `POST steel-issues/:id/qc-recheck` (`@RequireMfgRole(KCS)`) |
| BE `steel-issues/steel-issues.service.ts` | `recordCutBatch()`: gỡ nhánh `QC_PASSED`, quay lại chỉ `RECEIVED`; bỏ luôn `$transaction` cập nhật `actualBarCount` (chỉ cần cho đường cắt bù đã gỡ). `getPhoiProgress()`: `done` trả số thô, thêm `failed` = outstanding |
| BE `common/constants/role-permissions.constant.ts` | `PHOI_STAFF.QC_REVIEW` thêm lại `UPDATE` (cho `reportSegmentDone`/"Bù đủ") |
| BE `*.service.spec.ts` | `qc-reviews`: thêm `describe('reportSegmentDone')` + `describe('recheck')` (10 test). `steel-issues`: gỡ test cắt-bù-QC_PASSED, thêm `describe('getPhoiProgress')` (3 test: done thô/failed=outstanding/failed=0 khi resolved hết) |
| FE `services/steel-issues-api.ts` | `BeQcReviewSegment` thêm `resolvedQty`/`phoiReportedAt`; `BePhoiProgressSegment` thêm `failed`; thêm `reportSegmentDone()`, `recheckQc()` |
| FE `modules/pages/Phoi/LenhSanXuatPhoi.tsx` | `outstanding`/`awaitingRecheck` tính từ `review.segments` (thay `failedQty` tĩnh). `CutBatchPanel` thêm `isRecheckMode` — ẩn form nhập đợt cắt, thêm cột "Xử lý" (nút "Bù đủ"/nhãn "chờ KCS duyệt lại") |
| FE `modules/pages/Kcs/KcsPhoiPage.tsx` | `buildPiRows` nhận thêm `reviews`, `pendingCount` cộng cả đợt chờ duyệt lại. Thêm `RecheckModal` (mới) — nhập số còn hỏng theo từng cỡ đoạn đang chờ duyệt lại |

## Xác minh

- BE: `npx tsc -p tsconfig.json --noEmit` sạch. `npm test` — 45/45 suite, **696/696 test**.
- FE: `npx tsc --noEmit` sạch, `npm run lint` sạch (0 lỗi/warning mới), `npm test` (vitest) 4/4
  suite 36/36 test, `npm run build` thành công.
- Live-test qua trình duyệt, trọn vòng đời trên PI-2026-046 / Sắt vuông 20x20 / cỡ 460mm (Cần 90,
  Đã cắt 11 — cắt bù từ vòng 2 để lại, giữ nguyên vì bất biến):
  1. KCS chấm 3 đoạn không đạt (dữ liệu có sẵn từ trước) → Phôi thấy "Lỗi 3", Còn lại 82.
  2. Phôi bấm **"Bù đủ"** → badge đổi "chờ duyệt lại", nút Bù đủ ẩn, hiện "chờ KCS duyệt lại".
  3. KCS (`tkcs`/`demo1234`) thấy badge **"Lỗi 3 đoạn · chờ duyệt lại"** + nút "Duyệt lại" → modal
     hiện đúng cỡ 460mm, "Đã chấm lỗi: 3" → nhập còn hỏng **1** → xác nhận.
  4. Phôi thấy **Lỗi 1**, Còn lại 80, KHÔNG còn "chờ duyệt lại" — nút **"Bù đủ" hiện lại** cho phần
     còn thiếu (đúng thiết kế: mỗi lượt duyệt lại chỉ đóng phần đã xử lý, phần còn hỏng quay lại
     chờ Phôi).
  5. Phôi bấm "Bù đủ" lần 2 → KCS duyệt lại, để mặc định **còn hỏng = 0** → xác nhận.
  6. Phôi thấy dòng chuyển hẳn sang **"đạt"** (hết lỗi, không mở rộng được nữa).
- Live-test bổ sung 9 kịch bản thực tế (UI qua chrome-devtools MCP + gọi thẳng API bằng `curl`,
  đủ token `tkphoi`/`tkcs`), trên đợt sắt STL-HOP-25X50 và STL-VUONG-12X12 (cùng PI-2026-046) —
  **9/9 PASS**, không phát hiện lỗi:
  1. **Nhiều cỡ đoạn không đạt cùng lúc** — chấm 200mm (2 không đạt) + 765mm (1 không đạt) trong
     1 lần duyệt → 2 dòng "Lỗi"/"Còn lại"/nút "Bù đủ" độc lập, không lẫn số liệu vào nhau.
  2. **Chặn bấm "Bù đủ" 2 lần** — bấm 1 lần (UI ẩn nút, hiện "chờ KCS duyệt lại"), gọi thẳng
     `report-done` lần 2 → `409` ("đã báo bù đủ rồi").
  3. **Chặn duyệt lại vượt số lỗi** — `remainingFailedQty=5` cho cỡ đang lỗi 1 → `400` ("Còn hỏng 5
     vượt số đang lỗi (1)"), không đổi số liệu.
  4. **Chặn duyệt lại khi Phôi chưa báo** — gọi `qc-recheck` cho cỡ đoạn `phoiReportedAt=null` →
     `409` ("chưa tới lượt duyệt lại").
  5. **Phân quyền: Phôi không tự duyệt lại được** — token `tkphoi` gọi `qc-recheck` → `403`
     ("Requires mfgRole to be one of: KCS").
  6. **Phân quyền: KCS không tự "Bù đủ" thay Phôi** — token `tkcs` gọi `report-done` → `403`
     ("Requires mfgRole to be one of: PHOI").
  7. **Chặn cắt bù qua sắt kho sau khi đã QC_PASSED** — gọi thẳng `POST cut-batches` trên đợt đã
     duyệt → `409` ("chỉ RECEIVED mới nhập đợt cắt được") — xác nhận việc bù không còn đường nào
     đụng tới sắt kho cấp.
  8. **Đếm "Đợt chờ kiểm" gộp cả 2 loại** — 1 PI có 1 đợt `AWAITING_QC` (chưa chấm lần nào) + 1 đợt
     `QC_PASSED` đang "chờ duyệt lại" → số đếm ở danh sách PO/PI = **2** (không phải 1), UI liệt kê
     đúng cả 2 dòng với nhãn/nút khác nhau ("chờ kiểm" + "Tiến hành duyệt" vs "chờ duyệt lại" +
     "Duyệt lại").
  9. **"Đã cắt" bất biến xuyên vòng đời** — so `getPhoiProgress` trước/sau toàn bộ chu trình
     lỗi→bù→duyệt lại cho cả 2 cỡ đoạn: `done` giữ nguyên (5 và 4), chỉ `failed` đổi rồi về lại 0.
