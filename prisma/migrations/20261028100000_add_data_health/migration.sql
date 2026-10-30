-- "Kiểm tra dữ liệu" mỗi đêm (2026-10-28, changelog 2026-09-25 mục 32.19-32.20). Chỉ THÊM 2 bảng mới, không đụng dữ liệu cũ.
-- CreateTable
CREATE TABLE "data_health_runs" (
    "id" BIGSERIAL NOT NULL,
    "trigger" TEXT NOT NULL,
    "triggeredById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "summary" JSONB,
    "error" TEXT,

    CONSTRAINT "data_health_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_health_findings" (
    "id" BIGSERIAL NOT NULL,
    "checkCode" TEXT NOT NULL,
    "entityKey" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "data_health_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_health_runs_startedAt_idx" ON "data_health_runs"("startedAt");

-- CreateIndex
CREATE INDEX "data_health_findings_resolvedAt_idx" ON "data_health_findings"("resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "data_health_findings_checkCode_entityKey_key" ON "data_health_findings"("checkCode", "entityKey");
