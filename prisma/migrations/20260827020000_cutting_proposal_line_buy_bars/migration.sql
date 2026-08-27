-- L1 (2026-08-27): lưu phần đóng góp nhu cầu mua của TỪNG dòng phương án cắt, để
-- PurchaseProposalItem.buyQty được TÍNH LẠI TOÀN PHẦN (Σ buyBars) thay vì sửa tại chỗ bằng
-- heuristic "cộng dồn hay thay thế" (chỉ đúng khi dòng có 1 nguồn đóng góp).
-- Xem doc comment CuttingProposalLine.buyBars trong schema.prisma.
ALTER TABLE "cutting_proposal_lines" ADD COLUMN "buyBars" INTEGER;

-- Chỉ mục cho câu hỏi nóng của bước tính lại: "mọi dòng còn hiệu lực của PI này, vật tư này, có
-- buyBars bao nhiêu" - luôn lọc kèm materialId nên đặt materialId trước.
CREATE INDEX "cutting_proposal_lines_materialId_cuttingProposalId_idx"
  ON "cutting_proposal_lines" ("materialId", "cuttingProposalId");
