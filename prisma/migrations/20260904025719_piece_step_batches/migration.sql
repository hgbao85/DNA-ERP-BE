-- Tiến độ theo từng công đoạn (Cắt/Uốn/Dập/...) cho vật tư thành phẩm (PieceMaterialYield.
-- processSteps, migration 20260904010702) - Phôi báo "vừa Cắt xong N mảnh" trước khi chốt lô
-- production_batches thật để gửi KCS. Append-only, cộng dồn - KHÔNG mirror cặp
-- step_batches+step_batch_segments bên Sắt vì vật tư thành phẩm không có segment_spec_id để bóc
-- theo cỡ đoạn (PieceMaterialYield unique theo (bomRevisionId, pieceId) - đúng 1 material/piece).
-- Đơn vị = SỐ MẢNH, khớp production_batches.reportedQty.
--
-- idempotencyKey + reportedById CÓ ở đây (khác step_batches bên Sắt THIẾU cả hai, gây khe TOCTOU
-- khi 2 người báo cùng lúc) - cố ý làm khác, không lặp lại thiếu sót đó.
CREATE TABLE "piece_step_batches" (
    "id" BIGSERIAL NOT NULL,
    "productionOrderId" BIGINT NOT NULL,
    "pieceId" BIGINT NOT NULL,
    "step" "ProcessStep" NOT NULL,
    "qty" INTEGER NOT NULL,
    "idempotencyKey" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportedById" TEXT NOT NULL,

    CONSTRAINT "piece_step_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "piece_step_batches_idempotencyKey_key" ON "piece_step_batches"("idempotencyKey");

-- CreateIndex
CREATE INDEX "piece_step_batches_productionOrderId_pieceId_step_idx" ON "piece_step_batches"("productionOrderId", "pieceId", "step");

-- AddForeignKey
ALTER TABLE "piece_step_batches" ADD CONSTRAINT "piece_step_batches_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_step_batches" ADD CONSTRAINT "piece_step_batches_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "piece"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_step_batches" ADD CONSTRAINT "piece_step_batches_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
