-- PieceBom unique constraint doi de bao gom processSteps (2026-10-19)
-- 1 manh duoc phep co nhieu dong cung (vat tu, chieu dai cat) mien la cong doan phoi khac nhau
-- (vd "4 cay 460mm co Dap" tach rieng khoi "4 cay 460mm tron") - day la 2 chi tiet that khac
-- nhau, khong phai trung du lieu. Truoc day khoa chi (bomRevisionId, pieceId, segmentSpecId)
-- nen 2 dong nay dung P2002 luc gui phe duyet dinh muc manh (bug that).
-- DropIndex
DROP INDEX "piece_bom_bomRevisionId_pieceId_segmentSpecId_key";

-- CreateIndex
CREATE UNIQUE INDEX "piece_bom_bomRevisionId_pieceId_segmentSpecId_processSteps_key" ON "piece_bom"("bomRevisionId", "pieceId", "segmentSpecId", "processSteps");
