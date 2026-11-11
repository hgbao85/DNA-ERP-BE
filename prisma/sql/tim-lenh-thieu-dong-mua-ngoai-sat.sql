-- Tìm lệnh (PI) đã dính lỗi "Sếp duyệt xong mà không có dòng mua ngoài sắt" (transaction 5 s quá giờ, sửa 10/11/2026 - 7ab07e6).
-- CHỈ ĐỌC (chỉ có SELECT, bọc READ ONLY rồi ROLLBACK). Chạy bằng psql hoặc công cụ DB để xem kết quả
-- (`npx prisma db execute` chạy được nhưng không in ra các dòng tìm được).
--
-- Cách nhận biết, tách theo 3 nguồn mua ngoài sắt: vật tư có nhu cầu theo định mức (bản đã ghim của lệnh sản xuất) mà đề
-- xuất mua của PI không có dòng nào cho vật tư đó.
--   - pat/vật tư thành phẩm theo mảnh và vật tư tiêu hao: bước tính mua LUÔN tạo dòng, kể cả khi tồn đủ (dòng tạo sẵn ở
--     trạng thái PURCHASED) -> thiếu dòng = bước đó chưa chạy xong.
--   - chân nhôm/vật tư thành phẩm không gắn mảnh: bước này trừ tồn vật tư ra (vd chân nhôm có sẵn ở kho gốc) trước, tồn đủ
--     thì KHÔNG tạo dòng -> chỉ coi là thiếu khi nhu cầu vượt tồn đó.
-- Chỉ xét PI đang lên kế hoạch / đang sản xuất. Không so số lượng: PI đã có dòng của SKU duyệt trước nhưng thiếu phần của
-- SKU duyệt sau (cùng vật tư) không hiện ở đây - bấm "Tạo lại" cho PI đó vẫn an toàn.
-- Sửa: Admin > Lệnh sản xuất > "Tạo lại dòng mua ngoài sắt" ở dòng lệnh (chạy lại 3 bước, không tạo dòng trùng).
BEGIN TRANSACTION READ ONLY;

WITH lenh AS (
  SELECT o.id AS po_id, pii."productionInvoiceId" AS pi_id, o."bomRevisionId" AS rev_id,
         o.quantity AS sl, o."wireMaterialId" AS wire_id, o."cushionMaterialId" AS cushion_id
  FROM production_orders o
  JOIN production_invoice_items pii ON pii.id = o."productionInvoiceItemId"
  JOIN production_invoices p ON p.id = pii."productionInvoiceId"
  WHERE pii."prodApprovalStatus" = 'APPROVED'
    AND p.status IN ('PLANNING', 'PRODUCING')
),
-- Loại dây/nệm có trong định mức nhưng lệnh KHÔNG chọn (không tính vào nhu cầu).
khong_chon AS (
  SELECT l.po_id, bo."materialId"
  FROM lenh l
  JOIN bom_option bo ON bo."bomRevisionId" = l.rev_id
  WHERE (bo.kind = 'WIRE' AND l.wire_id IS NOT NULL AND bo."materialId" <> l.wire_id)
     OR (bo.kind = 'CUSHION' AND l.cushion_id IS NOT NULL AND bo."materialId" <> l.cushion_id)
),
-- Nguồn 1: pat/vật tư thành phẩm theo mảnh (định mức nguyên liệu tự tính của mảnh).
can_pat AS (
  SELECT DISTINCT l.pi_id, y."materialId"
  FROM lenh l
  JOIN bom_piece bp ON bp."bomRevisionId" = l.rev_id AND bp."qtyPerUnit" > 0
  JOIN piece_material_yield y ON y."bomRevisionId" = bp."bomRevisionId" AND y."pieceId" = bp."pieceId"
),
-- Nguồn 2: vật tư tiêu hao (dây/đinh/tán rút/nút nhựa theo mảnh + sơn + phụ kiện/bao bì).
can_tieu_hao AS (
  SELECT DISTINCT x.pi_id, x."materialId"
  FROM (
    SELECT l.po_id, l.pi_id, pmi."materialId"
    FROM lenh l
    JOIN bom_piece bp ON bp."bomRevisionId" = l.rev_id AND bp."qtyPerUnit" > 0
    JOIN piece_material_item pmi ON pmi."bomRevisionId" = bp."bomRevisionId" AND pmi."pieceId" = bp."pieceId"
    JOIN materials m ON m.id = pmi."materialId"
    WHERE m."steelSubGroup" IS DISTINCT FROM 'FINISHED_COMPONENT'
    UNION ALL
    SELECT l.po_id, l.pi_id, cb."materialId"
    FROM lenh l
    JOIN consumable_bom cb ON cb."bomRevisionId" = l.rev_id AND cb.stage IN ('HAN', 'SON')
    UNION ALL
    SELECT l.po_id, l.pi_id, a."materialId"
    FROM lenh l
    JOIN bom_accessory_items a ON a."bomRevisionId" = l.rev_id
  ) x
  WHERE NOT EXISTS (
    SELECT 1 FROM khong_chon k WHERE k.po_id = x.po_id AND k."materialId" = x."materialId"
  )
),
-- Nguồn 3: nguyên liệu đầu vào cho chân nhôm/vật tư thành phẩm không gắn mảnh (chỉ dòng tick "đi kèm xuất đan", cùng
-- điều kiện với bước tính mua). Chỉ coi là thiếu khi nhu cầu vật tư ra vượt tồn của nó ở kho gốc.
can_chan_nhom AS (
  SELECT DISTINCT x.pi_id, x."materialId"
  FROM (
    SELECT l.pi_id, r."inputMaterialId" AS "materialId", r."outputMaterialId" AS out_id,
           om."warehouseId" AS out_wh,
           sum(bp."qtyPerUnit" * pmi."qtyPerPiece" * l.sl) AS can_ra
    FROM lenh l
    JOIN bom_piece bp ON bp."bomRevisionId" = l.rev_id
    JOIN piece_material_item pmi ON pmi."bomRevisionId" = bp."bomRevisionId"
                                AND pmi."pieceId" = bp."pieceId"
                                AND pmi."includeInWeaving" = true
    JOIN material_yield_recipes r ON r."outputMaterialId" = pmi."materialId" AND r."isActive" = true
    JOIN materials om ON om.id = r."outputMaterialId"
    GROUP BY l.pi_id, r."inputMaterialId", r."outputMaterialId", om."warehouseId"
  ) x
  WHERE x.can_ra > COALESCE((
    SELECT sum(q.qty) FROM stock_quant q
    WHERE q."materialId" = x.out_id AND q."warehouseId" = x.out_wh
  ), 0)
),
dong_mua AS (
  SELECT DISTINCT pp."productionInvoiceId" AS pi_id, ppi."materialId"
  FROM purchase_proposals pp
  JOIN purchase_proposal_items ppi ON ppi."proposalId" = pp.id
  WHERE pp."productionInvoiceId" IS NOT NULL
),
thieu AS (
  SELECT 'pat' AS nguon, c.pi_id, c."materialId" FROM can_pat c
  WHERE NOT EXISTS (SELECT 1 FROM dong_mua d WHERE d.pi_id = c.pi_id AND d."materialId" = c."materialId")
  UNION ALL
  SELECT 'tieu_hao', c.pi_id, c."materialId" FROM can_tieu_hao c
  WHERE NOT EXISTS (SELECT 1 FROM dong_mua d WHERE d.pi_id = c.pi_id AND d."materialId" = c."materialId")
  UNION ALL
  SELECT 'chan_nhom', c.pi_id, c."materialId" FROM can_chan_nhom c
  WHERE NOT EXISTS (SELECT 1 FROM dong_mua d WHERE d.pi_id = c.pi_id AND d."materialId" = c."materialId")
)
SELECT p.code AS ma_pi,
       (SELECT string_agg(DISTINCT pii."lsxCode", ' + ') FROM production_invoice_items pii
         WHERE pii."productionInvoiceId" = p.id) AS so_lsx,
       p.status AS trang_thai_pi,
       count(*) FILTER (WHERE t.nguon = 'pat') AS so_vt_thieu_pat,
       count(*) FILTER (WHERE t.nguon = 'tieu_hao') AS so_vt_thieu_tieu_hao,
       count(*) FILTER (WHERE t.nguon = 'chan_nhom') AS so_vt_thieu_chan_nhom,
       string_agg(DISTINCT m.code, ', ') AS ma_vat_tu_thieu
FROM thieu t
JOIN production_invoices p ON p.id = t.pi_id
JOIN materials m ON m.id = t."materialId"
GROUP BY p.id, p.code, p.status
ORDER BY p.id;

ROLLBACK;
