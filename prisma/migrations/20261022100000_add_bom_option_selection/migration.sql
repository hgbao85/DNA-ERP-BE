-- Chọn loại dây (mã SHT) / loại nệm theo từng dòng đơn hàng.
--
-- 1 SKU dùng được nhiều loại dây/nệm; số lượng dây trên mỗi mảnh khác nhau theo loại dây. Người
-- nhập định mức tick các loại được phép (bom_option), Sales chọn 1 loại dây + 1 loại nệm cho
-- từng dòng đơn (sales_order_items), lựa chọn đi theo production_invoice_items rồi được chốt vào
-- production_orders. Mua hàng / Xuất đan chỉ tính dòng định mức của loại đã chọn.
--
-- Chỉ THÊM (bảng mới + cột nullable + index/FK) - không đổi/xoá dữ liệu cũ; đơn cũ giữ NULL và
-- chạy như trước. Phần sinh bởi `prisma migrate diff`, phần trigger/backfill viết tay bên dưới.

-- CreateEnum
CREATE TYPE "BomOptionKind" AS ENUM ('WIRE', 'CUSHION');

-- AlterTable
ALTER TABLE "production_invoice_items" ADD COLUMN     "cushionMaterialId" BIGINT,
ADD COLUMN     "salesOrderItemId" BIGINT,
ADD COLUMN     "wireMaterialId" BIGINT;

-- AlterTable
ALTER TABLE "production_orders" ADD COLUMN     "cushionMaterialId" BIGINT,
ADD COLUMN     "wireMaterialId" BIGINT;

-- AlterTable
ALTER TABLE "sales_order_items" ADD COLUMN     "cushionMaterialId" BIGINT,
ADD COLUMN     "wireMaterialId" BIGINT;

-- CreateTable
CREATE TABLE "bom_option" (
    "id" BIGSERIAL NOT NULL,
    "bomRevisionId" BIGINT NOT NULL,
    "kind" "BomOptionKind" NOT NULL,
    "materialId" BIGINT NOT NULL,

    CONSTRAINT "bom_option_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bom_option_materialId_idx" ON "bom_option"("materialId");

-- CreateIndex
CREATE UNIQUE INDEX "bom_option_bomRevisionId_kind_materialId_key" ON "bom_option"("bomRevisionId", "kind", "materialId");

-- CreateIndex
CREATE INDEX "production_invoice_items_salesOrderItemId_idx" ON "production_invoice_items"("salesOrderItemId");

-- AddForeignKey
ALTER TABLE "bom_option" ADD CONSTRAINT "bom_option_bomRevisionId_fkey" FOREIGN KEY ("bomRevisionId") REFERENCES "bom_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_option" ADD CONSTRAINT "bom_option_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_wireMaterialId_fkey" FOREIGN KEY ("wireMaterialId") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_cushionMaterialId_fkey" FOREIGN KEY ("cushionMaterialId") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_invoice_items" ADD CONSTRAINT "production_invoice_items_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "sales_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_invoice_items" ADD CONSTRAINT "production_invoice_items_wireMaterialId_fkey" FOREIGN KEY ("wireMaterialId") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_invoice_items" ADD CONSTRAINT "production_invoice_items_cushionMaterialId_fkey" FOREIGN KEY ("cushionMaterialId") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_wireMaterialId_fkey" FOREIGN KEY ("wireMaterialId") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_cushionMaterialId_fkey" FOREIGN KEY ("cushionMaterialId") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- bom_option là dòng con của bom_revision như 8 bảng ở 20260921030000_bom_line_items_immutable_
-- when_published: chỉ DRAFT mới sửa được, nếu không ai đó đổi danh sách tick sau khi đã duyệt mà
-- lệnh sản xuất đang chạy vẫn ghim đúng revision đó. Dùng lại hàm assert_bom_revision_draft().
DROP TRIGGER IF EXISTS bom_revision_draft_guard ON bom_option;
CREATE TRIGGER bom_revision_draft_guard
  BEFORE INSERT OR UPDATE OR DELETE ON bom_option
  FOR EACH ROW EXECUTE FUNCTION assert_bom_revision_draft();

-- Backfill production_invoice_items.salesOrderItemId: chỉ gán khi dòng đơn hàng KHỚP DUY NHẤT
-- theo (salesOrderId, mfgProductId). Đơn cũ có >=2 dòng cùng SKU thì nhập nhằng - để NULL (đúng
-- hành vi cũ), không đoán.
UPDATE production_invoice_items pii
SET "salesOrderItemId" = m.item_id
FROM (
  SELECT "salesOrderId" AS so_id, "mfgProductId" AS mp_id, MIN(id) AS item_id
  FROM sales_order_items
  GROUP BY "salesOrderId", "mfgProductId"
  HAVING COUNT(*) = 1
) m
WHERE pii."salesOrderItemId" IS NULL
  AND pii."salesOrderId" = m.so_id
  AND pii."mfgProductId" = m.mp_id;
