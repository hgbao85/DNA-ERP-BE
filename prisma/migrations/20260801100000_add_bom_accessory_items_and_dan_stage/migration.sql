-- Việc 2: nối 4 trang Spec sang dùng Piece/SegmentSpec/BomRevision thật thay vì JSON tự do
-- trên plan_forms.manhData/detailQuota. Viết tay theo đúng convention Prisma sinh ra (đối
-- chiếu 20260730000000_add_phase2_master_data_and_bom/migration.sql) vì DATABASE_URL trỏ
-- tới Prisma Postgres pooled dùng chung — không chạy `prisma migrate dev` trực tiếp lên đó
-- mà không xác nhận trước với team. Stack trên 20260731160000, không amend (dù chưa apply)
-- — đúng convention repo đã thấy ở 20260730120000_add_deletedat_to_phase2_softdelete_models.
--
-- Nội dung:
--  1. Thêm giá trị DAN vào enum MfgStage — Dây/Đinh dùng ở công đoạn xuất đan (gộp cùng
--     khung chưa đan tại kho vật tư thành phẩm), không phải Hàn/Phôi.
--  2. Bảng bom_accessory_items mới — Phụ kiện/Bao bì tiêu hao theo revision, không gắn công
--     đoạn (khác consumable_bom), phân biệt Phụ kiện vs Bao bì qua material.kind
--     (ACCESSORY/PACKAGING).
--  3. UNIQUE trên bom_revision.sourcePlanFormId — 1 PlanForm chỉ sở hữu đúng 1 BomRevision,
--     chặn race condition tạo trùng khi ghi định mức lần đầu (xem
--     PlanFormsService.resolveDraftBomRevision).

-- AlterEnum
ALTER TYPE "MfgStage" ADD VALUE 'DAN';

-- CreateTable
CREATE TABLE "bom_accessory_items" (
    "id" BIGSERIAL NOT NULL,
    "bomRevisionId" BIGINT NOT NULL,
    "materialId" BIGINT NOT NULL,
    "qtyPerUnit" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "bom_accessory_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bom_accessory_items_bomRevisionId_materialId_key" ON "bom_accessory_items"("bomRevisionId", "materialId");

-- AddForeignKey
ALTER TABLE "bom_accessory_items" ADD CONSTRAINT "bom_accessory_items_bomRevisionId_fkey" FOREIGN KEY ("bomRevisionId") REFERENCES "bom_revision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_accessory_items" ADD CONSTRAINT "bom_accessory_items_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "bom_revision_sourcePlanFormId_key" ON "bom_revision"("sourcePlanFormId");
