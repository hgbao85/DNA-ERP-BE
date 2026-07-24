-- CreateEnum
CREATE TYPE "MfgRole" AS ENUM ('PRODUCTION_MANAGER', 'PHOI', 'HAN', 'SON', 'KCS', 'WEAVING_MANAGER', 'WEAVING_EXPORT', 'BOM_MANAGER', 'SPEC_STEEL', 'SPEC_WIRE_PAINT', 'SPEC_ACCESSORY', 'SPEC_PACKAGING');

-- CreateEnum
CREATE TYPE "PhoiOperation" AS ENUM ('CAT', 'TOP_DAU', 'UON', 'DAP', 'DUC_LO', 'BAN_TAN');

-- CreateEnum
CREATE TYPE "NotificationAudience" AS ENUM ('ALL', 'BOSS', 'WAREHOUSE_STAFF');

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "mfgRole" "MfgRole",
  ADD COLUMN "phoiOperation" "PhoiOperation",
  ADD COLUMN "warehouseScope" TEXT,
  ADD COLUMN "isPurchaser" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isProductPlanner" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isSale" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "audience" "NotificationAudience" NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_reads" (
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_reads_pkey" PRIMARY KEY ("notificationId","userId")
);

-- CreateIndex
CREATE INDEX "users_warehouseScope_idx" ON "users"("warehouseScope");

-- CreateIndex
CREATE INDEX "notifications_audience_idx" ON "notifications"("audience");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "system_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "companyName" TEXT NOT NULL,
    "companyAddress" TEXT,
    "companyPhone" TEXT,
    "companyEmail" TEXT,
    "taxCode" TEXT,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'VND',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("id")
);
