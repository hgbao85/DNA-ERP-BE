# Changelog 2026-08-06 — Phase 7: Production Order & Cutting Proposal (tích hợp cat_sat_iea)

> Mô tả toàn bộ thay đổi sắp commit cho tính năng "Đề xuất cắt sắt" — nối `DNA-ERP-BE` với solver
> `cat_sat_iea` (`D:\DNA-DEXUAT`). Bao gồm cả 1 thay đổi nhỏ ở repo `cat_sat_iea` (vá lỗ hổng auth)
> đi kèm bắt buộc, không tách rời được về mặt vận hành dù khác repo.

## 1. Tính năng làm gì

Khi Sếp duyệt 1 SKU trong "Lệnh sản xuất" (`POST /production-invoices/:id/items/:itemId/approve`),
hệ thống **tự động, ngầm** (không có màn hình riêng, không có loading state cho Sếp chờ):

1. Tạo 1 `ProductionOrder` (lệnh sản xuất tại xưởng), ghim `quantity` (snapshot từ
   `ProductionInvoiceItem.quantity` — giá trị do Sales tạo, không ai sửa được sau đó) và
   `bomRevisionId` (ACTIVE revision của sản phẩm tại thời điểm duyệt).
2. Gọi solver `cat_sat_iea` (`POST /api/v1/de_xuat/propose/`) để tính phương án cắt sắt tối ưu,
   chạy dạng fire-and-forget (không chặn response duyệt SKU).
3. Nếu 2 chiều dài chuẩn cấu hình sẵn không đạt hao hụt mục tiêu, **tự động gọi lại lần 2** với
   chế độ dò chiều dài tự do (theo yêu cầu nghiệp vụ từ Sếp, 2026-08-06).
4. Lưu kết quả vào DB, đủ chi tiết để Phôi cắt theo (pattern, mẩu nguyên còn lại) và Mua hàng
   dùng làm nguồn chính xác (số cây/loại sắt) thay vì ước lượng thô qua BOM.
5. Báo QLSX (không phải Sếp) qua hệ thống Notification có sẵn khi tính xong hoặc thất bại.

## 2. Thay đổi CSDL — 4 migration mới

| Migration | Nội dung |
|---|---|
| `20260805084929_add_production_order_and_cutting_proposal` | Bảng `production_orders`, `cutting_proposals`, `cutting_proposal_lines`, `cutting_proposal_patterns`, `cutting_proposal_pattern_segments`; enum `ProductionOrderStatus`, `CuttingProposalStatus` (gồm `CALCULATING`/`FAILED` cho luồng bất đồng bộ); thêm 9 field `solver*` vào `system_config` (tham số gọi solver, admin sửa qua `PUT /system-config`). |
| `20260805094237_add_mau_nguyen_and_length_comparison` | Thêm `mauNguyenMm` (mẩu sắt còn nguyên chưa cắt, cần cho Phôi nhập kho) vào `cutting_proposal_lines` + `cutting_proposal_patterns`; thêm `lengthComparison` (JSON, bảng so sánh hao hụt giữa các chiều dài) vào `cutting_proposal_lines`. |
| `20260806004645_add_production_manager_notification_audience` | Thêm giá trị `PRODUCTION_MANAGER` vào enum `NotificationAudience` — trước đó chỉ có `ALL`/`BOSS`/`WAREHOUSE_STAFF`, không có cách nào báo riêng cho QLSX. |
| `20260806015941_update_solver_scan_range_defaults` | Đổi default dò chiều dài: `solverMinLengthMm` 4000→**5000**, `solverMaxLengthMm` 12000→**6000**, `solverLengthStepMm` 50→**10** (theo số Sếp chốt); kèm `UPDATE system_config` để áp luôn cho dòng singleton đã seed sẵn, không chỉ default cho môi trường mới. |

## 3. Thay đổi cấu hình

**Biến môi trường mới** (`.env.example`, `src/config/{configuration,env.validation}.ts`) — thông tin
**kết nối** tới solver, không phải tham số tính toán:
- `SOLVER_BASE_URL`, `SOLVER_API_KEY` — bắt buộc.
- `SOLVER_TIMEOUT_SECONDS` (default 300) — timeout phía HTTP client, **khác** với
  `SystemConfig.solverTimeLimitSeconds` (thời gian solver được phép giải mỗi lần, gửi trong body
  request) — xem mục 5 vì sao tách biệt.

**Tham số nghiệp vụ** — nằm ở `SystemConfig` (admin sửa qua `PUT /system-config`), vì trigger chạy
tự động không còn form nào để nhập tay mỗi lần:
`solverStockLengths` (mảng chiều dài chuẩn, mm), `solverTrimStartMm`, `solverBladeWidthMm`,
`solverMaxWastePercentage`, `solverMaxSurplus`, `solverMinLengthMm`/`solverMaxLengthMm`/
`solverLengthStepMm` (dải + bước dò khi cần), `solverTimeLimitSeconds`.

## 4. Module mới

### `src/modules/production-orders/`
Chỉ đọc (`GET /production-orders`, `GET /production-orders/:id`) — **không có** API tạo/release
thủ công ở bản này. `ProductionOrdersService.createFromApproval()` là điểm vào duy nhất, gọi nội bộ
từ `ProductionInvoicesService.approveItem()`.

### `src/modules/cutting-proposals/`
- `requestForOrder()` — tạo `CuttingProposal` (status `CALCULATING`), bắn solver ngầm, trả về ngay.
  Dùng chung cho cả trigger tự động (không cần Idempotency-Key) và nút "Tính lại" thủ công (có
  Idempotency-Key qua header, chặn gọi trùng khi retry mạng) — endpoint
  `POST /production-orders/:id/cutting-proposals`.
- `runSolverAndSave()` — logic chính: dựng `bom[]` từ `piece_bom`/`bom_piece`/`segment_spec` (nhánh
  "mảnh" — nhánh "chi tiết" `bom_part`/`part_bom` **chưa hỗ trợ**, vì phía admin chưa xây, không
  phải bỏ vĩnh viễn), gọi solver, map `purchase_plan[]` về 3 bảng con, cập nhật status
  `DRAFT`/`FAILED`.
- `approve()` — duyệt 1 phương án, tự động chuyển các phương án `DRAFT`/`APPROVED` khác cùng PO
  sang `SUPERSEDED`.
- `GET /production-orders/:id/cutting-proposals`, `GET /cutting-proposals/:id`,
  `POST /cutting-proposals/:id/approve`.

## 5. Các gotcha contract thật với solver (phát hiện khi đọc trực tiếp `cat_sat/de_xuat_logic.py` và `api/views.py`, không phải suy đoán từ doc)

1. **`stock_lengths` phải là chuỗi** cách nhau khoảng trắng (`"5850 6000"`), không phải mảng JSON —
   `views.py` parse bằng `str(...).replace(",", " ").split()`, gửi mảng JSON sẽ bị hỏng phần tử
   đầu/cuối (dính ký tự `[`/`]`).
2. **`spec` luôn gửi rỗng (`''`)**, không gửi `Material.spec` thật — solver gom nhóm material theo
   khoá `f"{material} {normalize_spec(spec)}"`; gửi spec thật làm khoá lệch, phá vỡ round-trip
   `BigInt(item.material)` khi map kết quả trả về ngược lại `materialId`.
3. **`auto_scan` mặc định `false`** ở lần gọi đầu — bật lên sẽ vét cạn hàng trăm lần giải (theo
   đúng comment của solver: "để người dùng chủ động bật, không tự chạy ngầm"). Chỉ bật `true` ở
   lần gọi thứ 2, khi lần 1 báo `any_over_threshold: true` (mục 1 phía trên).
4. Timeout gửi trong request (`time_limit_seconds`) phải nhỏ (mặc định 20s/lần), **không dùng**
   default 480s của chính solver — vì tổng số lần giải = số loại sắt × (1 + N lần dò), có thể lên
   tới hàng trăm lần.

## 6. Thông báo QLSX

`CuttingProposalsService` bắn 1 `Notification` (audience `PRODUCTION_MANAGER`) khi tính xong hoặc
thất bại — tiêu đề nêu mã `PO-x`, nội dung nêu lý do nếu lỗi (gồm `failing_materials` nếu solver
trả về). Việc bắn thông báo tự bọc try/catch riêng, lỗi ở bước này chỉ log lại, không ảnh hưởng kết
quả đã lưu.

## 7. Phạm vi chưa làm / để dành

- Nhánh "chi tiết" (`bom_part`/`part_bom`) chưa đưa vào `bom[]` gửi solver — chưa có dữ liệu thật.
- Không có API tạo/release `ProductionOrder` thủ công — chỉ tự động qua `approveItem()`.
- Chưa tách `min_length`/`max_length`/`length_step` theo từng loại sắt riêng — dùng chung 1 cấu
  hình cho mọi loại.
- Phần FE (hiển thị trạng thái `CALCULATING`/`DRAFT`/`FAILED`, polling, nút "Tính lại") chưa làm —
  nằm ngoài phạm vi repo này.

## 8. Thay đổi kèm theo ở repo `DNA-DEXUAT` (bắt buộc đi cùng)

Vá lỗ hổng bảo mật: endpoint `POST /api/v1/de_xuat/propose/` trước đó **không có xác thực nào**.
Thêm decorator `require_api_key` (`api/views.py`), kiểm tra header `Authorization: Bearer <key>` so
với `settings.ERP_API_KEY` (`iea_project/settings.py`, đọc từ env, **fail-closed** — rỗng/sai đều từ
chối). `SOLVER_API_KEY` (phía BE) và `ERP_API_KEY` (phía solver) phải khớp giá trị khi deploy.

## 9. Danh sách file thay đổi (repo `DNA-ERP-BE`)

**Sửa:**
```
.env.example
prisma/schema.prisma
src/app.module.ts
src/common/constants/permission-modules.constant.ts
src/common/constants/role-permissions.constant.ts
src/config/configuration.ts
src/config/env.validation.ts
src/modules/external/external-api.service.ts
src/modules/notifications/notifications.service.ts
src/modules/production-invoices/production-invoices.module.ts
src/modules/production-invoices/production-invoices.service.spec.ts
src/modules/production-invoices/production-invoices.service.ts
src/modules/system-config/dto/system-config-response.dto.ts
src/modules/system-config/dto/update-system-config.dto.ts
src/modules/system-config/system-config.service.ts
```

**Mới:**
```
prisma/migrations/20260805084929_add_production_order_and_cutting_proposal/
prisma/migrations/20260805094237_add_mau_nguyen_and_length_comparison/
prisma/migrations/20260806004645_add_production_manager_notification_audience/
prisma/migrations/20260806015941_update_solver_scan_range_defaults/
src/modules/cutting-proposals/
src/modules/production-orders/
docs/changelog-2026-08-06-phase-7-production-order-cutting-proposal.md
```

## 10. File thay đổi (repo `DNA-DEXUAT`)

```
.env.example
api/views.py
iea_project/settings.py
```

## 11. Đã xác minh trước khi commit

`npx tsc --noEmit` sạch · `npx eslint` sạch trên toàn bộ file trong danh sách trên (không tính nợ
CRLF có sẵn từ trước ở vài file không liên quan) · `npx jest` 130/130 test pass (18 suite) · boot
thật (`ts-node src/main.ts`) lên cổng 3001 không lỗi, đủ route mới · migration đã áp thành công vào
Postgres local (Docker) và verify lại bằng `prisma migrate status`.
