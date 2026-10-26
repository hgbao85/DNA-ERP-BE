-- Sep Nhan 2026-10-24: "bat buoc chi duoc gop toi da 2 lenh" -> tran so SKU mac dinh 2 (migration 20261024110000 de 5, chua deploy).

-- AlterTable
ALTER TABLE "system_config" ALTER COLUMN "solverMergeMaxSkus" SET DEFAULT 2;

UPDATE "system_config" SET "solverMergeMaxSkus" = 2 WHERE "solverMergeMaxSkus" = 5;
