# Changelog 2026-11-10 — Việt hoá mọi thông báo lỗi người dùng nhìn thấy (BE + FE)

> Trạng thái (10/11): **đã commit** (BE `main`, FE `demo`), **chưa push**. Đã thấy trên trình duyệt ở buổi kiểm thử E2E
> cùng ngày: đăng nhập sai (văn phòng) và sai PIN (công nhân) đều hiện câu tiếng Việt; lỗi tải file hiện câu tiếng Việt.

## Mục lục
1. Vì sao làm
2. BE - phần dùng chung
3. BE - câu lỗi theo module
4. FE
5. Thứ tự deploy
6. Cố ý giữ nguyên
7. Kiểm tra đã chạy

## 1. Vì sao làm
Người dùng hỏi "các thông báo lỗi đã sang tiếng Việt hết chưa". Rà lại thấy còn khoảng 155 câu tiếng Anh trong 41 file BE,
cộng các câu mặc định của framework (validate DTO của class-validator, Prisma, Nest/Throttler, guard quyền). FE hiện
nguyên văn câu BE trả về (`errMsg` / `ApiError.message`), nên câu tiếng Anh lọt thẳng lên màn hình. Yêu cầu: dịch mọi
phần người dùng thấy được.

## 2. BE - phần dùng chung
- **`common/pipes/validation-exception.factory.ts` (mới)** gắn vào `ValidationPipe` toàn cục (`main.ts`,
  `exceptionFactory`). Câu mặc định của class-validator ("quantity must be an integer number") đổi sang tiếng Việt
  theo tên constraint, giữ tham số (min/max, độ dài, danh sách giá trị). Lỗi lồng nhau ghi rõ dòng, đếm từ 1:
  `"lines › dòng 2 › quantity" không được nhỏ hơn 1`. Trường lạ (forbidNonWhitelisted): `Không được gửi "x" (trường
  này không dùng ở đây)`. Câu `message:` tự đặt bằng tiếng Việt trong DTO giữ nguyên. Vẫn trả 400 với `message` là mảng,
  đúng dạng cũ.
- **`common/filters/all-exceptions.filter.ts`:**
  - Prisma: P2002 → `Giá trị đã tồn tại, không được trùng: <trường>`; P2025 → `Không tìm thấy dữ liệu (có thể đã bị
    xoá)...`; P2003 → `Không lưu được: dữ liệu liên kết không tồn tại, hoặc bản ghi đang được dùng ở chỗ khác`; mã khác
    → `Lỗi cơ sở dữ liệu...`. Lỗi 500 → `Hệ thống đang lỗi. Đợi một lát rồi thử lại; vẫn lỗi thì báo quản trị hệ thống.`
  - `translateFrameworkMessage`: đổi câu mặc định của framework khi exception không truyền câu riêng (Unauthorized,
    Forbidden resource, ThrottlerException: Too Many Requests, Not Found, Cannot GET ..., Validation failed (... is
    expected), JSON sai cú pháp, File too large...). Câu nghiệp vụ (đã tiếng Việt) giữ nguyên.
  - Lỗi body-parser (JSON sai cú pháp / quá lớn) không phải HttpException trước đây ra 500 → nay trả đúng 400 / 413
    kèm câu tiếng Việt.
  - `uniqueTargetOf` khi không có thông tin trả `không rõ trường` (trước là `unknown field`).
- **4 guard:** role, mfgRole, permissions (`Tài khoản chưa được cấp quyền: PRODUCT:VIEW. Nhờ quản trị hệ thống cấp
  quyền.`), warehouse-scope. **`parseBigIntId`:** `Mã (id) không hợp lệ: ...`.
- **Auth:** hằng `INVALID_CREDENTIALS = 'Tên đăng nhập hoặc mật khẩu không đúng'` (đăng nhập sai). Refresh token hỏng →
  `Phiên đăng nhập đã hết hạn. Đăng nhập lại.`; đổi mật khẩu sai → `Mật khẩu hiện tại không đúng`; tài khoản không còn
  khi đổi kho/đổi mật khẩu → `Tài khoản không còn hoạt động. Đăng nhập lại.`. `PIN_SETUP_REQUIRED` (mã máy đọc) giữ nguyên.

## 3. BE - câu lỗi theo module
Chia 3 nhóm agent chạy song song, mỗi nhóm một bộ thư mục không trùng; trưởng nhóm review diff và quét lại toàn bộ.
- Nhóm A: bom-revisions, cutting-proposals, production-batches, production-invoices (kể cả thư mục con).
- Nhóm B: products, production-orders, purchase-proposals, qc-reviews, roles, sales-orders, customers, segment-specs,
  skus, steel-issues, suppliers, defect-reasons, external, notifications, office-supplies.
- Nhóm C: material-groups, material-issues, material-yield-issues, material-yield-recipes, materials, packaging-issues,
  system-config, users (cả câu `message` của `create-user.dto.ts`), warehouse-transfers, warehouses, weaving-issues,
  weaving-points.
- Trưởng nhóm quét lại sau 3 nhóm, sửa nốt các câu LAI Việt-Anh còn sót (cả ở module ngoài danh sách: floor, stock):
  `Material "x"` → `Vật tư "x"`, `Caller bị giới hạn ở kho` → `Bạn bị giới hạn ở kho`, `Steel issue` → `Phiếu xuất sắt`,
  `Production batch` → `Đợt sản xuất`, `Plan form` → `Phiếu kế hoạch`, `1 request khác` → `1 yêu cầu khác`,
  `failedQty (...)` → `Số không đạt (...)`, `Segment spec`/`BOM revision` → `Cỡ đoạn`/`bản định mức`.
- Từ vựng thống nhất: ProductionInvoice → lệnh sản xuất; ProductionOrder → lệnh xưởng; PI item → SKU; BomRevision →
  bản định mức; PlanForm → phiếu kế hoạch; CuttingProposal → phương án cắt; CutBundle → đợt cắt; SegmentSpec → cỡ đoạn;
  Piece → mảnh; Part → chi tiết; MaterialYieldRecipe → công thức quy đổi; User → tài khoản.
- Không đổi loại exception, mã HTTP hay logic; chỉ đổi chữ. Spec kiểm câu cũ đã sửa theo câu mới.

## 4. FE
- `services/core/apiError.ts`: thêm `fallbackErrorMessage(status)`. Khi phản hồi không có câu lỗi của BE (mất mạng,
  proxy/CDN trả trang HTML lúc BE khởi động lại) hiện câu tiếng Việt, không còn "Network Error" / "Request failed with
  status code 502". Thêm `isInvalidCredentials` nhận cả câu cũ tiếng Anh lẫn câu mới.
- `services/core/http.ts` `toApiError` dùng 2 hàm trên; body không phải JSON (chuỗi HTML) bỏ qua.
- `Floor/FloorScanApp.tsx`: bỏ so sánh nguyên văn `'Invalid credentials'`, dùng `isInvalidCredentials`.
- Trang Hướng dẫn (`Guide/content/admin.ts`, `materialsShared.ts`, `manufacturing.ts`, `productionPlan.ts`,
  `warehouse.ts`) trích nguyên văn câu lỗi cũ → cập nhật theo câu mới.
- `LoginPage.tsx` không cần sửa: câu tiếng Việt của BE đi thẳng qua nhánh giữ nguyên câu có dấu.

## 5. Thứ tự deploy
FE nhận được cả câu cũ lẫn câu mới, nên BE và FE deploy độc lập, không cần cùng lúc.

## 6. Cố ý giữ nguyên
- Log (`logger.*`), comment, tên enum / mã trạng thái trong câu (DRAFT, ISSUED, AWAITING_QC...), mã quyền
  (`PRODUCT:VIEW`), tên header (`Idempotency-Key`), mã máy đọc (`PIN_SETUP_REQUIRED`, realtime `UNAUTHORIZED`).
- Vài câu dành cho Admin cấu hình còn tên kỹ thuật trong ngoặc (vd `PieceBom/SegmentSpec`, `systemKey=...`,
  `(reassign-order)`).
- `Error` nội bộ không trả thẳng cho người dùng (vd `ExternalApiHttpError`, `duration.util` đọc cấu hình lúc khởi động):
  nếu lọt ra ngoài thì filter đã đổi thành câu 500 tiếng Việt.

## 7. Kiểm tra đã chạy
- Quét lại toàn bộ `src` BE sau khi sửa: không còn câu exception nào có chữ tiếng Anh, trừ 5 dương tính giả
  ("in lại tem", "in phiếu", tên tham số `to`, `(reassign-order)`).
- BE `tsc --noEmit`: không lỗi trong `src`. Còn 2 lỗi có sẵn ở `prisma/seed-ghe-j55-full-bom.ts` và
  `prisma/seed-real-products.ts` (file không đổi, không liên quan).
- BE eslint các file đổi: 0 lỗi (còn cảnh báo `any` có sẵn trong spec).
- BE jest các module đổi (`--maxWorkers=2`): 113 suite, 2545 test xanh. Thêm spec mới: `validation-exception.factory.spec.ts`
  (8 test), `all-exceptions.filter.spec.ts` (thêm 6 test cho câu framework, 500, body-parser).
- FE `tsc --noEmit` sạch; vitest `services/core`, `utils/errors`, `Floor`, `Guide`: 11 file, 108 test xanh (thêm
  `apiError.test.ts`); eslint các file đổi sạch.
- Chưa chạy thử trên trình duyệt.
