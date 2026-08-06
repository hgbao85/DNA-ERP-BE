-- AlterEnum
BEGIN;
CREATE TYPE "MfgRole_new" AS ENUM ('PRODUCTION_MANAGER', 'PHOI', 'HAN', 'SON', 'KCS', 'SPEC_STEEL', 'SPEC_ACCESSORY', 'SPEC_PACKAGING');
ALTER TABLE "users" ALTER COLUMN "mfgRole" TYPE "MfgRole_new" USING ("mfgRole"::text::"MfgRole_new");
ALTER TYPE "MfgRole" RENAME TO "MfgRole_old";
ALTER TYPE "MfgRole_new" RENAME TO "MfgRole";
DROP TYPE "public"."MfgRole_old";
COMMIT;
