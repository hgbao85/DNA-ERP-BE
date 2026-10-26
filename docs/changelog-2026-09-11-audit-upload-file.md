# Changelog 2026-09-11 — Audit toàn hệ thống: các chỗ upload file

## Bối cảnh

Người dùng yêu cầu: "hãy check xem các chỗ nào đang có thể upload file được" — rà toàn bộ FE
(`DNA-ERP`) + BE (`DNA-ERP-BE`) để liệt kê mọi nơi có thể chọn/upload file, và endpoint nào xử lý
thật. Ban đầu là REVIEW THUẦN (không sửa) - sau đó người dùng xác nhận: (1) sửa luôn 2 bug đã tìm
thấy, (2) làm thêm 1 trang Admin để sửa/xóa lại được 3 chỗ "chỉ tạo, không sửa/xóa" (audit-trail cố
ý bất biến) khi lỡ chọn nhầm file, miễn là bản thân việc sửa/xóa cũng được ghi log. Toàn bộ đã làm
xong - xem mục "Đã làm (vòng 2)".

**Cập nhật lần 3 (cùng ngày)**: người dùng hỏi trực tiếp Sếp Trương Văn Nhân qua chat nội bộ "ai là
người được quyền sửa (account nào được xem và sửa)" - Sếp trả lời "cho người nhập được sửa luôn
anh", KHÔNG chỉ Admin như thiết kế ban đầu ở vòng 2. Đã mở quyền tự sửa/xóa cho CHÍNH người đã nhập
(KCS/Mua hàng/Kho) NGAY TẠI màn họ đang làm việc, giữ nguyên cửa Admin làm lưới an toàn - xem mục
"Đã làm (vòng 3)".

## Phạm vi BE

Toàn bộ upload file đi qua đúng 1 module dùng chung: `src/modules/uploads/uploads.controller.ts` +
`cloudinary.service.ts` — không có endpoint upload nào khác trong repo (đã grep toàn bộ
`FileInterceptor`/`UploadedFile`/`multipart`).

- `POST /uploads/image` — chỉ nhận `image/jpeg|png|webp|gif`, tối đa 5MB → trả `{ imageUrl }`
  (Cloudinary `resource_type=image`).
- `POST /uploads/document` — nhận thêm PDF + Excel (`.xls`/`.xlsx`), tối đa 10MB → trả `{ fileUrl }`
  (ảnh dùng `resource_type=image`, còn lại `resource_type=raw` — PDF/Excel không đi qua pipeline ảnh
  của Cloudinary).

Ghi chú đã có sẵn từ trước (không phải phát hiện mới, xem `src/app/phantich/page.tsx:302`):
`POST /uploads/image` chỉ yêu cầu đăng nhập, chưa kiểm tra quyền theo module.

## 7 chỗ FE có UI chọn file (`&lt;input type="file"&gt;`)

### 5 chỗ hoạt động đúng — upload thật lên Cloudinary qua `uploadImage()`/`uploadDocument()`
(`src/services/uploads-api.ts`)

1. `src/modules/pages/Admin/shared/AdminEntityPage.tsx:276` — ảnh entity chung (Admin CRUD),
   `uploadImage()`, upload trễ tới lúc bấm Lưu (tránh mồ côi ảnh trên Cloudinary nếu Hủy giữa chừng).
2. `src/modules/pages/Manufacturing/SpecSteelPage.tsx:210` — ảnh mảnh Dây, `uploadImage()`, upload
   lúc Gửi phê duyệt.
3. `src/modules/pages/Kcs/KcsPhoiPage.tsx:433` — ảnh lỗi khi KCS duyệt Phôi (tab Xẻ), `uploadImage()`,
   upload ngay lúc chọn ảnh.
4. `src/modules/pages/InboundWarehouse/KhoChuyenKiemPage.tsx:85` — ảnh lỗi kiểm chuyển kho,
   `uploadImage()`, upload lúc Lưu.
5. `src/modules/pages/Purchasing/LenhMuaNCCPage.tsx:362` — phiếu Sếp đã ký (duyệt mua hàng),
   `uploadDocument()` (nhận cả PDF/Excel).

### 2 chỗ ĐANG HỎNG — có UI chọn file nhưng KHÔNG upload thật lên server (ĐÃ SỬA, xem "Đã làm (vòng 2)")

1. **`src/components/sanxuat/kcsCore.tsx:87-93`** (`KcsReviewModal`, dùng trong
   `src/modules/pages/Kcs/KcsStagePage.tsx` — màn KCS duyệt Hàn/Sơn/VTTP thật, chính màn vừa sửa
   "hiện ảnh lỗi KCS" ở changelog `changelog-2026-09-11-qa-audit-san-xuat.md` mục B4). `onPickPhoto`
   gọi `api.uploadContractFile(file)` — đây là **hàm MOCK** ở
   `src/lib/mock/services/mfg.service.ts:45`, chỉ `await mockDelay()` rồi trả chuỗi giả
   `/mock/contract-&lt;timestamp&gt;.pdf`, không gọi Cloudinary/BE thật nào.
   - **Hậu quả**: ảnh lỗi KCS chấm cho Hàn/Sơn/VTTP không bao giờ lưu thật lên server — field
     `photoUrl` của review sẽ là URL rác/không tồn tại, `&lt;img&gt;` hiện vỡ ảnh (đúng nhánh vừa được
     B4 wiring để render, nhưng dữ liệu nguồn vào đã sai từ bước upload).
   - So sánh: `KcsPhoiPage.tsx` (mục 3 ở trên, dùng cho Phôi) đã đúng `api.uploadImage()` thật — chỉ
     nhánh Hàn/Sơn/VTTP dùng chung `kcsCore.tsx` là còn sót gọi hàm mock, nhiều khả năng bị bỏ sót
     lúc cutover Phôi/Hàn/Sơn/KCS sang backend thật (2026-08-14, xem doc comment `api.ts:69-83`) —
     comment ở `api.ts:76` gọi nhầm `uploadContractFile` là "hàm còn dùng thật", trong khi bản thân
     hàm đó là mock 100%.
   - **Đã sửa**: đổi `api.uploadContractFile(file)` → `api.uploadImage(file)` ở `kcsCore.tsx:90`
     (đồng bộ đúng cách `KcsPhoiPage.tsx` đã làm) — không cần đổi BE.

2. **`src/modules/pages/Sales/OrderManagementPage.tsx:260-264`** — "File đính kèm (PO, hợp đồng...)"
   khi tạo đơn hàng Sales. Dùng `URL.createObjectURL(file)` — tạo `blob:` URL chỉ tồn tại trong tab
   trình duyệt hiện tại, không upload đi đâu. URL này được lưu THẲNG vào field `attachmentUrl` thật
   của `SalesOrder` ở BE (`sales-orders-api.ts`) và render lại qua `&lt;a href={po.attachmentUrl}&gt;`
   (dòng 383-385).
   - **Hậu quả**: sau khi tải lại trang/đổi máy/đổi người xem, link này chết hoàn toàn (blob URL đã bị
     trình duyệt thu hồi hoặc thuộc phiên khác) — không ai xem lại được file đính kèm, dù DB vẫn lưu
     1 giá trị trông như URL hợp lệ.
   - **Đã sửa**: đổi form state sang giữ `File` thô (`attachmentFile`), upload thật qua
     `uploadDocument()` (chấp nhận PDF/Excel — khớp đúng loại file "PO, hợp đồng" nêu trong nhãn
     field) NGAY LÚC bấm "Tạo PO" (`handleSave()`), theo đúng pattern upload-lúc-Lưu đã dùng ở
     `AdminEntityPage.tsx`/`KhoChuyenKiemPage.tsx` (tránh mồ côi file trên Cloudinary nếu Hủy giữa
     chừng).

## Đã kiểm tra thêm, không phải upload thật (loại khỏi audit)

- Đã grep `Dropzone`/`onDrop`/`useDropzone`/`DataTransfer` trong toàn bộ FE — không có vùng kéo-thả
  file nào ngoài 7 `&lt;input type="file"&gt;` liệt kê trên.
- BE không có endpoint import Excel/CSV hay xử lý file nào khác ngoài `uploads.controller.ts`.

## Đã làm (vòng 2) — vá 2 bug + Admin quản lý tệp đính kèm

Người dùng xác nhận qua trao đổi tiếp theo: sửa cả 2 bug ở trên, VÀ làm thêm 1 trang Admin để
sửa/xóa lại 3 chỗ "chỉ tạo, không sửa/xóa" (ảnh lỗi KCS/kiểm chuyển kho/phiếu Sếp duyệt) khi lỡ
chọn nhầm - miễn là chính việc sửa/xóa đó cũng được ghi log (không phá nguyên tắc audit-trail).
Plan đầy đủ: `wise-gathering-lake.md` (đã duyệt qua ExitPlanMode).

### 1-2. Vá 2 bug upload (xem mục trên, đã cập nhật trạng thái "Đã sửa")

### 3. Vá `CloudinaryService.deleteByUrl()` để hỗ trợ file `raw`

`src/modules/uploads/cloudinary.service.ts` - thêm tham số `resourceType: 'image' | 'raw' =
'image'`. Trước đây hàm này CHỈ xóa được `resource_type='image'` (tự ghi chú "chưa vá" từ trước) -
file `raw` (PDF/Excel) bị cắt nhầm phần mở rộng khỏi public_id + destroy() không truyền
resource_type nên SDK mặc định 'image', Cloudinary âm thầm trả "not found", không xóa được gì. Vá
đúng 2 điểm đó, giữ mặc định 'image' nên mọi lời gọi cũ (`materials.service.ts`/`skus.service.ts`)
không đổi hành vi. Test mới trong `cloudinary.service.spec.ts` (nhánh raw giữ nguyên đuôi file +
truyền đúng resource_type).

### 4. 3 endpoint Admin-override mới (BE)

Pattern chung: `@RequirePermissions(UPDATE)` + `@RequireRole(DEFAULT_ROLES.ADMIN)` (ADMIN được seed
full quyền mọi module - `prisma/seed.ts:172`, không cần sửa `role-permissions.constant.ts`), dọn
file Cloudinary cũ qua `deleteByUrl()` best-effort.

- `PATCH qc-reviews/:id/photo` (`QcReviewsService.updatePhoto()`) - CHỈ sửa `photoUrl` (`null` =
  xóa hẳn), không đụng `failedQty`/`reason`/... (BẤT BIẾN theo đúng doc comment gốc). `QcReview` đã
  có sẵn trong `AUDITED_MODELS` (`audit-log.extension.ts`) nên `.update()` TỰ ghi AuditLog, không
  cần code thêm - **đã xác nhận sống**: xóa 1 ảnh qua UI, query lại `GET /audit-logs?tableName=
  QcReview` thấy đúng dòng UPDATE với oldValue/newValue.photoUrl khớp.
- `GET production-invoices/transfer-check/defects` (mới, phẳng, lọc `imageUrl != null`) +
  `PATCH production-invoices/transfer-check/defects/:id/photo` (`ProductionInvoicesService.
  listTransferCheckDefects()`/`updateTransferCheckDefectPhoto()`). Path 2 segment (không phải 1) -
  tránh đúng bug route-collision với `@Get(':id')` đã tự ghi chú sẵn trong file này (`transfer-
  check/batch`). `TransferCheckDefect` KHÔNG trong AUDITED_MODELS nên ghi tay qua `writeAuditLog()`.
- `PATCH purchase-proposals/:id/items/:itemId/approval-file` (`PurchaseProposalsService.
  updateApprovalFile()`) - CHỈ CHO THAY (`approvalFileUrl` bắt buộc có giá trị, không nhận null) vì
  đây là "bằng chứng duy nhất" cho việc đã được duyệt mua (doc comment schema.prisma) - xóa về rỗng
  là trạng thái vô nghĩa khi item vẫn PURCHASING. Ghi tay qua `auditProposalDecision()` sẵn có (cùng
  hàm `bossApprove()` đang dùng). Không rõ file cũ image hay raw nên gọi `deleteByUrl()` cả 2 loại
  (best-effort, không throw nếu sai loại).

Test mới: `qc-reviews.service.spec.ts` (+4 test), `production-invoices.service.spec.ts` (+3 test),
`purchase-proposals.service.spec.ts` (+3 test). Toàn bộ 995 test BE pass, `tsc`/`eslint` sạch.

### 5. Trang Admin mới "Quản lý tệp đính kèm" (FE)

`src/modules/pages/Admin/AttachmentsPage.tsx` (mới, đăng ký trong `AdminApp.tsx` - mục nav riêng,
KHÔNG nhét vào `BusinessDataPage.tsx` vì trang đó ghi rõ "chỉ xem, không thao tác"). 3 tab:
- Tab "KCS" - `getAllQcReviews()`/`updateQcReviewPhoto()` (steel-issues-api.ts), nút "Đổi ảnh"/"Xóa
  ảnh".
- Tab "Kho" - `getTransferCheckDefects()`/`updateTransferCheckDefectPhoto()` (transfer-check-api.ts),
  cùng UI.
- Tab "Mua hàng" - lấy từ `useInspection().proposals` có sẵn (đã cutover BE thật, xem comment đầu
  `InspectionContext.tsx`), có cả "Thay file" lẫn "Xóa file" - xem mục "Vòng 3" bên dưới vì sao đổi
  ý cho xóa.
- Tên 3 tab ban đầu mô tả loại file ("Ảnh lỗi KCS"/"Ảnh lỗi kiểm chuyển kho"/"Phiếu Sếp duyệt mua
  hàng") - đổi sang tên CHỨC VỤ/bộ phận thao tác ("KCS"/"Kho"/"Mua hàng") theo góp ý người dùng, xem
  mục "Vòng 3".

**Phát hiện phụ khi live-test**: trang "Nhật ký hoạt động" (`AuditLogPage.tsx`) hiện vẫn đọc mock
trong trình duyệt, CHƯA cutover sang bảng `AuditLog` thật (khác `PurchaseProposalAuditTrail` - 1
component riêng đã đọc đúng `GET /audit-logs`) - nên log ghi bởi 3 endpoint mới ở trên KHÔNG hiện
trong "Nhật ký hoạt động" dù ghi đúng ở BE. Đã sửa câu chữ trong `AttachmentsPage.tsx` cho chính xác
(không claim hiện trong "Nhật ký hoạt động"). KHÔNG sửa cutover đó trong việc này (ngoài phạm vi,
là gap lớn hơn của cả trang Admin, cần 1 việc riêng nếu người dùng muốn).

**Phát hiện phụ khác**: khi live-test phát hiện 1 migration đang chờ áp dụng từ trước
(`20260910100000_add_sales_order_order_code`, không liên quan việc này) gây lỗi 500 "Database
error" ở `GET /purchase-proposals` (Prisma Client mới generate lệch với DB dev chưa migrate). Migration
an toàn (chỉ thêm cột + backfill, mirror pattern đã có) - đã áp dụng (`prisma migrate deploy`) để gỡ
block kiểm thử.

**Kiểm tra**: BE `tsc`/`eslint`/995 test pass. FE `tsc`/`eslint` sạch. Live-test qua UI thật (role
`admin`): xóa 1 ảnh lỗi KCS thành công, xác nhận qua `GET /audit-logs` thấy đúng log; tab kiểm
chuyển kho render đúng (chưa có dữ liệu demo); tab phiếu duyệt mua hàng hiện đúng dòng thật
(`PI-2026-001`/`PO-1`, nút "Thay file").

## Vòng 3 (cùng ngày) — theo góp ý người dùng sau khi xem trang thật

Người dùng xem trang thật, góp ý 3 điểm: (1) tab "Phiếu Sếp duyệt mua hàng" chỉ có "Thay file", hỏi
sao không cho xóa luôn - "nếu sếp cần SKU đó xóa file đó thì sao? cứ để xóa vì admin chỉ khi nào có
sự cố mới vào thao tác"; (2) dòng hiển thị thiếu SKU - "hiện SKU và PI là được rồi"; (3) đặt tên 3
tab theo chức vụ thay vì mô tả loại file - "Ảnh lỗi KCS => KCS, Phiếu sếp duyệt mua hàng => Mua
hàng".

### 1. Cho phép xóa hẳn `approvalFileUrl` (đổi ý so với thiết kế ban đầu)

Rà lại `PurchaseProposalsService.receiveItem()` (BE) trước khi đổi: xác nhận hàm này KHÔNG hề đọc
`approvalFileUrl` - chỉ dựa vào `item.status` để cho nhận hàng. Nghĩa là field này thuần là bằng
chứng lịch sử/audit (không phải điều kiện chặn runtime nào) - xóa không phá luồng nghiệp vụ nào,
khác với suy đoán ban đầu đọc thẳng doc comment schema ("bằng chứng duy nhất"). Route đã gate ADMIN
+ tự ghi audit log (oldValue/newValue) nên mở khoá xóa là an toàn.

- `UpdateApprovalFileDto` (BE): bỏ `@IsNotEmpty`, đổi `approvalFileUrl` thành optional/nullable
  (giống `UpdateQcReviewPhotoDto`/`UpdateTransferCheckDefectPhotoDto`).
- `PurchaseProposalsService.updateApprovalFile()`: chuẩn hoá `dto.approvalFileUrl ?? null` (undefined
  từ body cũng coi là xóa, không phải "giữ nguyên" - khác Prisma default).
- Thêm 2 test: xóa hẳn (`null`) vẫn ghi audit + dọn Cloudinary; body không gửi field cũng coi là
  xóa. 997 test BE pass.
- FE: `AttachmentRow` thêm `onDelete`/`deleteLabel` cho tab Mua hàng ("Xóa file", confirm dialog
  riêng cảnh báo "đây là bằng chứng duyệt mua - chỉ xóa khi thật sự cần").

### 2. Bug thật phát hiện khi live-test: xóa/thay file ở tab Mua hàng không cập nhật UI ngay

BE ghi đúng (xác nhận qua `GET /purchase-proposals/3` thấy `approvalFileUrl: null` ngay sau khi
xóa), nhưng dòng vẫn hiện trên UI tới khi tải lại trang. Nguyên nhân: `AttachmentsPage.tsx` gọi
thẳng `services/purchasing-api.ts#updateProposalItemApprovalFile()` thay vì qua
`InspectionContext` - trong khi `proposals` (nguồn dữ liệu của tab) là state React sống trong
context đó, chỉ 2 action có sẵn (`bossApproveProposal`/`receiveProposalItem`) mới tự
`setProposals(...)` sau khi gọi BE.

**Đã sửa**: thêm action `updateApprovalFile` mới vào `InspectionContext.tsx` (cùng idiom 2 action
kia - gọi API rồi `setProposals(prev => prev.map(...))`), đổi `AttachmentsPage.tsx` dùng
`useInspection().updateApprovalFile` thay vì gọi thẳng service. Đã live-test lại: xóa xong dòng biến
mất NGAY LẬP TỨC, không cần tải lại trang.

### 3. Đổi tên 3 tab theo chức vụ + thêm SKU/PI vào dòng hiển thị

- `TABS` trong `AttachmentsPage.tsx`: "Ảnh lỗi KCS" → "KCS", "Ảnh lỗi kiểm chuyển kho" → "Kho",
  "Phiếu Sếp duyệt mua hàng" → "Mua hàng".
- Tab "Mua hàng": dòng hiển thị thêm `skuCode`/`skuName` (đã có sẵn trong `PurchaseProposal`, chỉ
  chưa dùng) cạnh `piCode` - vd "PI-2026-001 · E2E-BAN-01 — Bàn thử E2E · 3 cây".

**Kiểm tra**: BE 997 test pass, `tsc`/`eslint` sạch cả 2 phía. Live-test qua UI thật: tên tab đổi
đúng, dòng hiện đúng SKU+PI, xóa file thành công và dòng biến mất ngay (không cần F5) - đã tự khôi
phục lại dữ liệu demo (PATCH lại `approvalFileUrl` qua API) sau khi test xóa để không mất dữ liệu.

## Đã làm (vòng 3, cùng ngày) — mở quyền tự sửa cho người nhập, ngay tại màn làm việc

Theo lời Sếp Trương Văn Nhân ("cho người nhập được sửa luôn") - xem "Cập nhật lần 3" ở Bối cảnh.
Nguyên tắc: giữ nguyên trang Admin (vòng 2) làm lưới an toàn cuối, MỞ THÊM cho chính người đã tạo
bản ghi tự sửa/xóa ngay tại màn họ đang làm việc hàng ngày, không cần biết trang Admin tồn tại.

### 1. BE - nới cả 3 route từ "chỉ ADMIN" sang "người nhập HOẶC Admin/Sếp"

Xác nhận trước khi sửa: `KCS_STAFF` đã có `QC_REVIEW:UPDATE`, `WAREHOUSE_STAFF` đã có
`PRODUCTION_INVOICE:UPDATE`, `PURCHASER` đã có `PURCHASE_PROPOSAL:UPDATE` sẵn trong
`role-permissions.constant.ts` (cấp từ trước cho mục đích khác) - KHÔNG cần thêm quyền mới, chỉ cần
bỏ `@RequireRole(ADMIN)` ở cả 3 controller và chuyển check "actor có đúng người nhập hay Admin/Sếp
không" vào trong service (cần đọc dữ liệu record - decorator tĩnh không làm được).

- `QcReviewsService.updatePhoto()`: thêm tham số `actorUserId`/`actorRoles`, chặn nếu
  `existing.reviewedById !== actorUserId && !actorRoles.includes(ADMIN)` (`ForbiddenException`).
- `ProductionInvoicesService.updateTransferCheckDefectPhoto()`: cùng pattern, so
  `transferCheckResult.checkedById`.
- `PurchaseProposalsService.updateApprovalFile()`: cùng pattern, so `item.approvedById`, dùng lại
  `isPrivilegedActor()` sẵn có (BOSS hoặc ADMIN) thay vì tự viết check riêng.
- Test mới: người nhập tự sửa được, Admin sửa được bản ghi của người khác, người KHÁC (không phải
  người nhập, không phải Admin) bị chặn 403 - cho cả 3 service (+9 test). Đã live-test SỐNG qua API
  thật bằng JWT thật của tài khoản `kcs`/`muapsh` (không phải Admin) - cả 2 sửa được đúng bản ghi
  của chính mình.

### 2. FE - thêm nút sửa/xóa NGAY TẠI màn làm việc (không chỉ trang Admin)

- **Mua hàng** (`TheoDoiMuaHangPage.tsx`, `LichSuMuaHangPage.tsx`): cột "Phiếu duyệt" đổi từ link
  xem thuần sang component `ApprovalFileCell` (export từ `TheoDoiMuaHangPage.tsx`, dùng lại ở cả 2
  trang) - có "Đổi file"/"Xóa" ngay cạnh link "Xem file", gọi qua `useInspection().updateApprovalFile`.
- **KCS** (`KcsStagePage.tsx` → `kcsCore.tsx`): modal "Lịch sử" (đợt Hàn/Sơn/VTTP) vốn đã hiện ảnh
  lỗi qua `AuditLogTimeline` (vòng 1, mục B4) - nay thêm `EditPhotoActions` (component mới trong
  `AuditLogTimeline.tsx`, chỉ hiện khi entry có `qcReviewId`) cho "Đổi ảnh"/"Xóa ảnh" ngay trong
  timeline. Thread `onEditPhoto`/`onDeletePhoto` qua 4 lớp component (`KcsTwoTierScreen` →
  `KcsVatTuReviewBoard` → `KcsHistoryModal` → `AuditLogTimeline`), đều optional nên không ảnh hưởng
  caller khác của `AuditLogTimeline` (proposal/sku/user/masterdata...). Thêm field `qcReviewId?`
  vào `AuditLogEntry` (`types/admin.ts`).
- **Kho** (`KhoChuyenKiemPage.tsx`): trang này TRƯỚC ĐÂY không có UI xem lại từng lỗi cụ thể (chỉ
  hiện `defectCount` - 1 số đếm), nên đây là UI hoàn toàn mới: cột "Lỗi" đổi thành nút mở/đóng, mở
  ra `DefectListPanel` (component mới) liệt kê từng lỗi của mảnh (lọc `getTransferCheckDefects()`
  theo `productionInvoiceItemId` + `pieceId` qua `resolveProductionInvoiceRef()` - tránh lẫn dữ
  liệu PI khác cùng loại mảnh) kèm Đổi/Xóa ảnh.

**Kiểm tra**: BE 1003 test pass, `tsc`/`eslint` sạch cả 2 phía (FE + BE). Live-test qua UI thật:
- Mua hàng (`muapsh`): set file qua API, vào "Lịch sử đã mua" thấy đúng "Xem file/Đổi file/Xóa",
  bấm Xóa → dòng cập nhật ngay (đúng cả state-sync đã sửa ở vòng 2).
- KCS (`kcs`): gọi trực tiếp `PATCH /qc-reviews/1/photo` bằng JWT thật của `kcs` (không phải Admin)
  - 200 OK, xác nhận ownership-check hoạt động đúng cho non-Admin; đã phục hồi lại `photoUrl: null`
    sau test.
- Không live-test được UI "Lịch sử" KCS Hàn/Sơn qua click thật (PI hết việc chờ kiểm bị ẩn khỏi
  danh sách theo đúng thiết kế sẵn có `poHasWork`, không phải bug mới) - đã bù bằng test API thật +
  9 unit test service ở trên.
