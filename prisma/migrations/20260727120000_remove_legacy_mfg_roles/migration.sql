-- AlterEnum
-- Xoá 3 giá trị legacy khỏi MfgRole: WEAVING_MANAGER, WEAVING_EXPORT, BOM_MANAGER.
-- Đã xác nhận trước khi chạy: không có user nào trong DB đang mang 1 trong 3 giá trị này
-- (SELECT count(*) FROM users WHERE "mfgRole" IN ('WEAVING_MANAGER','WEAVING_EXPORT','BOM_MANAGER') = 0),
-- nên phép cast USING bên dưới không rơi vào trường hợp invalid input value.
BEGIN;
CREATE TYPE "MfgRole_new" AS ENUM ('PRODUCTION_MANAGER', 'PHOI', 'HAN', 'SON', 'KCS', 'SPEC_STEEL', 'SPEC_WIRE_PAINT', 'SPEC_ACCESSORY', 'SPEC_PACKAGING');
ALTER TABLE "users" ALTER COLUMN "mfgRole" TYPE "MfgRole_new" USING ("mfgRole"::text::"MfgRole_new");
ALTER TYPE "MfgRole" RENAME TO "MfgRole_old";
ALTER TYPE "MfgRole_new" RENAME TO "MfgRole";
DROP TYPE "MfgRole_old";
COMMIT;
