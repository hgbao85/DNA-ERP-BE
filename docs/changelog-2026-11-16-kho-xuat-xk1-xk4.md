# Kho xuất XK1–XK4 (rà soát Mua hàng + Kho 14/11) — 16/11/2026

Bước 5 trong checklist của FE `docs/audit-2026-11-14-ra-soat-mua-hang-kho.html`. Không đổi schema, không có migration, không sửa file của Sang.

## XK1 — Xác nhận phiếu XK so với kho in trên phiếu

`IssueSlipsService.confirm()`:

- Gọi `assertSlipScope()` ngay sau `assertDraft()`. Thủ kho kho khác nhận 403, giống `cancel()`. Trước đây chỉ `cancel()` có kiểm này.
- Sau `prepareLine()` của từng dòng, gọi `assertLineInSlipWarehouse()`: kho tra lại của dòng (`warehouseIdOfPrepared()`, lấy cùng trường mà `checkLine()` dùng lúc lập phiếu) phải bằng `slip.warehouseId`. Lệch thì trả 409 "… nay xuất từ kho khác kho X của phiếu - huỷ phiếu và lập lại". Kiểm này thay cho kiểm riêng của dòng mảnh đan, nay áp cho mọi loại dòng: sắt, tiêu hao, đóng gói, vật tư TP, công thức, vật tư kèm, dùng chung.

### Nhân viên để trống phạm vi kho không còn là tổng kho khi ghi

`WAREHOUSE_STAFF` là vai trò gốc "Nhân viên" của MỌI nhân viên văn phòng / kho. Người mua, KHSX, Sales, Quản lý vật tư mang vai trò này kèm cờ `isPurchaser` / `isProductPlanner` / `isSale` / `isMaterialsManager`, và FE dựa vào nó để mở đúng phần mềm. Vì vậy không bỏ vai trò được.

Trước đây phạm vi trống = tổng kho ở mọi service. Hệ quả: 8 tài khoản văn phòng trên DB dev (hieu, khsx, nghi, nguyet, nhan, qlvt, sales, tram) và thủ kho mới tạo mà chưa gán kho xuất / chuyển / nhận / sửa tồn được ở cả 9 kho.

Đã sửa:

- Decorator mới `@RequireAssignedWarehouse()` (`common/decorators/require-assigned-warehouse.decorator.ts`).
- Kiểm ở `WarehouseScopeGuard` (APP_GUARD có sẵn): người có `WAREHOUSE_STAFF`, không phải ADMIN / BOSS, `warehouseScope` trống → 403 `NO_ASSIGNED_WAREHOUSE_MESSAGE`.
- Gắn decorator cho các route GHI của kho:
  - Phiếu XK: tạo / xác nhận / huỷ.
  - Phiếu chuyển kho: tạo, chuyển mảnh, chuyển theo đổi xưởng, xác nhận, từ chối.
  - Nhập đan.
  - Kiểm kê đoạn.
  - Sửa nhanh tồn.
  - Nhận hàng mua: lấy số phiếu, nhận, từ chối.
  - Xuất hàng booking: lấy số phiếu, xác nhận xuất.
  - Vật tư văn phòng: tạo / sửa / điều chỉnh / xoá.
- Màn hình XEM không đổi. Vai trò khác (QLSX, tổ sản xuất) không bị ảnh hưởng.

Thử sống bản build trên DB dev (cổng 3011, tắt việc chạy ngầm, body rỗng nên không ghi gì):

| Tài khoản | POST 5 route | GET danh sách phiếu |
|---|---|---|
| khsx | 403 | 200 |
| khovttp (thủ kho có kho) | 400 (validation, đã qua guard) | 200 |
| admin | 400 (validation, đã qua guard) | 200 |

Production: tài khoản nào thật sự là thủ kho mà đang để trống phạm vi sẽ bị chặn, cần gán kho trước khi deploy.

## XK2 — Vật tư kèm đan có trần định mức

`WeavingIssuesService`:

- `PreparedWeavingMaterial.plannedQty` = Σ định mức vật tư/mảnh (các dòng `PieceMaterialItem` của đúng mảnh + vật tư) × số mảnh/SP × số SP của lệnh.
- `assertMaterialCapInTx(tx, p, excludeSlipId)` chặn khi số cấp lớn hơn phần còn lại. Phần còn lại = định mức − đã cấp (`weaving_issue_materials` của lệnh + mảnh + vật tư) − đang trên phiếu chờ ký khác. Cách tính giống trần định mức của mảnh (`pieceCaps()`).
- Lập phiếu: `IssueSlipsService.create()` gọi trần cùng chỗ kiểm tồn (RPK.2).
- Xác nhận: `createMaterialIssueInTx(..., excludeSlipId)` gọi trần SAU `stock_quant FOR UPDATE`. Không thêm khoá advisory theo lệnh, vì khoá theo lệnh lấy trước khoá tồn sẽ khoá chéo khi một phiếu có 2 lệnh cùng vật tư.

## XK3 — Xuất theo công thức có trần định mức

- `MaterialYieldRecipesService.plannedInputQtyForPi(db, piId, recipe)` = ⌈Σ vật tư ra theo định mức các SKU của PI ÷ `piecesPerBar`⌉.
  - Đây là số GỘP, không trừ tồn vật tư ra như `getProductionDemand()`: tồn vật tư ra tăng dần khi Phôi gia công chính nguyên liệu đã xuất, trừ vào sẽ đếm 2 lần.
  - Phần tính Σ vật tư ra tách thành `requiredOutputByMaterial()`, dùng chung với `getProductionDemand()` (logic không đổi).
- `MaterialYieldRecipeIssuesService.prepareIssue()` ghi `plannedQty`. `createInTx()` chặn "vượt quá số lượng còn có thể xuất" dưới khoá có sẵn `material-yield-recipe-issue:{pi}:{recipe}`, cùng lời báo với các luồng tiêu hao / vật tư TP / đóng gói.

## XK4 — Xuất sắt đúng chiều dài cây của phương án

- `SteelIssuesService.assertMaterialInApprovedProposal()` trả thêm `stockLengthsMm`: các `bestStockLengthMm` khác null của dòng phương án đã duyệt, cắt được, của PI hoặc SKU thuộc PI.
- `prepareIssue()` chặn 400 khi `barLengthMm` không thuộc tập đó. Phương án cũ chưa lưu chiều dài (trước 26/08) thì không kiểm.
- Mỗi (lệnh, loại sắt) chỉ có 1 chiều dài, vì `findConflictingStockLengthReason()` chặn từ lúc duyệt. Nên `drainPool` rút theo số cây vẫn đúng ô chiều dài.

## Test

- Unit:
  - XK1: confirm sai phạm vi → 403; dòng tra ra kho khác → 409.
  - XK2: vượt trần lúc xác nhận (có loại trừ phiếu đang xác nhận); vượt trần lúc lập phiếu.
  - XK3: vượt trần → 400; `plannedInputQtyForPi` gộp 2 SKU.
  - XK4: sai chiều dài → 400; đúng chiều dài và phương án cũ → xuất được.
- Spec cũ của phiếu XK: thêm mock `assertMaterialCapInTx`; sửa dữ liệu giả của phiếu vật tư kèm đã huỷ cho đúng kho Phụ kiện, vì confirm nay kiểm phạm vi trước.
