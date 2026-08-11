-- AlterTable
ALTER TABLE "steel_issues" ADD COLUMN "barCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "steel_issues" ALTER COLUMN "barCount" DROP DEFAULT;
