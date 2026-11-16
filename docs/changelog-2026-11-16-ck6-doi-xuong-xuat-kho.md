# Sửa CK6 rà soát 14/11 — đổi xưởng chạy cùng lúc với xuất sắt / xác nhận phiếu XK

Ngày: 16/11/2026 · Người làm: B (Mua hàng & Kho) · Báo cáo gốc: FE `docs/audit-2026-11-14-ra-soat-mua-hang-kho.html` (CK6).

## Lỗi

Xuất sắt (`SteelIssuesService.prepareIssue`) và xác nhận phiếu XK (`IssueSlipsService.confirm` → `prepareLine`) tra kho theo
xưởng của lệnh NGOÀI transaction. `createInTx` không tra lại kho, không kiểm lại cờ "cần kiểm lại phương án cắt".
`changeWorkshop()` không khoá gì chung với 2 luồng này (`assertPiHasActiveFloorLocked` chỉ khoá `production_orders`). Đổi xưởng
commit giữa lúc tra và lúc ghi → vẫn xuất (và trừ tồn) ở kho xưởng CŨ, lách luôn cờ kiểm lại phương án cắt vừa bật.

## Sửa

- `common/utils/pi-workshop-lock.util.ts` (mới):
  - `lockPisForIssue(tx, piIds)` — khoá dòng `production_invoices` FOR UPDATE (theo id tăng, bỏ trùng) rồi đọc lại xưởng +
    `cuttingRecheckRequired` SAU khoá.
  - `workshopsOfPis()` — chụp xưởng không khoá; `assertWorkshopUnchanged()` — xưởng sau khoá khác lúc tra kho → 409.
- **Đổi xưởng** (`ProductionInvoicesService.changeWorkshop`, phần của Sang — chỉ thêm 1 dòng): gọi `lockPisForIssue` làm việc
  ĐẦU TIÊN trong transaction. Lượt xuất đang chạy xong trước thì `assertNoMaterialIssued` thấy và chặn đổi xưởng như cũ.
- **Xuất sắt** (`SteelIssuesService`): `PreparedSteelIssue.workshopId` = xưởng đã dùng để tra kho (cùng resolver).
  `createInTx` khoá dòng lệnh TRƯỚC mọi khoá khác, rồi: cờ kiểm lại bật → 409 (`CUTTING_RECHECK_MESSAGE`); xưởng khác → 409.
- **Xác nhận phiếu XK** (`IssueSlipsService.confirm`): chụp xưởng các lệnh của phiếu TRƯỚC khi tra kho từng dòng; trong
  transaction (sau khoá phiếu) khoá mọi lệnh của phiếu và so lại. Áp cho MỌI loại dòng có lệnh (sắt, tiêu hao, đóng gói, vật tư
  TP, công thức, xuất đan), không chỉ sắt. Dòng "Dùng chung" không có lệnh nên không đụng.

Thứ tự khoá: phiếu XK (nếu có) → dòng lệnh → production_orders → giữ chỗ / stock_quant. Không luồng nào khác khoá dòng
`production_invoices` (đã grep), nên không có vòng chờ mới.

## Thử sống (16/11, bản sao DB dev chạy local, đã xoá)

Bản sao DB dev (Docker `postgres:17-alpine`, cổng 5433) + BE bản đã sửa (cổng 3011). PI-2026-004, sắt SAT-001 cây 6000 mm,
giữ chỗ 5, tồn 5, xưởng Phú An. Lập 2 phiếu XK nháp, mỗi phiếu 1 cây.

| Ca | Cách làm | Kết quả |
| --- | --- | --- |
| Đổi xưởng chen giữa | Phiên SQL khoá dòng lệnh 78 + chuyển lệnh sang Phước An, giữ khoá 10 giây; giây thứ 3 gọi xác nhận phiếu 1 | API chờ 7,2 giây tới khi đổi xưởng commit rồi trả **409** "Lệnh vừa đổi xưởng trong lúc xuất". Phiếu vẫn nháp, không có lần xuất sắt nào, tồn không đổi. |
| Xuất bình thường | Trả lệnh về Phú An, xác nhận phiếu 2 | **201**, phiếu ISSUED, tồn cây 6000 mm 5 → 4, giữ chỗ đã tiêu 1. |
| Đổi xưởng qua API | QLSX đổi PI-2026-005 Phú An → Phước An → Phú An | Cả 2 lần **200**, không lỗi, không deadlock trong log. |

## Test

- `pi-workshop-lock.util.spec.ts` (mới): khoá FOR UPDATE theo id tăng, đọc xưởng/cờ sau khoá, so xưởng.
- `steel-issues.service.spec.ts`: 2 ca CK6 (cờ kiểm lại bật sau khoá → 409; đổi xưởng chen giữa → 409, không ghi).
- `issue-slips.service.spec.ts`: ca CK6 (chụp xưởng trước khi tra kho, khoá trong transaction, chen giữa → 409, không ghi).
- `production-invoices.service.spec.ts`: đổi xưởng khoá dòng lệnh trước khi ghi.
- 3 bộ test cũ mock module khoá để không đổi thứ tự `$queryRaw` của test cũ.
