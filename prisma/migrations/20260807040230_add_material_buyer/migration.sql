-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "buyerId" TEXT;

-- CreateIndex
CREATE INDEX "materials_buyerId_idx" ON "materials"("buyerId");

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
