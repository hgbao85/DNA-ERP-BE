-- Phase 2 — Danh mục / Master Data + BOM Revision (20 bảng).
-- Nguồn: docs/dna-erp-db-schema.html mục 1.2. Viết tay theo đúng convention Prisma sinh ra
-- (đối chiếu prisma/migrations/20260723021436_init/migration.sql) vì DATABASE_URL trỏ tới
-- Prisma Postgres pooled dùng chung — không chạy `prisma migrate dev` trực tiếp lên đó mà
-- không xác nhận trước với team.

-- CreateEnum
CREATE TYPE "MaterialKind" AS ENUM ('STEEL_BAR', 'CONSUMABLE', 'PAINT', 'ACCESSORY', 'PACKAGING', 'OTHER');

-- CreateEnum
CREATE TYPE "MfgStage" AS ENUM ('PHOI', 'HAN', 'SON');

-- CreateEnum
CREATE TYPE "BomRevisionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateTable
CREATE TABLE "material_groups" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "material_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" BIGSERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "MaterialKind" NOT NULL DEFAULT 'OTHER',
    "unit" TEXT NOT NULL,
    "materialGroupId" BIGINT,
    "khoUnitFactor" DECIMAL(14,4),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_suppliers" (
    "id" BIGSERIAL NOT NULL,
    "materialId" BIGINT NOT NULL,
    "supplierId" BIGINT NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "leadTimeDays" INTEGER,

    CONSTRAINT "material_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "defect_reasons" (
    "id" BIGSERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "stageType" "MfgStage",

    CONSTRAINT "defect_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weaving_points" (
    "id" BIGSERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "fullName" TEXT,
    "aliasNote" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "dayDaiPercent" DECIMAL(5,2),
    "ketThucPercent" DECIMAL(5,2),
    "hangQuanPercent" DECIMAL(5,2),
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "weaving_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" BIGSERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isVirtual" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_customers" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "country" TEXT,
    "market" TEXT,
    "contactName" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfg_products" (
    "id" BIGSERIAL NOT NULL,
    "factoryCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "mfg_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" BIGSERIAL NOT NULL,
    "mfgProductId" BIGINT NOT NULL,
    "customerId" BIGINT,
    "colorCode" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "piece" (
    "id" BIGSERIAL NOT NULL,
    "mfgProductId" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "groupNumber" INTEGER NOT NULL,
    "pieceNumber" INTEGER,
    "name" TEXT NOT NULL,
    "isWoven" BOOLEAN NOT NULL DEFAULT false,
    "weavingPrice" DECIMAL(14,2),

    CONSTRAINT "piece_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part" (
    "id" BIGSERIAL NOT NULL,
    "mfgProductId" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "part_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segment_spec" (
    "id" BIGSERIAL NOT NULL,
    "materialId" BIGINT NOT NULL,
    "cutLengthMm" INTEGER NOT NULL,

    CONSTRAINT "segment_spec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_revision" (
    "id" BIGSERIAL NOT NULL,
    "mfgProductId" BIGINT NOT NULL,
    "revNo" INTEGER NOT NULL,
    "status" "BomRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "sourcePlanFormId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bom_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_piece" (
    "id" BIGSERIAL NOT NULL,
    "bomRevisionId" BIGINT NOT NULL,
    "pieceId" BIGINT NOT NULL,
    "qtyPerUnit" INTEGER NOT NULL,

    CONSTRAINT "bom_piece_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_part" (
    "id" BIGSERIAL NOT NULL,
    "bomRevisionId" BIGINT NOT NULL,
    "partId" BIGINT NOT NULL,
    "qtyPerUnit" INTEGER NOT NULL,

    CONSTRAINT "bom_part_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "piece_bom" (
    "id" BIGSERIAL NOT NULL,
    "bomRevisionId" BIGINT NOT NULL,
    "mfgProductId" BIGINT NOT NULL,
    "pieceId" BIGINT NOT NULL,
    "segmentSpecId" BIGINT NOT NULL,
    "qtyPerPiece" INTEGER NOT NULL,
    "needsHan" BOOLEAN NOT NULL DEFAULT false,
    "needsSon" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "piece_bom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_bom" (
    "id" BIGSERIAL NOT NULL,
    "bomRevisionId" BIGINT NOT NULL,
    "mfgProductId" BIGINT NOT NULL,
    "partId" BIGINT NOT NULL,
    "segmentSpecId" BIGINT NOT NULL,
    "qtyPerPart" INTEGER NOT NULL,

    CONSTRAINT "part_bom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumable_bom" (
    "id" BIGSERIAL NOT NULL,
    "bomRevisionId" BIGINT NOT NULL,
    "stage" "MfgStage" NOT NULL,
    "materialId" BIGINT NOT NULL,
    "qtyPerUnit" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "consumable_bom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packaging_bom" (
    "id" BIGSERIAL NOT NULL,
    "productVariantId" BIGINT NOT NULL,
    "itemName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "qtyPerSet" DECIMAL(14,4) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "packaging_bom_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "material_groups_name_key" ON "material_groups"("name");

-- CreateIndex
CREATE UNIQUE INDEX "materials_code_key" ON "materials"("code");

-- CreateIndex
CREATE INDEX "materials_materialGroupId_idx" ON "materials"("materialGroupId");

-- CreateIndex
CREATE INDEX "materials_kind_idx" ON "materials"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "material_suppliers_materialId_supplierId_key" ON "material_suppliers"("materialId", "supplierId");

-- CreateIndex
CREATE INDEX "defect_reasons_stageType_idx" ON "defect_reasons"("stageType");

-- CreateIndex
CREATE UNIQUE INDEX "weaving_points_code_key" ON "weaving_points"("code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

-- CreateIndex
CREATE UNIQUE INDEX "mfg_products_factoryCode_key" ON "mfg_products"("factoryCode");

-- CreateIndex
CREATE INDEX "product_variants_mfgProductId_idx" ON "product_variants"("mfgProductId");

-- CreateIndex
CREATE INDEX "product_variants_customerId_idx" ON "product_variants"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "piece_mfgProductId_code_key" ON "piece"("mfgProductId", "code");

-- CreateIndex
CREATE INDEX "piece_mfgProductId_idx" ON "piece"("mfgProductId");

-- CreateIndex
CREATE UNIQUE INDEX "part_mfgProductId_code_key" ON "part"("mfgProductId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "segment_spec_materialId_cutLengthMm_key" ON "segment_spec"("materialId", "cutLengthMm");

-- CreateIndex
CREATE UNIQUE INDEX "bom_revision_mfgProductId_revNo_key" ON "bom_revision"("mfgProductId", "revNo");

-- CreateIndex
CREATE UNIQUE INDEX "bom_revision_id_mfgProductId_key" ON "bom_revision"("id", "mfgProductId");

-- CreateIndex
CREATE UNIQUE INDEX "bom_piece_bomRevisionId_pieceId_key" ON "bom_piece"("bomRevisionId", "pieceId");

-- CreateIndex
CREATE UNIQUE INDEX "bom_part_bomRevisionId_partId_key" ON "bom_part"("bomRevisionId", "partId");

-- CreateIndex
CREATE UNIQUE INDEX "piece_bom_bomRevisionId_pieceId_segmentSpecId_key" ON "piece_bom"("bomRevisionId", "pieceId", "segmentSpecId");

-- CreateIndex
CREATE UNIQUE INDEX "part_bom_bomRevisionId_partId_segmentSpecId_key" ON "part_bom"("bomRevisionId", "partId", "segmentSpecId");

-- CreateIndex
CREATE UNIQUE INDEX "consumable_bom_bomRevisionId_stage_materialId_key" ON "consumable_bom"("bomRevisionId", "stage", "materialId");

-- CreateIndex
CREATE INDEX "packaging_bom_productVariantId_idx" ON "packaging_bom"("productVariantId");

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_materialGroupId_fkey" FOREIGN KEY ("materialGroupId") REFERENCES "material_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_suppliers" ADD CONSTRAINT "material_suppliers_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_suppliers" ADD CONSTRAINT "material_suppliers_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_mfgProductId_fkey" FOREIGN KEY ("mfgProductId") REFERENCES "mfg_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "sales_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece" ADD CONSTRAINT "piece_mfgProductId_fkey" FOREIGN KEY ("mfgProductId") REFERENCES "mfg_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part" ADD CONSTRAINT "part_mfgProductId_fkey" FOREIGN KEY ("mfgProductId") REFERENCES "mfg_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_spec" ADD CONSTRAINT "segment_spec_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_revision" ADD CONSTRAINT "bom_revision_mfgProductId_fkey" FOREIGN KEY ("mfgProductId") REFERENCES "mfg_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_piece" ADD CONSTRAINT "bom_piece_bomRevisionId_fkey" FOREIGN KEY ("bomRevisionId") REFERENCES "bom_revision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_piece" ADD CONSTRAINT "bom_piece_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "piece"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_part" ADD CONSTRAINT "bom_part_bomRevisionId_fkey" FOREIGN KEY ("bomRevisionId") REFERENCES "bom_revision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_part" ADD CONSTRAINT "bom_part_partId_fkey" FOREIGN KEY ("partId") REFERENCES "part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_bom" ADD CONSTRAINT "piece_bom_bomRevisionId_mfgProductId_fkey" FOREIGN KEY ("bomRevisionId", "mfgProductId") REFERENCES "bom_revision"("id", "mfgProductId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_bom" ADD CONSTRAINT "piece_bom_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "piece"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_bom" ADD CONSTRAINT "piece_bom_segmentSpecId_fkey" FOREIGN KEY ("segmentSpecId") REFERENCES "segment_spec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_bom" ADD CONSTRAINT "part_bom_bomRevisionId_mfgProductId_fkey" FOREIGN KEY ("bomRevisionId", "mfgProductId") REFERENCES "bom_revision"("id", "mfgProductId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_bom" ADD CONSTRAINT "part_bom_partId_fkey" FOREIGN KEY ("partId") REFERENCES "part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_bom" ADD CONSTRAINT "part_bom_segmentSpecId_fkey" FOREIGN KEY ("segmentSpecId") REFERENCES "segment_spec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumable_bom" ADD CONSTRAINT "consumable_bom_bomRevisionId_fkey" FOREIGN KEY ("bomRevisionId") REFERENCES "bom_revision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumable_bom" ADD CONSTRAINT "consumable_bom_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packaging_bom" ADD CONSTRAINT "packaging_bom_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Constraint không diễn tả được trong schema.prisma (partial unique index):
-- Đúng 1 bom_revision ACTIVE cho mỗi mfg_product tại một thời điểm — chặn ở tầng DB thay
-- vì chỉ dựa vào transaction lock ở service, đúng yêu cầu DoD Phase 2 "activate() đảm bảo
-- đúng 1 revision ACTIVE/mfgProductId dưới tải song song".
CREATE UNIQUE INDEX "bom_revision_one_active_per_product"
  ON "bom_revision" ("mfgProductId")
  WHERE "status" = 'ACTIVE';
