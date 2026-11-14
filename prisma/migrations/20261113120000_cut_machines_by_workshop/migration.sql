-- Nen "chia sat cho may cat" (dot A, 13/11/2026; quy tac chia sat cho may 07/11):
-- May cat theo xuong: workstations co them xuong dat may + loai may cat (laser / tu_dong). May CUT co tu truoc la may laser.

-- AlterTable
ALTER TABLE "workstations" ADD COLUMN "workshopId" BIGINT,
ADD COLUMN "cutMachineType" "SolverMachine";

UPDATE "workstations" SET "cutMachineType" = 'laser' WHERE "kind" = 'CUT';

ALTER TABLE "workstations" ADD CONSTRAINT "workstations_cut_type_chk"
  CHECK (("kind" = 'CUT') = ("cutMachineType" IS NOT NULL));

-- CreateIndex
CREATE INDEX "workstations_workshopId_idx" ON "workstations"("workshopId");

-- AddForeignKey
ALTER TABLE "workstations" ADD CONSTRAINT "workstations_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "workshops"("id") ON DELETE SET NULL ON UPDATE CASCADE;
