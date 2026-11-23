-- Bo hang doi xuong, gop san luong (23/11/2026).
-- (1) Cot "xong Phoi" cua lenh thay cho dong hang doi PHOI DONE.
ALTER TABLE "production_invoices" ADD COLUMN "phoiDoneAt" TIMESTAMP(3);

-- (2) Chep thoi diem xong Phoi tu dong hang doi PHOI DONE (lay MAX theo lenh). Bang floor_queue_entries giu nguyen, khong ghi nua.
UPDATE "production_invoices" AS pi
SET "phoiDoneAt" = q."doneAt"
FROM (
  SELECT "productionInvoiceId", MAX(COALESCE("endedAt", "queuedAt")) AS "doneAt"
  FROM "floor_queue_entries"
  WHERE "stage" = 'PHOI' AND "status" = 'DONE'
  GROUP BY "productionInvoiceId"
) AS q
WHERE q."productionInvoiceId" = pi."id" AND pi."phoiDoneAt" IS NULL;

-- (3) Noi son giu nguyen (Workshop.paintWorkshopId): xuong Phuoc An khong co to Son, lenh Phuoc An son o Phu An.

-- (4) Dong cac tin con mo cua 2 loai tin ngung phat (FLOOR_PHOI_DONE, FLOOR_STAGE_COMPLETE).
UPDATE "notification_recipients" AS nr
SET "resolvedAt" = CURRENT_TIMESTAMP
FROM "notifications" AS n
WHERE n."id" = nr."notificationId"
  AND n."type" IN ('FLOOR_PHOI_DONE', 'FLOOR_STAGE_COMPLETE')
  AND nr."resolvedAt" IS NULL;
