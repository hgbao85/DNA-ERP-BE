# Changelog 2026-08-22 — Báo cắt xong theo TỪNG CỠ ĐOẠN, tách khỏi "Xác nhận nhận sắt"

> Lần 2 của cùng 1 tính năng: bản đầu (2026-08-21) đã cài BE + FE, live-test qua trình duyệt thành
> công, nhưng bị user discard toàn bộ vì merge sai phạm vi màn (gộp nhầm cả "Lệnh sản xuất" vào
> "Xác nhận nhận sắt" thay vì chỉ gộp "Xác nhận sản lượng" + "Lịch sử nhận sắt"). DB đã rollback về
> trước 3 migration liên quan (`DELETE FROM _prisma_migrations WHERE migration_name LIKE
> '20260821%'` + revert tay schema). Bản này làm lại đúng thiết kế BE cũ, nhưng đặt UI nhập liệu ở
> đúng chỗ user yêu cầu.

## Vấn đề trước khi sửa

"Báo cắt xong" cũ (`completeCutting`) bắt Phôi CHỌN 1 kiểu cắt đã duyệt (`CuttingProposalPattern`)
rồi FE tự bung số đoạn ra theo kế hoạch — số liệu thực chất là CHÉP từ solver, không phải ĐO thực
tế. Không có chỗ nhập phế liệu/mẩu nguyên thực tế, không đối chiếu được với định mức BOM.

## Hướng đã chọn

**Phôi khai thẳng số đoạn cắt được theo TỪNG CỠ** (`recordCutBatch`, nhiều đợt/lần, cộng dồn) — hệ
thống tự tính phế liệu qua phương trình cân bằng vật chất, không bắt gõ tay:

```
barCount × barLengthMm = barCount × trimStartMm + Σ(qty × cutLengthMm) + Σqty × bladeWidthMm
                          + mauNguyenMm + scrapMm
```

`mauNguyenMm` (mẩu nguyên — đoạn cắt dở còn nguyên, TÀI SẢN nhập lại kho) do Phôi nhập tay;
`scrapMm` (phế liệu thật) do SERVER tính là phần dư, không cho nhập tay. Âm ⇒ bất khả vật lý (cắt
nhiều hơn sắt có) ⇒ chặn 400.

"Cần" (required) trong bảng tiến độ lấy từ ĐỊNH MỨC BOM (`piece_bom × bom_piece × quantity`), KHÔNG
lấy từ kiểu cắt solver — vì solver thường dư sản lượng cỡ ngắn để lấp đầu cây, lấy theo pattern sẽ
không bao giờ về 0 đúng.

"Xong, mời KCS" (`finishCutting`) tách hành động riêng, KHÔNG tự động khi Còn lại = 0 — ca cắt thiếu
do sắt hỏng/cong vẫn phải đi tiếp được. `actualBarCount` SUY từ tổng `Σ CutBundle.barCount` các đợt
đã nhập, không phải ô người dùng gõ (tránh 2 nguồn sự thật).

## Phạm vi CHỦ ĐỘNG không đụng (chốt với user trước khi làm)

KCS vẫn chấm lỗi theo CÂY (như hiện tại, không breakdown theo từng cỡ đoạn) — `QcReviewsService`
không đổi. Bút toán kho đoạn (SEGMENT_OUTPUT) không thêm. `DEFECT_REASON` permission không thêm. Cả
3 điểm này nằm trong bản 2026-08-21 đã bị discard nhưng KHÔNG nằm trong câu hỏi/yêu cầu lần 2 — cố
tình thu hẹp lại để tránh lặp lại sự cố mở rộng phạm vi.

## Vị trí UI: tách theo đúng ranh giới nghiệp vụ (yêu cầu rõ của user)

"Xác nhận nhận sắt" (`XacNhanNhanSatPage.tsx`, gộp `XacNhanSanLuongPage` + `LichSuNhanSatPage`) CHỈ
còn 1 việc: xác nhận đã nhận đợt kho vừa xuất (`receiveSteelIssue`). Toàn bộ phần sau khi nhận — báo
cắt xong theo cỡ đoạn, đánh dấu công đoạn chi tiết (uốn/dập/...) — chuyển hẳn sang "Lệnh sản xuất"
(`LenhSanXuatPhoi.tsx`). Vì thao tác trên từng đợt xuất cụ thể (`SteelIssue.id`), chi tiết 1 PI ở màn
này đổi từ gộp-theo-loại-sắt (đọc-only cũ) sang danh sách phẳng từng đợt.

## Đã sửa

| File | Thay đổi |
|---|---|
| BE `prisma/schema.prisma` | `CutPatternSegment.countPerBar` → `qty` (tổng số đếm cả đợt, không phải/bar — phân biệt rõ với `CuttingProposalPatternSegment.countPerBar` của solver, giữ nguyên tên). `CutBundle.wastePerBarMm` → `mauNguyenMm` + `scrapMm` |
| BE `prisma/migrations/20260822020000_cut_pattern_segment_qty/`, `20260822030000_cut_bundle_balance/` (mới) | Rename cột + đổi cột `cut_bundles` theo schema trên |
| BE `steel-issues/dto/record-cut-batch.dto.ts` (mới) | `RecordCutBatchDto` — `barCount`, `mauNguyenMm?`, `proposalPatternId?` (tham khảo), `segments[]` (`segmentSpecId`, `qty`) |
| BE `steel-issues/dto/phoi-progress-response.dto.ts` (mới) | `PhoiProgressItemResponseDto` — theo material, mỗi material có `segments[]` (`cutLengthMm`, `required`, `done`) |
| BE `steel-issues/dto/complete-cutting.dto.ts` | Xoá (thay bằng `record-cut-batch.dto.ts`) |
| BE `steel-issues/steel-issues.service.ts` | Xoá `completeCutting()`; thêm `recordCutBatch()` (validate RECEIVED, cỡ đoạn thuộc đúng material + đúng BOM của PI, không vượt barCount còn lại, tính cân bằng deci-mm), `finishCutting()` (validate RECEIVED, `actualBarCount` = SUM `cutBundle.aggregate`, chặn nếu chưa có đợt nào), `getPhoiProgress()` (required từ BOM, done từ SUM `CutPatternSegment.qty`), `findBomSegmentSpecIds()` (private) |
| BE `steel-issues/steel-issues.controller.ts` | `GET production-invoices/:id/phoi-progress` (VIEW); `POST steel-issues/:id/cut-batches` + `POST steel-issues/:id/finish-cutting` (UPDATE + `RequireMfgRole(PHOI)`) thay `complete-cutting` |
| BE `steel-issues/steel-issues.service.spec.ts` | Thay `describe('completeCutting')` bằng `describe('recordCutBatch')` (7 test: tính phế đúng cân bằng, trừ mẩu nguyên khỏi phế, chặn cắt vượt sắt/ngoài BOM/khác loại sắt/vượt barCount/sai trạng thái) + `describe('finishCutting')` (3 test: actualBarCount suy từ tổng đợt, chặn khi chưa có đợt, chuyển IN_PROCESS khi còn công đoạn khác CAT) |
| FE `services/steel-issues-api.ts` | `BeCutPatternSegment.qty`, `BeCutBundle.mauNguyenMm/scrapMm`; thêm `getCutBundles()`, `recordCutBatch()`, `finishCutting()`, `getPhoiProgress()`; xoá `completeCutting()`/`CompleteCuttingBundleInput` |
| FE `services/api.ts` | Re-export theo tên hàm mới |
| FE `modules/pages/Phoi/XacNhanNhanSatPage.tsx` | Bỏ hẳn phần báo cắt xong (pattern-selection UI, `bundles`, `doCompleteCutting`...) — chỉ còn `doReceive()` + hiển thị trạng thái tham khảo cho các bước sau |
| FE `modules/pages/Phoi/LenhSanXuatPhoi.tsx` | Đổi từ gộp-theo-vật-liệu (đọc-only) sang danh sách phẳng từng đợt (`BeSteelIssue[]`). Thêm `CutBatchPanel` — bảng Cần/Đã cắt/Còn lại theo cỡ đoạn (từ `getPhoiProgress`), input nhập từng đợt + "Lưu đợt cắt" (`recordCutBatch`), nút riêng "Xong, mời KCS" (`finishCutting`), 2 khối thu gọn: "Cách cắt gợi ý" (tham khảo, `getApprovedPatternsForMaterial`) và "Lịch sử đợt đã nhập" (`getCutBundles`) |

## Xác minh

- BE: `npm test` — 43/43 suite, 632/632 test (bao gồm 10 test mới ở trên).
- FE: `tsc --noEmit` sạch, `eslint` sạch (1 unused-import tự sửa), `next build` thành công, `vitest
  run` 36/36.
- **Chưa live-test qua trình duyệt được bản UI mới của `LenhSanXuatPhoi.tsx`** (khác với bản
  2026-08-21 đã test được): DB dev hiện chỉ có đúng 1 PI có `SteelIssue` (PO-44), đang ở trạng thái
  `AWAITING_QC` — không còn đợt nào ở `RECEIVED` để mở được `CutBatchPanel`. Cần tài khoản có
  `STEEL_ISSUE:CREATE` (thủ kho trung tâm) để xuất 1 đợt sắt mới cho PI đó rồi test tiếp
  nhận→nhập đợt cắt→mời KCS. Tài khoản demo đúng vai này trong DB dev đã bị đổi username qua fixture
  E2E (`muapsh`, route mặc định vào Purchasing chứ không phải Kho) và không rõ mật khẩu — không tự ý
  reset mật khẩu tài khoản khác. Cùng thiết kế UI/logic đã live-test thành công 1 lần ở bản
  2026-08-21 (trước khi bị discard vì sai phạm vi màn, không phải sai thiết kế).
