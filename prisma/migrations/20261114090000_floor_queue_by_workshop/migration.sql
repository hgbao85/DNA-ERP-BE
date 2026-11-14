-- Hàng đợi tổ theo xưởng (đợt C1, 14/11/2026): mỗi xưởng một hàng đợi cho mỗi tổ (Phôi/Hàn/Sơn).
-- Xưởng của dòng = xưởng của PI (ProductionInvoiceItem.workshopId; PI chưa có xưởng = xưởng mặc định);
-- riêng tổ Sơn: nếu xưởng đó nhờ xưởng khác sơn (workshops.paintWorkshopId) thì lấy xưởng sơn.
-- Xưởng mặc định = xưởng của kho 'phoi-son-han'; kho đó không có xưởng thì xưởng đang dùng có sortOrder nhỏ nhất, rồi id nhỏ nhất.

-- AlterTable
ALTER TABLE "floor_queue_entries" ADD COLUMN "workshopId" BIGINT;

-- Backfill dòng cũ theo đúng quy tắc trên
WITH def AS (
  SELECT COALESCE(
    (SELECT w."workshopId" FROM "warehouses" w WHERE w."code" = 'phoi-son-han'),
    (SELECT x."id" FROM "workshops" x WHERE x."isActive" = true ORDER BY x."sortOrder" ASC, x."id" ASC LIMIT 1)
  ) AS "id"
),
base AS (
  SELECT q."id" AS "entryId", q."stage" AS "stage",
         COALESCE(
           (SELECT i."workshopId" FROM "production_invoice_items" i
             WHERE i."productionInvoiceId" = q."productionInvoiceId" AND i."workshopId" IS NOT NULL
             ORDER BY i."id" ASC LIMIT 1),
           (SELECT "id" FROM def)
         ) AS "workshopId"
  FROM "floor_queue_entries" q
)
UPDATE "floor_queue_entries" q
SET "workshopId" = CASE
  WHEN b."stage" = 'SON' THEN COALESCE((SELECT x."paintWorkshopId" FROM "workshops" x WHERE x."id" = b."workshopId"), b."workshopId")
  ELSE b."workshopId"
END
FROM base b
WHERE q."id" = b."entryId";

-- CreateIndex
CREATE INDEX "floor_queue_entries_stage_workshopId_status_position_idx" ON "floor_queue_entries"("stage", "workshopId", "status", "position");

-- AddForeignKey
ALTER TABLE "floor_queue_entries" ADD CONSTRAINT "floor_queue_entries_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "workshops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Mỗi (tổ, xưởng) đúng 1 dòng RUNNING (trước đây: mỗi tổ 1 dòng)
DROP INDEX "floor_queue_entries_one_running_per_stage";
CREATE UNIQUE INDEX "floor_queue_entries_one_running_per_stage_workshop"
  ON "floor_queue_entries" ("stage", COALESCE("workshopId", 0))
  WHERE "status" = 'RUNNING';
