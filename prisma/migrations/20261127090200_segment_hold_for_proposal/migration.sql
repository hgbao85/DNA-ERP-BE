-- Nhân trả lời 26/11 câu 4: giữ đoạn dư ngay lúc KHSX tính phương án cắt (kể cả lượt tính TRƯỚC khi có lệnh), lệnh khác không thấy
-- những đoạn đó nữa; lệnh bị huỷ / không được duyệt thì trả đoạn về kho. Dòng giữ của phương án chưa có lệnh: productionInvoiceId
-- NULL + cuttingProposalId; tạo lệnh từ phương án thì gắn PI. Dòng cũ không đổi (đều có PI).

-- AlterTable
ALTER TABLE "segment_reservations" ALTER COLUMN "productionInvoiceId" DROP NOT NULL;
ALTER TABLE "segment_reservations" ADD COLUMN "cuttingProposalId" BIGINT;

-- CreateIndex
CREATE INDEX "segment_reservations_cuttingProposalId_idx" ON "segment_reservations"("cuttingProposalId");
