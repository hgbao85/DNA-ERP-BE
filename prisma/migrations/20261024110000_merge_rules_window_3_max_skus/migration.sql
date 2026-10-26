-- Luat gop (2026-10-24, Sep Nhan): moc can sat cach nhau toi da 3 ngay (truoc 7, chi goi y) + tran so SKU moi dot/lenh gop (5).
-- Gia tri 7 la mac dinh cu cua migration 20261024100000 (chua tung deploy) -> doi sang 3.

-- AlterTable
ALTER TABLE "system_config" ALTER COLUMN "solverMergeWindowDays" SET DEFAULT 3,
ADD COLUMN     "solverMergeMaxSkus" INTEGER NOT NULL DEFAULT 5;

UPDATE "system_config" SET "solverMergeWindowDays" = 3 WHERE "solverMergeWindowDays" = 7;
