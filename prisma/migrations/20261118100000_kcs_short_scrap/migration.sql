-- KCS tu chuyen (P1, 18/11/2026): KCS ghi them "Thieu" (dem thieu so voi so bao) va "Bo, cat lai" (trong so loi, chi cong doan phu).
-- failedQty van CHI la loi: ke hoach manh cua N1 dua vao cot nay nen thieu khong bao gio cong vao failedQty.
-- Them 3 cot mac dinh 0 (bang nho, khong khoa lau) + 2 CHECK. Khong sua migration cu.
-- Luu y: qc_reviews.scrapQty cu da bi bo o 20260908060000, cot scrapQty moi chi nam o qc_review_segments; ten CHECK moi khong trung ten cu.

ALTER TABLE "qc_reviews" ADD COLUMN "shortQty" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "qc_review_segments"
  ADD COLUMN "shortQty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "scrapQty" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "qc_reviews"
  ADD CONSTRAINT "qc_reviews_short_qty_chk" CHECK ("shortQty" >= 0);

ALTER TABLE "qc_review_segments"
  ADD CONSTRAINT "qc_review_segments_short_scrap_chk"
  CHECK ("shortQty" >= 0 AND "scrapQty" >= 0 AND "scrapQty" <= "failedQty");
