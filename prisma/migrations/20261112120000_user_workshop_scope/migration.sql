-- Xưởng phụ trách của tài khoản (QLSX theo xưởng). NULL = không giới hạn, nên tài khoản hiện có không đổi hành vi.
-- AlterTable
ALTER TABLE "users" ADD COLUMN "workshopId" BIGINT;

-- CreateIndex
CREATE INDEX "users_workshopId_idx" ON "users"("workshopId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "workshops"("id") ON DELETE SET NULL ON UPDATE CASCADE;
