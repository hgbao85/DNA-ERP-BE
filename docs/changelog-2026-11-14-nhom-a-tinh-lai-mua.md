# Sửa nhóm A rà soát 14/11 — tính lại dòng mua đếm sai hàng đã nhận (MH1, MH2, MH3)

Ngày: 14/11/2026 · Người làm: B (Mua hàng & Kho) · Báo cáo gốc: FE `docs/audit-2026-11-14-ra-soat-mua-hang-kho.html` (mục 01).

Phạm vi: 3 nguồn mua ngoài sắt (vật tư tiêu hao, pat / vật tư thành phẩm theo mảnh, vật tư thành phẩm theo công thức). Luồng
sắt (`cutting-proposals.service.ts`) không đổi — xem "Chưa làm".

## MH1 — tính lại thì mua thêm cả hàng đã nhận

**Lỗi.** Lần tính đầu chưa có tồn thì nguồn mua không tạo dòng giữ chỗ. Hàng về, `creditPool` tạo dòng "của cả lệnh"
(PRODUCTION_INVOICE). Lần tính lại chỉ co dòng của nguồn (`shrinkToFloor`), dòng "của cả lệnh" vẫn bị `getAvailableQty` trừ
như lệnh khác đang giữ → mua thêm đúng phần đã nhận. Ví dụ: cần 100, đã nhận 60, nhu cầu lên 120 → tạo dòng 80 thay vì 20.

**Sửa.**
- `StockReservationsService.releaseOwnHoldsForRecompute()` (thay `shrinkToFloor`, đã xoá): khoá FOR UPDATE rồi co về phần đã
  tiêu CẢ dòng của nguồn lẫn dòng "của cả lệnh" của chính PI (cùng vật tư, quy cách). Dòng "của cả lệnh" chỉ co khi nằm ở đúng
  kho đang tính; dòng ở kho khác (sau đổi xưởng) để nguyên — thuộc thiết kế giữ chỗ theo kho (nhóm B).
- Hàm trả về phần **đã tiêu** (đã xuất cho PI, mọi kho). 3 nguồn mua coi phần này là "đã có":
  - số mua = nhu cầu × (1 + % hao hụt) − (tồn khả dụng + đã xuất);
  - giữ chỗ = sàn đã tiêu của dòng nguồn + min(nhu cầu − đã xuất, tồn khả dụng).

  Trước đây nhu cầu là tổng cả PI nhưng phần đã xuất không được trừ, nên tính lại sau khi xuất cũng mua lại phần đã xuất; và
  giữ chỗ chỉ giữ tới sàn đã tiêu, phần còn trong kho bị bỏ ngỏ cho lệnh khác.
- Thứ tự khoá: khoá `stock_quant` rồi mới khoá dòng giữ chỗ — cùng thứ tự với luồng xuất vật tư (trước đây ngược lại).

**Giới hạn.** "Đã xuất" lấy từ `consumedQty` của giữ chỗ — chỉ ghi được khi lúc xuất có giữ chỗ để rút
(`drainPoolBestEffort`). Xuất không qua giữ chỗ thì không đếm được, lệch về phía mua thêm như trước, không bao giờ mua thiếu.

## MH2 — nhánh "chỉ còn dòng đã đóng" trừ sai

**Lỗi.** `planPurchaseRecompute`: khi mọi dòng đã đóng, `shortfall = số mới − receivedQty của dòng ĐẦU` — trừ hàng đã nhận lần
thứ 2 (mua thiếu) và bỏ quên các dòng đóng sau.

**Sửa.** Số mới đã trừ hàng đã nhận (MH1), nên thiếu bao nhiêu mua bấy nhiêu: `create = số mới` khi > 0. MH1 và MH2 phải đi
cùng nhau — trên DB dev, PI-2026-004 / TR-001 hiện ra đúng chỉ vì 2 lỗi triệt tiêu nhau.

## MH3 — tính lại và Giám đốc ký đơn không khoá chặn nhau

**Lỗi.** Tính lại chỉ giữ `purchase-proposal-merge:<PI>`, ký đơn / nhận hàng / đóng thiếu giữ `purchase-proposal-mutate:<đề xuất>`.
Tính lại đọc dòng không khoá rồi ghi → có thể ghi đè hoặc đóng mất dòng vừa được ký.

**Sửa.** `common/utils/purchase-proposal-lock.util.ts` — `findOpenProposalForRecompute()`: tìm đề xuất còn mở của PI, khoá
`purchase-proposal-mutate:<id>`, đọc lại dòng SAU khoá. 3 nguồn gọi ở ĐẦU transaction, ngay sau khoá merge và TRƯỚC khoá
`stock_quant` — luồng nhận hàng khoá đề xuất rồi mới khoá `stock_quant`, lấy ngược thứ tự là khoá chéo. Thứ tự chung:
merge → mutate → stock_quant → giữ chỗ. Không luồng ký / nhận nào lấy khoá merge nên không có vòng chờ.

## Chưa làm

- **Luồng sắt** (`CuttingProposalsService.approve`, phần của Sang): cũng tính lại dòng mua dưới khoá merge mà không khoá mutate.
  Không thêm khoá mutate ở đó được vì luồng này khoá `stock_quant` TRƯỚC khoá merge — thêm mutate sau sẽ khoá chéo với nhận
  hàng. Muốn sửa phải chuyển khoá merge + mutate lên trước bước khoá tồn của approve() — cần bàn với Sang.
- Giữ chỗ ở kho khác sau đổi xưởng: nhóm B.

## Thử sống (14/11, bản sao DB dev chạy local, đã xoá)

Bản sao DB dev (Docker `postgres:17-alpine`, cổng 5433) + BE bản đã sửa (cổng 3011). Admin bấm "Tạo lại" dòng mua ngoài sắt
(`POST /production-invoices/:id/items/:itemId/retry-production-order`) cho PI-2026-003 và PI-2026-004:

| Lệnh / vật tư | Trước | Sau "Tạo lại" |
| --- | --- | --- |
| PI-2026-003 · VTK-004 | 1 dòng đã ký mua 20,3, nhận 15; giữ "của cả lệnh" 15 | Không tạo dòng mới (bản cũ dự kiến tạo dòng mua dư 15). Giữ "của cả lệnh" về 0, dòng của nguồn tiêu hao giữ 15. |
| PI-2026-004 · TR-001 | 1 dòng đã đóng, mua và nhận 81,2; giữ "của cả lệnh" 81,2 | Không tạo dòng mới. Dòng của nguồn giữ 80 (nhu cầu thật, 81,2 là đã cộng hao hụt). |

Tổng số dòng mua giữ nguyên 122, BE không báo lỗi, không kẹt khoá. Chưa chạy bản cũ trên cùng bản sao để đối chứng — số "dư 15"
của bản cũ lấy từ phép đo chỉ đọc ở bước 1 (FE `docs/audit-2026-11-14-ra-soat-mua-hang-kho.html`, mục 08).

## Test

- `stock-reservations.service.spec.ts`: 4 test cho `releaseOwnHoldsForRecompute` (thay 3 test `shrinkToFloor`).
- `purchase-recompute.util.spec.ts`: nhánh dòng đã đóng theo số mới đã trừ hàng nhận, thêm ca 2 dòng đã đóng.
- `consumable-material-purchase.service.spec.ts`: ví dụ MH1 (nhu cầu 120, đã nhận 60 → mua 60), ca đã xuất 50, thứ tự khoá MH3.
- `piece-material-yield-purchase` / `material-yield-recipe-purchase` spec: cập nhật theo hàm mới và cách tìm đề xuất mới.
- `test/integration/reservation-own-pi.integration.spec.ts` (Postgres test thật): ca "tính lại sau khi PI đã xuất 20/100" trước
  đánh dấu `it.failing` (lỗi biết từ 27/10, mua thừa 20 và chỉ giữ 60) nay đổi thành `it` thường vì đã qua.
