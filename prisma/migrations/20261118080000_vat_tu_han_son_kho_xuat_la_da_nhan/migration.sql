-- Vat tu Han / Son: kho xuat phieu co chu ky nguoi nhan la da nhan (quyet dinh 18/11/2026), khong con buoc to xac nhan nhan.
-- Migration CHI DU LIEU, khong doi schema. Ca 3 cau chay lai nhieu lan khong doi them gi, khong dung dong da RECEIVED, khong ghi so kho.

-- (1) Dong con ISSUED coi nhu da nhan du: so nhan = so xuat, luc nhan = luc xuat, khong co nguoi nhan.
UPDATE "material_issues"
SET "status" = 'RECEIVED', "receivedQty" = "issuedQty", "receivedAt" = "issuedAt"
WHERE "status" = 'ISSUED';

-- (2) Dong tin MATERIAL_ISSUE_TO_TEAM con mo thi dong lai.
UPDATE "notification_recipients" AS nr
SET "resolvedAt" = CURRENT_TIMESTAMP
FROM "notifications" AS n
WHERE n."id" = nr."notificationId"
  AND n."type" = 'MATERIAL_ISSUE_TO_TEAM'
  AND nr."resolvedAt" IS NULL;

-- (3) Bam tin cu thi ve man Lenh san xuat.
UPDATE "notifications"
SET "link" = jsonb_set("link", '{page}', '"phoi-lenh-sx"')
WHERE "type" = 'MATERIAL_ISSUE_TO_TEAM'
  AND "link"->>'page' = 'han-son-xac-nhan-vat-tu';
