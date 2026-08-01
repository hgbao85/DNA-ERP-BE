-- Sales Order + Production Order — dịch ngược từ mock FE (SalesPO + PlanForm +
-- ProductionInvoice). Hợp nhất 2 khái niệm "PO" trùng lặp trong mock (salesPOs của Sales
-- module và exportOrders của Mfg module, chỉ khớp nhau qua so sánh chuỗi poNumber/code,
-- không FK thật) thành 1 bảng sales_orders duy nhất. Viết tay theo đúng convention Prisma
-- sinh ra (đối chiếu 20260730000000_add_phase2_master_data_and_bom/migration.sql) vì
-- DATABASE_URL trỏ tới Prisma Postgres pooled dùng chung — không chạy `prisma migrate dev`
-- trực tiếp lên đó mà không xác nhận trước với team.
--
-- Phạm vi: chỉ 2 state machine "thật" được mock enforce role ở tầng service
-- (assertBossRole/assertProdMgrRole) — duyệt định mức SKU (PlanForm) và duyệt sản xuất
-- theo từng SKU trong lệnh sản xuất (ProductionInvoiceItem). Không gồm thực thi
-- Phôi/Hàn/Sơn/KCS, phân bổ đan, đề xuất mua hàng, chuyển kho, đóng gói — domain riêng,
-- để dành phase sau theo docs/CONTRIBUTING.md "0. Ưu tiên".

-- CreateEnum
CREATE TYPE "SalesOrderItemStatus" AS ENUM ('LEN_KE_HOACH', 'MUA_HANG', 'KHUNG_CO_KHI', 'DAN', 'CHUYEN_KIEM', 'DONG_GOI', 'HOAN_THANH');

-- CreateEnum
CREATE TYPE "PlanFormStatus" AS ENUM ('WAITING_PARTS', 'APPROVED_PARTS', 'WAITING_DETAIL', 'APPROVED_DETAIL', 'WAITING_QLSX_APPROVAL', 'WAITING_BOSS_APPROVAL', 'APPROVED');

-- CreateEnum
CREATE TYPE "ManhGroup" AS ENUM ('SAT', 'DAY', 'DINH');

-- CreateEnum
CREATE TYPE "DetailGroup" AS ENUM ('DAY_SON', 'VAT_TU_PHU_KIEN', 'BAO_BI_DONG_GOI');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProductionInvoiceStatus" AS ENUM ('PLANNING', 'PRODUCING', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProdApprovalStatus" AS ENUM ('WAITING_QLSX', 'WAITING_BOSS', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" BIGSERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "customerId" BIGINT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "deliveryDate" TIMESTAMP(3),
    "depositAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "depositConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "attachmentName" TEXT,
    "attachmentUrl" TEXT,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_items" (
    "id" BIGSERIAL NOT NULL,
    "salesOrderId" BIGINT NOT NULL,
    "mfgProductId" BIGINT NOT NULL,
    "skuName" TEXT,
    "totalQty" INTEGER NOT NULL,
    "shippedQty" INTEGER NOT NULL DEFAULT 0,
    "status" "SalesOrderItemStatus" NOT NULL DEFAULT 'LEN_KE_HOACH',
    "deliveryDate" TIMESTAMP(3),

    CONSTRAINT "sales_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_forms" (
    "id" BIGSERIAL NOT NULL,
    "salesOrderId" BIGINT NOT NULL,
    "mfgProductId" BIGINT NOT NULL,
    "productionInvoiceId" BIGINT,
    "status" "PlanFormStatus" NOT NULL DEFAULT 'WAITING_PARTS',
    "note" TEXT,
    "origin" TEXT,
    "manhData" JSONB,
    "detailQuota" JSONB,
    "qlsxReviewedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_form_manh_reviews" (
    "id" BIGSERIAL NOT NULL,
    "planFormId" BIGINT NOT NULL,
    "group" "ManhGroup" NOT NULL,
    "status" "ReviewDecision",
    "reason" TEXT,
    "enteredBy" TEXT,
    "enteredAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "plan_form_manh_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_form_detail_reviews" (
    "id" BIGSERIAL NOT NULL,
    "planFormId" BIGINT NOT NULL,
    "group" "DetailGroup" NOT NULL,
    "status" "ReviewDecision",
    "reason" TEXT,
    "enteredBy" TEXT,
    "enteredAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "plan_form_detail_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_invoices" (
    "id" BIGSERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "salesOrderId" BIGINT,
    "status" "ProductionInvoiceStatus" NOT NULL DEFAULT 'PLANNING',
    "deadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_invoice_items" (
    "id" BIGSERIAL NOT NULL,
    "productionInvoiceId" BIGINT NOT NULL,
    "mfgProductId" BIGINT NOT NULL,
    "productVariantId" BIGINT,
    "quantity" INTEGER NOT NULL,
    "materialDeadline" TIMESTAMP(3),
    "deliveryDeadline" TIMESTAMP(3),
    "prodApprovalStatus" "ProdApprovalStatus",
    "requestedAt" TIMESTAMP(3),
    "requestedById" TEXT,
    "warehouseCode" TEXT,
    "warehouseName" TEXT,
    "qlsxAt" TIMESTAMP(3),
    "qlsxById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "rejectReason" TEXT,

    CONSTRAINT "production_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_code_key" ON "sales_orders"("code");

-- CreateIndex
CREATE INDEX "sales_orders_customerId_idx" ON "sales_orders"("customerId");

-- CreateIndex
CREATE INDEX "sales_orders_deletedAt_idx" ON "sales_orders"("deletedAt");

-- CreateIndex
CREATE INDEX "sales_order_items_salesOrderId_idx" ON "sales_order_items"("salesOrderId");

-- CreateIndex
CREATE INDEX "sales_order_items_mfgProductId_idx" ON "sales_order_items"("mfgProductId");

-- CreateIndex
CREATE INDEX "plan_forms_salesOrderId_idx" ON "plan_forms"("salesOrderId");

-- CreateIndex
CREATE INDEX "plan_forms_mfgProductId_idx" ON "plan_forms"("mfgProductId");

-- CreateIndex
CREATE INDEX "plan_forms_productionInvoiceId_idx" ON "plan_forms"("productionInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "plan_form_manh_reviews_planFormId_group_key" ON "plan_form_manh_reviews"("planFormId", "group");

-- CreateIndex
CREATE UNIQUE INDEX "plan_form_detail_reviews_planFormId_group_key" ON "plan_form_detail_reviews"("planFormId", "group");

-- CreateIndex
CREATE UNIQUE INDEX "production_invoices_code_key" ON "production_invoices"("code");

-- CreateIndex
CREATE INDEX "production_invoices_salesOrderId_idx" ON "production_invoices"("salesOrderId");

-- CreateIndex
CREATE INDEX "production_invoice_items_productionInvoiceId_idx" ON "production_invoice_items"("productionInvoiceId");

-- CreateIndex
CREATE INDEX "production_invoice_items_mfgProductId_idx" ON "production_invoice_items"("mfgProductId");

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "sales_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_mfgProductId_fkey" FOREIGN KEY ("mfgProductId") REFERENCES "mfg_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_forms" ADD CONSTRAINT "plan_forms_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_forms" ADD CONSTRAINT "plan_forms_mfgProductId_fkey" FOREIGN KEY ("mfgProductId") REFERENCES "mfg_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_forms" ADD CONSTRAINT "plan_forms_productionInvoiceId_fkey" FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_forms" ADD CONSTRAINT "plan_forms_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_form_manh_reviews" ADD CONSTRAINT "plan_form_manh_reviews_planFormId_fkey" FOREIGN KEY ("planFormId") REFERENCES "plan_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_form_detail_reviews" ADD CONSTRAINT "plan_form_detail_reviews_planFormId_fkey" FOREIGN KEY ("planFormId") REFERENCES "plan_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_invoices" ADD CONSTRAINT "production_invoices_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_invoice_items" ADD CONSTRAINT "production_invoice_items_productionInvoiceId_fkey" FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_invoice_items" ADD CONSTRAINT "production_invoice_items_mfgProductId_fkey" FOREIGN KEY ("mfgProductId") REFERENCES "mfg_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_invoice_items" ADD CONSTRAINT "production_invoice_items_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_invoice_items" ADD CONSTRAINT "production_invoice_items_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_invoice_items" ADD CONSTRAINT "production_invoice_items_qlsxById_fkey" FOREIGN KEY ("qlsxById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_invoice_items" ADD CONSTRAINT "production_invoice_items_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Cột sourcePlanFormId trên bom_revision đã tồn tại từ migration Phase 2 (chỉ để trace, chưa
-- có FK vì plan_forms chưa dựng). Bảng plan_forms nay đã có — thêm FK thật.
-- AddForeignKey
ALTER TABLE "bom_revision" ADD CONSTRAINT "bom_revision_sourcePlanFormId_fkey" FOREIGN KEY ("sourcePlanFormId") REFERENCES "plan_forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
