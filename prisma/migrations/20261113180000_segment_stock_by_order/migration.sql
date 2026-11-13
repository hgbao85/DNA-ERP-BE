-- Tồn đoạn kho Phôi theo MÃ ĐOẠN và giữ đoạn theo LỆNH (13/11/2026, anh Nhân trả lời 11 câu tồn đoạn).
--
-- 1. Chiều mới "segmentSteps" (bộ công đoạn phụ của đoạn, '' = trơn) trên sổ kho + số dư. Mã đoạn = (cỡ đoạn, bộ công đoạn):
--    "460 mm trơn" và "460 mm có Dập" là 2 dòng tồn riêng. Mọi dòng hiện có nhận '' (trơn) nên số liệu cũ KHÔNG đổi.
-- 2. Bảng giữ đoạn theo lệnh (segment_reservations) + nhật ký (segment_reservation_logs): đoạn đủ công đoạn + KCS đạt của lệnh
--    nào giữ cho lệnh đó; tồn trừ phần còn giữ của mọi lệnh = cột "dư" của kho xưởng, chia cho lệnh sau.
-- 3. Bảng phía cộng đã ghi (segment_productions): mỗi lần tính lại chỉ ghi phần chênh vào sổ kho, không cộng đôi.
-- 4. Loại bút toán mới SEGMENT_PRODUCE (kho ảo PRODUCTION -> kho Phôi; tính lại giảm thì chiều ngược lại).
--
-- Chỉ mở rộng, không xoá dữ liệu. Phía cộng chỉ ghi sổ khi bật SEGMENT_STOCK_ENABLED (mặc định tắt) - deploy migration này
-- không đổi số tồn nào trên production.
-- LƯU Ý (bài học 2026-09-04): đổi unique index của stock_quant mà quên cập nhật trigger sẽ làm hỏng MỌI luồng ghi sổ kho
-- (lỗi 42P10) - nên index và hàm trigger được đổi CÙNG migration này.
-- Danh sách công đoạn trong các CHECK = PROCESS_STEPS bỏ CAT (src/common/constants/process-steps.constant.ts). Thêm công đoạn
-- mới thì sửa cả CHECK (test segment-code.util.spec.ts đối chiếu hai nơi).

-- AlterEnum
ALTER TYPE "StockLedgerRefType" ADD VALUE 'SEGMENT_PRODUCE';

-- CreateEnum
CREATE TYPE "SegmentReservationLogKind" AS ENUM ('PRODUCE', 'SURPLUS_IN', 'CONSUME', 'RELEASE', 'TRANSFER', 'ADJUST');

-- stock_ledger: mã đoạn có bộ công đoạn
ALTER TABLE "stock_ledger" ADD COLUMN "segmentSteps" TEXT NOT NULL DEFAULT '';
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_segment_steps_chk"
  CHECK ("segmentSteps" = '' OR ("segmentSpecId" IS NOT NULL AND "segmentSteps" ~ '^(UON|DAP|DUC_LO|TAN|TOP_DAU|XE|NHAN)(,(UON|DAP|DUC_LO|TAN|TOP_DAU|XE|NHAN))*$'));
CREATE INDEX "stock_ledger_toWarehouseId_segmentSpecId_segmentSteps_idx"
  ON "stock_ledger" ("toWarehouseId", "segmentSpecId", "segmentSteps");

-- stock_quant: unique theo (kho, cỡ đoạn, bộ công đoạn)
ALTER TABLE "stock_quant" ADD COLUMN "segmentSteps" TEXT NOT NULL DEFAULT '';
ALTER TABLE "stock_quant" ADD CONSTRAINT "stock_quant_segment_steps_chk"
  CHECK ("segmentSteps" = '' OR ("segmentSpecId" IS NOT NULL AND "segmentSteps" ~ '^(UON|DAP|DUC_LO|TAN|TOP_DAU|XE|NHAN)(,(UON|DAP|DUC_LO|TAN|TOP_DAU|XE|NHAN))*$'));
DROP INDEX "stock_quant_warehouseId_segmentSpecId_key";
CREATE UNIQUE INDEX "stock_quant_wh_seg_steps_key"
  ON "stock_quant" ("warehouseId", "segmentSpecId", "segmentSteps") WHERE ("segmentSpecId" IS NOT NULL);

-- Trigger đồng bộ tồn: nhánh segmentSpecId đưa segmentSteps vào cả INSERT lẫn ON CONFLICT (3 nhánh còn lại không đổi, chép
-- nguyên từ 20261023120000_stock_spec_dimension).
CREATE OR REPLACE FUNCTION public.fn_sync_stock_quant()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."materialId" IS NOT NULL THEN
    INSERT INTO "stock_quant" ("warehouseId", "materialId", "stockLengthMm", "spec", "qty", "updatedAt")
      VALUES (NEW."toWarehouseId", NEW."materialId", NEW."stockLengthMm", NEW."spec", NEW."qty", now())
      ON CONFLICT ("warehouseId", "materialId", "stockLengthMm", "spec") WHERE "materialId" IS NOT NULL
      DO UPDATE SET "qty" = "stock_quant"."qty" + NEW."qty", "updatedAt" = now();
    INSERT INTO "stock_quant" ("warehouseId", "materialId", "stockLengthMm", "spec", "qty", "updatedAt")
      VALUES (NEW."fromWarehouseId", NEW."materialId", NEW."stockLengthMm", NEW."spec", -NEW."qty", now())
      ON CONFLICT ("warehouseId", "materialId", "stockLengthMm", "spec") WHERE "materialId" IS NOT NULL
      DO UPDATE SET "qty" = "stock_quant"."qty" - NEW."qty", "updatedAt" = now();

  ELSIF NEW."segmentSpecId" IS NOT NULL THEN
    INSERT INTO "stock_quant" ("warehouseId", "segmentSpecId", "segmentSteps", "qty", "updatedAt")
      VALUES (NEW."toWarehouseId", NEW."segmentSpecId", NEW."segmentSteps", NEW."qty", now())
      ON CONFLICT ("warehouseId", "segmentSpecId", "segmentSteps") WHERE "segmentSpecId" IS NOT NULL
      DO UPDATE SET "qty" = "stock_quant"."qty" + NEW."qty", "updatedAt" = now();
    INSERT INTO "stock_quant" ("warehouseId", "segmentSpecId", "segmentSteps", "qty", "updatedAt")
      VALUES (NEW."fromWarehouseId", NEW."segmentSpecId", NEW."segmentSteps", -NEW."qty", now())
      ON CONFLICT ("warehouseId", "segmentSpecId", "segmentSteps") WHERE "segmentSpecId" IS NOT NULL
      DO UPDATE SET "qty" = "stock_quant"."qty" - NEW."qty", "updatedAt" = now();

  ELSIF NEW."pieceId" IS NOT NULL THEN
    INSERT INTO "stock_quant" ("warehouseId", "pieceId", "qty", "updatedAt")
      VALUES (NEW."toWarehouseId", NEW."pieceId", NEW."qty", now())
      ON CONFLICT ("warehouseId", "pieceId") WHERE "pieceId" IS NOT NULL
      DO UPDATE SET "qty" = "stock_quant"."qty" + NEW."qty", "updatedAt" = now();
    INSERT INTO "stock_quant" ("warehouseId", "pieceId", "qty", "updatedAt")
      VALUES (NEW."fromWarehouseId", NEW."pieceId", -NEW."qty", now())
      ON CONFLICT ("warehouseId", "pieceId") WHERE "pieceId" IS NOT NULL
      DO UPDATE SET "qty" = "stock_quant"."qty" - NEW."qty", "updatedAt" = now();

  ELSIF NEW."productVariantId" IS NOT NULL THEN
    INSERT INTO "stock_quant" ("warehouseId", "productVariantId", "qty", "updatedAt")
      VALUES (NEW."toWarehouseId", NEW."productVariantId", NEW."qty", now())
      ON CONFLICT ("warehouseId", "productVariantId") WHERE "productVariantId" IS NOT NULL
      DO UPDATE SET "qty" = "stock_quant"."qty" + NEW."qty", "updatedAt" = now();
    INSERT INTO "stock_quant" ("warehouseId", "productVariantId", "qty", "updatedAt")
      VALUES (NEW."fromWarehouseId", NEW."productVariantId", -NEW."qty", now())
      ON CONFLICT ("warehouseId", "productVariantId") WHERE "productVariantId" IS NOT NULL
      DO UPDATE SET "qty" = "stock_quant"."qty" - NEW."qty", "updatedAt" = now();
  END IF;

  RETURN NEW;
END;
$function$;

-- Giữ đoạn theo lệnh
CREATE TABLE "segment_reservations" (
    "id" BIGSERIAL NOT NULL,
    "warehouseId" BIGINT NOT NULL,
    "productionInvoiceId" BIGINT NOT NULL,
    "segmentSpecId" BIGINT NOT NULL,
    "segmentSteps" TEXT NOT NULL DEFAULT '',
    "reservedQty" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "consumedQty" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "segment_reservations_pkey" PRIMARY KEY ("id"),
    -- Còn giữ = reservedQty - consumedQty không âm (tồn không âm - câu 10).
    CONSTRAINT "segment_reservations_qty_chk"
      CHECK ("reservedQty" >= 0 AND "consumedQty" >= 0 AND "consumedQty" <= "reservedQty"),
    CONSTRAINT "segment_reservations_steps_chk"
      CHECK ("segmentSteps" = '' OR "segmentSteps" ~ '^(UON|DAP|DUC_LO|TAN|TOP_DAU|XE|NHAN)(,(UON|DAP|DUC_LO|TAN|TOP_DAU|XE|NHAN))*$')
);

-- Phía cộng đã ghi theo lệnh + mã đoạn
CREATE TABLE "segment_productions" (
    "id" BIGSERIAL NOT NULL,
    "productionInvoiceId" BIGINT NOT NULL,
    "segmentSpecId" BIGINT NOT NULL,
    "segmentSteps" TEXT NOT NULL DEFAULT '',
    "warehouseId" BIGINT NOT NULL,
    "heldQty" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "surplusQty" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "segment_productions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "segment_productions_qty_chk" CHECK ("heldQty" >= 0 AND "surplusQty" >= 0),
    CONSTRAINT "segment_productions_steps_chk"
      CHECK ("segmentSteps" = '' OR "segmentSteps" ~ '^(UON|DAP|DUC_LO|TAN|TOP_DAU|XE|NHAN)(,(UON|DAP|DUC_LO|TAN|TOP_DAU|XE|NHAN))*$')
);

-- Nhật ký giữ đoạn (chỉ thêm)
CREATE TABLE "segment_reservation_logs" (
    "id" BIGSERIAL NOT NULL,
    "reservationId" BIGINT NOT NULL,
    "kind" "SegmentReservationLogKind" NOT NULL,
    "qty" DECIMAL(16,4) NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "segment_reservation_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "segment_reservation_logs_qty_chk" CHECK ("qty" <> 0)
);

-- CreateIndex
CREATE INDEX "segment_reservations_warehouseId_segmentSpecId_segmentSteps_idx" ON "segment_reservations"("warehouseId", "segmentSpecId", "segmentSteps");
CREATE INDEX "segment_reservations_productionInvoiceId_idx" ON "segment_reservations"("productionInvoiceId");
CREATE UNIQUE INDEX "segment_reservations_warehouseId_productionInvoiceId_segmen_key" ON "segment_reservations"("warehouseId", "productionInvoiceId", "segmentSpecId", "segmentSteps");
CREATE INDEX "segment_productions_warehouseId_idx" ON "segment_productions"("warehouseId");
CREATE UNIQUE INDEX "segment_productions_productionInvoiceId_segmentSpecId_segme_key" ON "segment_productions"("productionInvoiceId", "segmentSpecId", "segmentSteps");
CREATE INDEX "segment_reservation_logs_reservationId_createdAt_idx" ON "segment_reservation_logs"("reservationId", "createdAt");

-- AddForeignKey
ALTER TABLE "segment_reservations" ADD CONSTRAINT "segment_reservations_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "segment_reservations" ADD CONSTRAINT "segment_reservations_productionInvoiceId_fkey" FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "segment_reservations" ADD CONSTRAINT "segment_reservations_segmentSpecId_fkey" FOREIGN KEY ("segmentSpecId") REFERENCES "segment_spec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "segment_productions" ADD CONSTRAINT "segment_productions_productionInvoiceId_fkey" FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "segment_productions" ADD CONSTRAINT "segment_productions_segmentSpecId_fkey" FOREIGN KEY ("segmentSpecId") REFERENCES "segment_spec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "segment_productions" ADD CONSTRAINT "segment_productions_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "segment_reservation_logs" ADD CONSTRAINT "segment_reservation_logs_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "segment_reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
