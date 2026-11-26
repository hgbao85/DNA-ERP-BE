-- Điều phối đan (25/11/2026 - docs THIET-KE-DIEU-PHOI-DAN-2026-11-25, chốt Đ1-Đ4). Chỉ thêm (enum mới, cột cho phép rỗng,
-- bảng mới) - không ghi lại dữ liệu cũ. Vai trò WEAVING_COORDINATOR là 1 dòng bảng roles do seed tạo (không phải enum DB).
-- Công tắc DIEU_PHOI_DAN_ENABLED tắt thì không luồng nào ghi vào bảng weaving_follow_ups. CHECK so enum qua ::text (như các migration trước).

-- CreateEnum
CREATE TYPE "WeavingFollowUpPromiseStatus" AS ENUM ('NONE', 'OPEN', 'REMINDED', 'KEPT', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "weaving_points" ADD COLUMN     "contactPerson" TEXT;

-- CreateTable
CREATE TABLE "weaving_follow_ups" (
    "id" BIGSERIAL NOT NULL,
    "weavingPointId" BIGINT NOT NULL,
    "productionOrderId" BIGINT NOT NULL,
    "pieceId" BIGINT NOT NULL,
    "content" TEXT NOT NULL,
    "promisedQty" INTEGER,
    "promisedDate" DATE,
    "heldAtCreate" INTEGER NOT NULL,
    "returnedAtCreate" INTEGER NOT NULL,
    "promiseStatus" "WeavingFollowUpPromiseStatus" NOT NULL DEFAULT 'NONE',
    "remindedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weaving_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "weaving_follow_ups_weavingPointId_productionOrderId_pieceId_idx" ON "weaving_follow_ups"("weavingPointId", "productionOrderId", "pieceId", "createdAt");

-- CreateIndex
CREATE INDEX "weaving_follow_ups_promiseStatus_promisedDate_idx" ON "weaving_follow_ups"("promiseStatus", "promisedDate");

-- AddForeignKey
ALTER TABLE "weaving_follow_ups" ADD CONSTRAINT "weaving_follow_ups_weavingPointId_fkey" FOREIGN KEY ("weavingPointId") REFERENCES "weaving_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weaving_follow_ups" ADD CONSTRAINT "weaving_follow_ups_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weaving_follow_ups" ADD CONSTRAINT "weaving_follow_ups_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "piece"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weaving_follow_ups" ADD CONSTRAINT "weaving_follow_ups_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Ràng buộc nghiệp vụ (Đ2): nội dung bắt buộc; số hẹn > 0 và không vượt số đang giữ lúc ghi; số hẹn và ngày hẹn cùng có hoặc cùng không;
-- trạng thái NONE <=> không hẹn.
ALTER TABLE "weaving_follow_ups" ADD CONSTRAINT "weaving_follow_ups_content_not_blank" CHECK (length(btrim("content")) > 0);
ALTER TABLE "weaving_follow_ups" ADD CONSTRAINT "weaving_follow_ups_snapshot_non_negative" CHECK ("heldAtCreate" >= 0 AND "returnedAtCreate" >= 0);
ALTER TABLE "weaving_follow_ups" ADD CONSTRAINT "weaving_follow_ups_promise_pair" CHECK (("promisedQty" IS NULL) = ("promisedDate" IS NULL));
ALTER TABLE "weaving_follow_ups" ADD CONSTRAINT "weaving_follow_ups_promise_qty_range" CHECK ("promisedQty" IS NULL OR ("promisedQty" > 0 AND "promisedQty" <= "heldAtCreate"));
ALTER TABLE "weaving_follow_ups" ADD CONSTRAINT "weaving_follow_ups_promise_status_matches" CHECK (("promiseStatus"::text = 'NONE') = ("promisedQty" IS NULL));
