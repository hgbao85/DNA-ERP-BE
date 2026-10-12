# Changelog 12/10/2026 — Hạn giao bắt buộc khi tạo đơn hàng

Phần BE của phiên làm việc 12/10/2026. Bản đầy đủ (gồm các thay đổi FE cùng phiên) nằm ở
`D:\DNA-ERP\docs\changelog-2026-10-12-huong-dan-tach-vai-tro-kho-theo-lenh-han-giao-bat-buoc.html`.

## Thay đổi

`CreateSalesOrderItemDto.deliveryDate` (`src/modules/sales-orders/dto/create-sales-order-item.dto.ts`)
đổi từ tuỳ chọn sang **bắt buộc**. `POST /sales-orders` thiếu hạn giao ở bất kỳ dòng nào trả 400:

```
items.0.Hạn giao của từng dòng SKU là bắt buộc
```

## Vì sao

Hạn giao của dòng đơn (`SalesOrderItem.deliveryDate`) được chép xuống
`ProductionInvoiceItem.deliveryDeadline` (xem `SalesOrdersService`) rồi tới lệnh sản xuất. Bỏ trống
thì lệnh sinh ra không có hạn, mọi màn kho và sản xuất hiện "—". Chủ dự án yêu cầu bắt buộc nhập:
mỗi đơn dùng cùng một sản phẩm phải có hạn riêng — hạn đi theo đơn, không theo sản phẩm.

## Ảnh hưởng

- Mọi nơi tạo đơn hàng (test, seed, script, client khác) phải truyền `deliveryDate` cho từng item.
- Đã cập nhật 6 chỗ trong `sales-orders.service.spec.ts`. 36/36 test của module qua.
- `UpdateSalesOrderItemDto.deliveryDate` vẫn tuỳ chọn (sửa dòng không bắt buộc gửi lại hạn).
- Đơn tạo trước ngày này có thể không có hạn giao; FE hiện "—" cho các đơn đó. Trên DB dev:
  `GHE-FULL-DEMO-07-WASTE-TEST`, `PO-HD-2026-01`.

## Liên quan, chưa làm

- `SkuResponseDto.salesOrderDeliveryDate` không còn màn FE nào đọc (FE lấy hạn từ lệnh sản xuất).
  Có thể gỡ.
- `GET /production-orders` chặn `limit` tối đa 100; các màn kho của FE lấy danh sách lệnh qua
  endpoint này nên chỉ thấy 100 lệnh gần nhất. Cần lọc theo trạng thái hoặc phân trang khi số lệnh
  vượt 100.
- Type-check còn 2 lỗi có từ trước ở `prisma/seed-ghe-j55-full-bom.ts` và
  `prisma/seed-real-products.ts` (tra `MfgProduct` theo `factoryCode`, vốn không còn là duy nhất).
