-- Cua so han giao khi goi y gop don giam hao hut sat (2026-10-24): chi gop don co han giao cach nhau toi da N ngay.
-- Mac dinh 7 ngay; Admin chinh o Cau hinh he thong.

-- AlterTable
ALTER TABLE "system_config" ADD COLUMN     "solverMergeWindowDays" INTEGER NOT NULL DEFAULT 7;
