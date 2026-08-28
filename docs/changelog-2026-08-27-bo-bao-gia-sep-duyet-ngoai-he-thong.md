# 2026-08-27 — Bỏ báo giá nhiều NCC: Sếp duyệt ngoài hệ thống bằng file đã ký

## Bối cảnh

Luồng mua hàng cũ đi qua 6 chặng trong phần mềm: Mua hàng *Tiếp nhận* → nhập báo giá nhiều NCC →
*Gửi Giám đốc duyệt* → Sếp mở màn **So sánh giá**, chọn NCC cho từng vật tư → *Duyệt* → Kho nhận
hàng. Toàn bộ so sánh giá, chọn NCC và phê duyệt nằm trong hệ thống.

Sếp chốt bỏ hẳn cách này: thực tế đang chạy là nhân viên mua hàng tự làm **phiếu Excel so sánh
giá** (nhiều NCC, giá đã tính đủ phí vận chuyển/phí cẩu), in ra, Sếp **ký tay** lên giấy. Phần mềm
không cần biết giá — nó nằm trong file. Việc của phần mềm chỉ còn hai việc: cho Mua hàng biết cần
mua bao nhiêu, và lưu lại **bằng chứng Sếp đã duyệt** để Kho được phép nhận hàng.

Luồng rút từ `Mua hàng → Sếp → Kho` xuống `Mua hàng → Kho`:

```
NEW (chờ Sếp duyệt)
  │  Mua hàng đọc SL cần mua trên màn hình → tự làm Excel → xin chữ ký Sếp
  │  bấm [Sếp đã duyệt] → chọn file đã ký → [Xác nhận]
  ▼
PURCHASING (đang mua / chờ hàng về)   ← Kho thấy item ở đây, được nhận hàng
  ▼
PURCHASED (đã nhận đủ)
```

**Hệ quả cần nói rõ:** endpoint duyệt mới dùng quyền `PURCHASE_PROPOSAL:UPDATE` (nhân viên mua hàng
có), không phải `APPROVE` (chỉ Sếp có). Trong phần mềm, nhân viên mua hàng tự bấm duyệt — chốt chặn
thật chuyển hẳn sang chữ ký trên giấy + file lưu lại. Đây là hệ quả cố ý của việc bỏ bước duyệt
trong hệ thống (Sếp chốt), không phải sót phân quyền.

## Quyết định đã chốt với Sếp

| Câu hỏi | Chốt |
|---|---|
| Có lưu giá/NCC trong hệ thống không? | **Không.** Giá và NCC đều nằm trong file Excel đã ký. |
| Bỏ luôn màn "So sánh giá" của Sếp? | **Có** — xoá hẳn khỏi `BossApp`, không chỉ ẩn nút. |
| Bỏ luôn tab "Vật tư – NCC" của Mua hàng? | **Có** — NCC vẫn quản lý ở Admin › Nhà cung cấp. |
| Định dạng file được phép | Ảnh (JPEG/PNG/WEBP/GIF) + PDF + Excel (.xls/.xlsx), tối đa 10MB |
| Dữ liệu đang dở (36 item QUOTING/SUBMITTED) | Nút mới **nhận luôn** cả 2 trạng thái này — không reset, không cần backfill |

**Dữ liệu production lúc thiết kế** (2026-08-27): 39 NEW · 30 QUOTING ở 4 phiếu (0 báo giá đã nhập)
· 6 SUBMITTED ở 1 phiếu (có 6 báo giá chờ Sếp) · 25 PURCHASING. Chỉ 6 item có dữ liệu báo giá thật
đang treo; luồng mới hấp thụ hết, không mất gì.

---

## Backend

### Thêm mới

| File | Việc |
|---|---|
| `prisma/schema.prisma` | `PurchaseProposalItem.approvalFileUrl String?` — theo đúng idiom `Material.imageUrl` |
| `prisma/migrations/20260827040000_purchase_item_approval_file` | `ALTER TABLE ... ADD COLUMN "approvalFileUrl" TEXT` — nullable, không cần backfill |
| `uploads/cloudinary.service.ts` | `uploadBuffer(buffer, folder, resourceType: 'image' \| 'raw' = 'image')` — truyền `resource_type` vào Cloudinary, mặc định giữ hành vi cũ |
| `uploads/uploads.controller.ts` | `POST /uploads/document` — ảnh + PDF + Excel, 10MB, chọn `resourceType` theo mime. **Giữ nguyên `/uploads/image`** (4 màn khác đang dùng, contract chỉ-ảnh phải chặt) |
| `purchase-proposals/dto/boss-approve-purchase-proposal.dto.ts` | `approvalFileUrl!: string` |
| `purchase-proposals.service.ts` | `bossApprove(id, actorUserId, actorRoles, dto)` — xem đặc tả dưới |
| `purchase-proposals.controller.ts` | `POST :id/boss-approve`, quyền `UPDATE` |
| `dto/purchase-proposal-response.dto.ts` | Thêm `approvalFileUrl: string \| null` vào item response |

**Đặc tả `bossApprove()`** (dựng theo khuôn `acknowledge()` cũ, tái dùng `assertActorMayHandle()` +
`isPrivilegedActor()`):

1. Lọc item của actor (hoặc chưa gán ai; Boss/Admin lấy tất) có
   `status ∈ {NEW, QUOTING, SUBMITTED, REJECTED}` — **nhận cả 4 trạng thái có chủ đích**, đây là
   cách 36 item đang dở đi tiếp sau khi màn Sếp bị gỡ.
2. Trong transaction + khoá `purchase-proposal-mutate:<id>`: `updateMany` → `PURCHASING`, ghi
   `approvedAt`/`approvedById`/`approvalFileUrl`; `count` lệch → `ConflictException` (race guard).
3. `recomputeProposalStatus()` — rollup xử lý đúng bước nhảy NEW→PURCHASING, không cần sửa.
4. Ghi audit tay `auditProposalDecision()` (đổi tên từ `auditQuoteDecision`, `tableName` đổi sang
   `PurchaseProposalItem`) — **bắt buộc**: mọi chuyển trạng thái item dùng `updateMany`, mà
   `updateMany` không được extension audit tự ghi.

### Gỡ bỏ

`addQuote()`, `submit()`, `approve()`, `reject()`, `requote()`, `acknowledge()`,
`assertActorMayQuoteItem()` + 6 route tương ứng + 3 DTO (`ApprovePurchaseProposalDto`,
`RejectPurchaseProposalDto`, `CreateQuoteDto`). Xác nhận qua server thật: 5 route cũ đều trả
**404**.

### Giữ nguyên (đừng dọn nhầm)

- `recomputeProposalStatus` — 3 module ngoài gọi (`cutting-proposals.service.ts`,
  `piece-material-yield-purchase.service.ts`, `consumable-material-purchase.service.ts`).
- `receiveItem()` — nguyên vẹn, Kho nhận hàng + StockLedger + credit pool.
- Bảng `PurchaseProposalQuote` + 32 báo giá cũ + `ITEM_INCLUDE.quotes` — giữ để tra cứu lịch sử,
  không còn đường ghi.
- Enum `PurchaseProposalStatus` giữ đủ 6 giá trị — `QUOTING`/`SUBMITTED`/`REJECTED` là trạng thái
  chỉ-có-trong-dữ-liệu-cũ, không sinh mới. Xoá giá trị enum sẽ hỏng 36 dòng đang tồn tại.
- `/uploads/image`, module `Supplier`/`MaterialSupplier` (Admin › Nhà cung cấp vẫn dùng).

---

## Frontend

| File | Việc |
|---|---|
| `services/uploads-api.ts` | `uploadDocument()` — khuôn y hệt `uploadImage()` |
| `services/purchasing-api.ts` | Gỡ 6 hàm cũ + `postNewQuotes`; thêm `bossApproveProposal()`. `toProposal()` bỏ dựng `quotes`/`chosenSuppliers`, thêm `approvalFileUrl` |
| `context/InspectionContext.tsx` | Gỡ type `ProposalQuote` + 2 field trên `PurchaseProposal`; gỡ 6 action, thêm `bossApproveProposal`. Nhãn trạng thái đổi thành "Chờ Sếp duyệt" |
| `modules/pages/Purchasing/LenhMuaNCCPage.tsx` | Viết lại: gỡ `SupplierPicker` + toàn bộ UI báo giá; 1 danh sách `pendingItems` (loại trừ purchasing/purchased) + nút **"Sếp đã duyệt"** mở modal chọn file (ảnh/PDF/Excel, upload hoãn tới lúc Xác nhận) |
| `modules/pages/Purchasing/PurchasingApp.tsx` | Bỏ tab "Vật tư – NCC" |
| `modules/pages/Purchasing/VatTuNCCPage.tsx` | **Xoá file** |
| `modules/pages/Boss/BossApp.tsx` | Xoá `SoSanhGiaSection` (~500 dòng) + nav con "So sánh giá". File co từ 688 → 139 dòng |
| `modules/pages/Purchasing/TheoDoiMuaHangPage.tsx`, `LichSuMuaHangPage.tsx` | Bỏ cột NCC/Đơn giá/(NCC hẹn giao \| Thành tiền), thêm cột **"Phiếu duyệt"** (link file) |
| `modules/pages/Manufacturing/ThongKePagePlan.tsx` | Bỏ đọc `chosenSuppliers`/`quotes`, bỏ cột NCC/Đơn giá |
| `modules/pages/Manufacturing/NhapKhoPage.tsx` | Thêm link "Xem file Sếp duyệt" cạnh pill trạng thái |

**Modal "Sếp đã duyệt":** `<input type="file" accept="image/*,application/pdf,.pdf,.xls,.xlsx">` +
preview (ảnh: thumbnail; PDF/Excel: tên file). Upload **hoãn tới lúc bấm Xác nhận** (đúng idiom
`AdminEntityPage.tsx`) — tránh file rác trên Cloudinary khi người dùng đóng modal.

---

## Test

**BE**: gỡ ~36 test cũ (`addQuote`/`submit`/`approve`/`reject-requote`/`acknowledge`), thêm
`describe('bossApprove')` — 8 test (happy path, nhận cả 3 trạng thái luồng cũ, không đụng
purchasing/purchased, phân quyền theo buyer, Boss duyệt hộ, thiếu item, race, audit). Sửa
`cloudinary.service.spec.ts` theo chữ ký mới + thêm test `resource_type: 'raw'`.

**FE**: gỡ 4 describe cũ trong `purchasing-api.test.ts`, thêm `describe('bossApproveProposal')`.

**E2E**: `e2e/golden-path.spec.ts` — gỡ 4 step cũ (fixture NCC, báo giá + gửi Sếp, chờ SUBMITTED,
Boss duyệt), thay bằng 1 step "Sếp đã duyệt" dùng file fixture tĩnh
`e2e/fixtures/phieu-da-ky.png` (`page.setInputFiles`).

**Kết quả**:
- BE: `tsc --noEmit` sạch · `eslint` sạch trên file đã đụng · **46 suite / 726 test pass**.
- FE: `tsc --noEmit` sạch · `eslint` sạch · **5 file / 33 test pass** (vitest) · `npm run build` (Next.js) thành công.
- E2E: `npx playwright test golden-path` — **fail ở bước đầu tiên "Sales tạo PO mới"**, KHÔNG liên
  quan tới đợt sửa này. Nguyên nhân: DB dev hiện chỉ có 2 khách hàng (`Test Customer E2E`,
  `Nội Thất Gia Phát`), thiếu khách hàng fixture `MEIJING` mà bước này cần - `git log` xác nhận
  dòng `customerInput.fill('MEIJING')` chưa từng bị đụng tới trong đợt sửa hôm nay. Đây là lỗ hổng
  dữ liệu môi trường có sẵn từ trước (thiếu bước seed khách hàng fixture), chặn test chạy tới đúng
  đoạn "Sếp đã duyệt" mà tôi vừa viết lại - **chưa xác nhận được bằng con đường e2e tự động**.
  Đã bù bằng live-test thủ công qua chrome-devtools MCP (xem dưới) chạy đúng luồng UI thật.

**Live-test qua chrome-devtools MCP** (BE + FE + Docker postgres thật, không mock):
- `muapsh` (Mua hàng) → "Lệnh mua vật tư" hiện đúng cột Kho/Vật tư/Tồn thực/Cần mua/ĐVT, không còn
  tab "Vật tư – NCC". Bấm "Sếp đã duyệt" → modal → upload 1 PNG thật → Cloudinary trả URL thật
  (`https://res.cloudinary.com/.../dna-erp/approvals/...png`, xác nhận `curl` 200, `Content-Type:
  image/png`) → item biến khỏi danh sách chờ, chuyển "Đang mua hàng".
- "Theo dõi mua hàng" → không còn cột NCC/Đơn giá, có cột "Phiếu duyệt" đúng link.
- `testkhosteel` (thủ kho Phôi Sơn Hàn) → "Nhập kho" thấy đúng item, link "Xem file Sếp duyệt" ở
  header chi tiết, xác nhận nhận hàng chạy đúng (207/207 cây → "✓ Đã nhận đủ").
- Gọi thẳng 5 route đã gỡ (`acknowledge`/`submit`/`approve`/`reject`/`requote`) → **404** cả 5.
- BE log suốt phiên test: 0 lỗi.

## Rủi ro đã biết

- **File rác trên Cloudinary** nếu `bossApprove` lỗi *sau khi* upload xong (vd `ConflictException`
  do người khác vừa duyệt) — hiếm, chấp nhận được (upload hoãn đã loại ca phổ biến hơn: chọn file
  rồi đóng modal).
- **`deleteByUrl` không xoá được file `raw`** (regex cắt mất phần mở rộng, `destroy()` không truyền
  `resource_type`) — cố ý không sửa đợt này vì file duyệt không có đường xoá/thay, ghi lại cho lần
  sau ai cần vá.
- `QUOTING`/`SUBMITTED`/`REJECTED` từ nay là trạng thái chỉ-có-trong-dữ-liệu-cũ — giữ nguyên trong
  enum, đừng dọn.
