-- CreateTable
CREATE TABLE "step_batches" (
    "id" BIGSERIAL NOT NULL,
    "steelIssueId" BIGINT NOT NULL,
    "step" "ProcessStep" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "step_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "step_batch_segments" (
    "id" BIGSERIAL NOT NULL,
    "stepBatchId" BIGINT NOT NULL,
    "segmentSpecId" BIGINT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "step_batch_segments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "step_batches_steelIssueId_step_idx" ON "step_batches"("steelIssueId", "step");

-- CreateIndex
CREATE UNIQUE INDEX "step_batch_segments_stepBatchId_segmentSpecId_key" ON "step_batch_segments"("stepBatchId", "segmentSpecId");

-- AddForeignKey
ALTER TABLE "step_batches" ADD CONSTRAINT "step_batches_steelIssueId_fkey" FOREIGN KEY ("steelIssueId") REFERENCES "steel_issues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_batch_segments" ADD CONSTRAINT "step_batch_segments_stepBatchId_fkey" FOREIGN KEY ("stepBatchId") REFERENCES "step_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_batch_segments" ADD CONSTRAINT "step_batch_segments_segmentSpecId_fkey" FOREIGN KEY ("segmentSpecId") REFERENCES "segment_spec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
