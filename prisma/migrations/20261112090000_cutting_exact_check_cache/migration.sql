-- Nhớ kết quả xác minh hao hụt khi cắt riêng (bộ giải thật) qua lần BE khởi động lại/ngủ; key = sha256 khoá bài toán + số phiên bản.
-- CreateTable
CREATE TABLE "cutting_exact_checks" (
    "key" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cutting_exact_checks_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "cutting_exact_checks_createdAt_idx" ON "cutting_exact_checks"("createdAt");
