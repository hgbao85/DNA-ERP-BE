-- Tìm lệnh (PI) đã dính lỗi "Sếp duyệt xong mà không có dòng mua ngoài sắt" (transaction 5 s quá giờ, sửa 10/11/2026 - 7ab07e6).
-- CHỈ ĐỌC. Chạy: npx prisma db execute --file prisma/sql/tim-lenh-thieu-dong-mua-ngoai-sat.sql  (hoặc dán vào psql / công cụ DB).
--
-- Cách nhận biết: 3 bước tạo dòng mua ngoài sắt LUÔN tạo dòng cho mọi vật tư trong định mức - kể cả khi tồn đủ (dòng tạo sẵn
-- ở trạng thái PURCHASED). Nên lệnh đã có lệnh sản xuất, định mức (bản đã ghim của lệnh sản xuất) có vật tư KHÔNG thuộc nhóm
-- Sắt, mà đề xuất mua của lệnh không có dòng nào cho các vật tư đó => đã dính lỗi.
-- Sửa: Admin > Lệnh sản xuất > "Tạo lại dòng mua ngoài sắt" ở từng dòng lệnh (chạy lại 3 bước, không tạo dòng trùng).
WITH po AS (
  SELECT pii."productionInvoiceId" AS pi_id, o."bomRevisionId" AS rev_id
  FROM production_orders o
  JOIN production_invoice_items pii ON pii.id = o."productionInvoiceItemId"
  WHERE pii."prodApprovalStatus" = 'APPROVED' AND pii."productionInvoiceId" IS NOT NULL
),
can AS (
  SELECT DISTINCT po.pi_id, x.material_id
  FROM po
  JOIN (
    SELECT "bomRevisionId" AS rev_id, "materialId" AS material_id FROM consumable_bom
    UNION SELECT "bomRevisionId", "materialId" FROM piece_material_item
    UNION SELECT "bomRevisionId", "materialId" FROM bom_accessory_items
  ) x ON x.rev_id = po.rev_id
  JOIN materials m ON m.id = x.material_id
  LEFT JOIN material_groups g ON g.id = m."materialGroupId"
  WHERE g."systemKey" IS DISTINCT FROM 'STEEL_BAR'
),
co AS (
  SELECT DISTINCT pp."productionInvoiceId" AS pi_id, ppi."materialId" AS material_id
  FROM purchase_proposal_items ppi
  JOIN purchase_proposals pp ON pp.id = ppi."proposalId"
  WHERE pp."productionInvoiceId" IS NOT NULL
)
SELECT pi.code AS ma_pi,
       string_agg(DISTINCT pii."lsxCode", ' + ') AS so_lsx,
       count(DISTINCT can.material_id) AS vat_tu_ngoai_sat_trong_dinh_muc,
       count(DISTINCT co.material_id) AS da_co_dong_mua
FROM can
JOIN production_invoices pi ON pi.id = can.pi_id
JOIN production_invoice_items pii ON pii."productionInvoiceId" = pi.id
LEFT JOIN co ON co.pi_id = can.pi_id AND co.material_id = can.material_id
GROUP BY pi.id, pi.code
HAVING count(DISTINCT co.material_id) = 0
ORDER BY pi.id;
