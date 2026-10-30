import { Prisma } from '../../generated/prisma/client';

export type DataHealthSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

export interface DataHealthColumn {
  key: string;
  label: string;
}

/**
 * Một phép kiểm "Kiểm tra dữ liệu" (2026-10-28, changelog 2026-09-25 mục 32.19-32.20). CHỈ ĐỌC - câu SQL không được ghi/khoá
 * gì (không FOR UPDATE), vì tự chạy nền mỗi ngày (lúc máy chủ thức, có thể giữa giờ làm) và cả khi Admin bấm "Kiểm ngay".
 *
 * `sql` PHẢI trả cột `entity_key` (khoá ổn định của đối tượng, để nhận ra cùng 1 dòng giữa các lần chạy) + đúng các cột khai ở
 * `columns` (FE dựng bảng theo `columns`, không biết gì riêng về từng phép kiểm). Mọi phép kiểm tự `LIMIT ${ROW_LIMIT}`.
 *
 * Đợt 1 chỉ kiểm dòng VẬT TƯ (materialId), CHƯA kiểm đoạn cắt / mảnh / biến thể: DB test có rất nhiều đoạn tồn âm mà chưa rõ có
 * phải đúng nghiệp vụ (đoạn dư để dưới xưởng, xuất trước nhập) - kiểm luôn thì toàn báo nhầm.
 */
export interface DataHealthCheck {
  code: string;
  title: string;
  severity: DataHealthSeverity;
  /** Vì sao bất thường này đáng lo (hiện cho Admin). */
  description: string;
  /** Gợi ý xử lý. */
  hint: string;
  columns: DataHealthColumn[];
  sql: Prisma.Sql;
}

/** Trần số dòng mỗi phép kiểm trả về - đủ để thấy vấn đề, không làm nổ bảng phát hiện nếu 1 lỗi lan rộng. */
export const ROW_LIMIT = 500;

/** Lọc dòng sổ cái / tồn kho chỉ của VẬT TƯ (không phải đoạn, mảnh, biến thể). */
const MATERIAL_ROW = Prisma.sql`"materialId" IS NOT NULL AND "segmentSpecId" IS NULL AND "pieceId" IS NULL
  AND "productVariantId" IS NULL`;

/** PI mà MỌI lệnh sản xuất đã "Kết thúc" (floorStage FINISHED) - cùng điều kiện nhả giữ chỗ của ProductionOrdersService. */
const FINISHED_PI_CTE = Prisma.sql`finished_pi AS (
  SELECT i."productionInvoiceId" AS pid
  FROM production_orders o JOIN production_invoice_items i ON i.id = o."productionInvoiceItemId"
  WHERE i."productionInvoiceId" IS NOT NULL
  GROUP BY 1 HAVING bool_and(o."floorStage" = 'FINISHED'))`;

export const DATA_HEALTH_CHECKS: DataHealthCheck[] = [
  {
    code: 'STOCK_LEDGER_MISMATCH',
    title: 'Tồn kho lệch sổ cái',
    severity: 'HIGH',
    description:
      'Số tồn đang hiện khác tổng nhập − xuất trong sổ cái. Tồn được hệ thống tự cộng theo sổ cái nên lệch nghĩa là có ai sửa thẳng dữ liệu hoặc có lỗi ghi sổ.',
    hint: 'Đối chiếu sổ cái của vật tư đó; sửa bằng bút toán điều chỉnh, không sửa tay bảng tồn.',
    columns: [
      { key: 'kho', label: 'Kho' },
      { key: 'vat_tu', label: 'Vật tư' },
      { key: 'ten', label: 'Tên' },
      { key: 'chieu_dai', label: 'Dài (mm)' },
      { key: 'quy_cach', label: 'Quy cách' },
      { key: 'ton_kho', label: 'Tồn đang hiện' },
      { key: 'so_cai', label: 'Theo sổ cái' },
    ],
    sql: Prisma.sql`
      WITH led AS (
        SELECT wh, "materialId", "stockLengthMm", spec, SUM(q) AS qty FROM (
          SELECT "toWarehouseId" AS wh, "materialId", "stockLengthMm", spec, qty AS q FROM stock_ledger WHERE ${MATERIAL_ROW}
          UNION ALL
          SELECT "fromWarehouseId", "materialId", "stockLengthMm", spec, -qty FROM stock_ledger WHERE ${MATERIAL_ROW}
        ) x GROUP BY 1, 2, 3, 4
      ), quant AS (
        SELECT "warehouseId" AS wh, "materialId", "stockLengthMm", spec, SUM(qty) AS qty
        FROM stock_quant WHERE ${MATERIAL_ROW} GROUP BY 1, 2, 3, 4
      ), k AS (
        SELECT wh, "materialId", "stockLengthMm", spec FROM led
        UNION SELECT wh, "materialId", "stockLengthMm", spec FROM quant
      )
      SELECT concat('wh:', w.id, '|mat:', m.id, '|len:', k."stockLengthMm", '|spec:', k.spec) AS entity_key,
        w.code AS kho, m.code AS vat_tu, m.name AS ten, k."stockLengthMm" AS chieu_dai, k.spec AS quy_cach,
        COALESCE(quant.qty, 0) AS ton_kho, COALESCE(led.qty, 0) AS so_cai
      FROM k
      LEFT JOIN led USING (wh, "materialId", "stockLengthMm", spec)
      LEFT JOIN quant USING (wh, "materialId", "stockLengthMm", spec)
      JOIN warehouses w ON w.id = k.wh
      JOIN materials m ON m.id = k."materialId"
      WHERE NOT w."isVirtual" AND COALESCE(quant.qty, 0) <> COALESCE(led.qty, 0)
      ORDER BY w.code, m.code
      LIMIT ${ROW_LIMIT}`,
  },
  {
    code: 'NEGATIVE_STOCK',
    title: 'Tồn kho âm',
    severity: 'HIGH',
    description: 'Kho thật đang có số tồn nhỏ hơn 0 - đã xuất nhiều hơn số từng nhập.',
    hint: 'Tìm phiếu xuất/nhập thiếu hoặc nhập sai kho; bổ sung bằng nhập điều chỉnh.',
    columns: [
      { key: 'kho', label: 'Kho' },
      { key: 'vat_tu', label: 'Vật tư' },
      { key: 'ten', label: 'Tên' },
      { key: 'chieu_dai', label: 'Dài (mm)' },
      { key: 'quy_cach', label: 'Quy cách' },
      { key: 'ton_kho', label: 'Tồn' },
    ],
    sql: Prisma.sql`
      SELECT concat('wh:', w.id, '|mat:', m.id, '|len:', sq."stockLengthMm", '|spec:', sq.spec) AS entity_key,
        w.code AS kho, m.code AS vat_tu, m.name AS ten, sq."stockLengthMm" AS chieu_dai, sq.spec AS quy_cach, sq.qty AS ton_kho
      FROM stock_quant sq
      JOIN warehouses w ON w.id = sq."warehouseId"
      JOIN materials m ON m.id = sq."materialId"
      WHERE NOT w."isVirtual" AND sq.qty < 0 AND ${MATERIAL_ROW}
      ORDER BY w.code, m.code
      LIMIT ${ROW_LIMIT}`,
  },
  {
    code: 'RESERVED_OVER_STOCK',
    title: 'Hàng đang giữ nhiều hơn tồn thật',
    severity: 'HIGH',
    description:
      'Tổng phần đang giữ cho các PI (và phiếu chuyển kho) lớn hơn số đang có trong kho - tồn khả dụng của mọi PI về 0, xuất kho bị chặn.',
    hint: 'Xem các dòng giữ của vật tư đó: dòng nào của PI đã xong/huỷ hoặc giữ thừa thì nhả.',
    columns: [
      { key: 'kho', label: 'Kho' },
      { key: 'vat_tu', label: 'Vật tư' },
      { key: 'ten', label: 'Tên' },
      { key: 'chieu_dai', label: 'Dài (mm)' },
      { key: 'quy_cach', label: 'Quy cách' },
      { key: 'dang_giu', label: 'Đang giữ' },
      { key: 'ton_kho', label: 'Tồn' },
    ],
    sql: Prisma.sql`
      WITH held AS (
        SELECT "warehouseId", "materialId", "stockLengthMm", spec, SUM(quantity - "consumedQty") AS qty
        FROM stock_reservations WHERE status = 'ACTIVE' AND quantity > "consumedQty" GROUP BY 1, 2, 3, 4
        UNION ALL
        SELECT "warehouseId", "materialId", 0, spec, SUM(quantity)
        FROM warehouse_transfer_reservations WHERE status = 'ACTIVE' GROUP BY 1, 2, 3, 4
      ), tot AS (
        SELECT "warehouseId", "materialId", "stockLengthMm", spec, SUM(qty) AS qty FROM held GROUP BY 1, 2, 3, 4
      ), quant AS (
        SELECT "warehouseId", "materialId", "stockLengthMm", spec, SUM(qty) AS qty
        FROM stock_quant WHERE ${MATERIAL_ROW} GROUP BY 1, 2, 3, 4
      )
      SELECT concat('wh:', w.id, '|mat:', m.id, '|len:', t."stockLengthMm", '|spec:', t.spec) AS entity_key,
        w.code AS kho, m.code AS vat_tu, m.name AS ten, t."stockLengthMm" AS chieu_dai, t.spec AS quy_cach,
        t.qty AS dang_giu, COALESCE(quant.qty, 0) AS ton_kho
      FROM tot t
      LEFT JOIN quant USING ("warehouseId", "materialId", "stockLengthMm", spec)
      JOIN warehouses w ON w.id = t."warehouseId"
      JOIN materials m ON m.id = t."materialId"
      WHERE t.qty > COALESCE(quant.qty, 0)
      ORDER BY w.code, m.code
      LIMIT ${ROW_LIMIT}`,
  },
  {
    code: 'FINISHED_PI_HOLDING',
    title: 'PI đã Kết thúc mà vẫn giữ hàng dư',
    severity: 'MEDIUM',
    description:
      'Mọi lệnh của PI đã "Kết thúc" nhưng phần giữ còn dư vẫn đứng tên PI - chặn oan PI khác xuất số tồn thật đó. Từ 28/10 hệ thống tự nhả lúc bấm Kết thúc lệnh cuối; PI kết thúc trước đó cần nhả bù.',
    hint: 'Báo kỹ thuật nhả bù phần giữ còn dư của PI (chưa có nút trong app).',
    columns: [
      { key: 'pi', label: 'PI' },
      { key: 'vat_tu', label: 'Vật tư' },
      { key: 'ten', label: 'Tên' },
      { key: 'loai_giu', label: 'Loại giữ' },
      { key: 'con_giu', label: 'Còn giữ' },
    ],
    sql: Prisma.sql`
      WITH ${FINISHED_PI_CTE}
      SELECT concat('res:', r.id) AS entity_key, p.code AS pi, m.code AS vat_tu, m.name AS ten,
        r."refType"::text AS loai_giu, r.quantity - r."consumedQty" AS con_giu
      FROM finished_pi f
      JOIN production_invoices p ON p.id = f.pid
      JOIN stock_reservations r ON r."productionInvoiceId" = f.pid AND r.status = 'ACTIVE' AND r.quantity > r."consumedQty"
      JOIN materials m ON m.id = r."materialId"
      ORDER BY p.code, m.code
      LIMIT ${ROW_LIMIT}`,
  },
  {
    code: 'RESERVATION_OVERCONSUMED',
    title: 'Đã rút nhiều hơn phần giữ',
    severity: 'MEDIUM',
    description:
      'Một dòng giữ chỗ có số đã rút lớn hơn số đã giữ - sổ giữ chỗ sai, tồn khả dụng tính sai theo.',
    hint: 'Xem lịch sử xuất của PI/vật tư đó để tìm lượt xuất ghi trùng.',
    columns: [
      { key: 'pi', label: 'PI' },
      { key: 'vat_tu', label: 'Vật tư' },
      { key: 'loai_giu', label: 'Loại giữ' },
      { key: 'da_giu', label: 'Đã giữ' },
      { key: 'da_rut', label: 'Đã rút' },
    ],
    sql: Prisma.sql`
      SELECT concat('res:', r.id) AS entity_key, p.code AS pi, m.code AS vat_tu, r."refType"::text AS loai_giu,
        r.quantity AS da_giu, r."consumedQty" AS da_rut
      FROM stock_reservations r
      JOIN materials m ON m.id = r."materialId"
      LEFT JOIN production_invoices p ON p.id = r."productionInvoiceId"
      WHERE r."consumedQty" > r.quantity
      ORDER BY p.code, m.code
      LIMIT ${ROW_LIMIT}`,
  },
  {
    code: 'FINISHED_PI_OPEN_PURCHASE',
    title: 'PI đã Kết thúc còn đơn mua đang nhận dở',
    severity: 'MEDIUM',
    description:
      'Mọi lệnh của PI đã "Kết thúc" nhưng còn dòng đề xuất mua đang nhận (PURCHASING). Hàng về sau đó có thể làm lỗi lượt nhận hàng (giữ chỗ của PI đã nhả).',
    hint: 'Hỏi Mua hàng: còn nhận tiếp không? Không thì đóng dòng mua; còn thì báo kỹ thuật trước khi nhận.',
    columns: [
      { key: 'pi', label: 'PI' },
      { key: 'vat_tu', label: 'Vật tư' },
      { key: 'ten', label: 'Tên' },
      { key: 'can_mua', label: 'Cần mua' },
      { key: 'da_nhan', label: 'Đã nhận' },
    ],
    sql: Prisma.sql`
      WITH ${FINISHED_PI_CTE}
      SELECT concat('ppi:', it.id) AS entity_key, p.code AS pi, m.code AS vat_tu, m.name AS ten,
        it."buyQty" AS can_mua, it."receivedQty" AS da_nhan
      FROM finished_pi f
      JOIN production_invoices p ON p.id = f.pid
      JOIN purchase_proposals pp ON pp."productionInvoiceId" = f.pid
      JOIN purchase_proposal_items it ON it."proposalId" = pp.id AND it.status = 'PURCHASING'
      JOIN materials m ON m.id = it."materialId"
      ORDER BY p.code, m.code
      LIMIT ${ROW_LIMIT}`,
  },
  {
    code: 'PI_WITHOUT_PURCHASE',
    title: 'PI đã có lệnh sản xuất nhưng không có đề xuất mua',
    severity: 'MEDIUM',
    description:
      'Duyệt PI tự tạo đề xuất mua + giữ chỗ vật tư, nhưng bước đó chạy kiểu "lỗi thì chỉ ghi log". Không có đề xuất mua nghĩa là bước đó đã hỏng - vật tư của PI không ai mua, không ai giữ.',
    hint: 'Báo kỹ thuật chạy lại bước tạo đề xuất mua cho PI.',
    columns: [
      { key: 'pi', label: 'PI' },
      { key: 'so_lenh', label: 'Số lệnh SX' },
    ],
    sql: Prisma.sql`
      SELECT concat('pi:', p.id) AS entity_key, p.code AS pi, COUNT(DISTINCT o.id)::int AS so_lenh
      FROM production_invoices p
      JOIN production_invoice_items i ON i."productionInvoiceId" = p.id
      JOIN production_orders o ON o."productionInvoiceItemId" = i.id
      WHERE NOT EXISTS (SELECT 1 FROM purchase_proposals pp WHERE pp."productionInvoiceId" = p.id)
      GROUP BY p.id, p.code
      ORDER BY p.code
      LIMIT ${ROW_LIMIT}`,
  },
  {
    // Người dùng chốt Q7 (32.27): mỗi vật tư mua có đúng 1 NV mua phụ trách, không trùng nhau - thiếu người là quên khai báo.
    code: 'MATERIAL_WITHOUT_BUYER',
    title: 'Vật tư mua chưa có người mua phụ trách',
    severity: 'MEDIUM',
    description:
      'Vật tư đang hoạt động trong danh mục chưa gán "Nhân viên mua hàng" (mỗi vật tư mua có đúng 1 NV mua phụ trách) - tin sáng "vật tư cần về" không tới NV mua nào (chỉ thủ kho nhận). Không tính vật tư thành phẩm (vd Chân nhôm do Phôi cắt từ Thanh nhôm): loại này không mua nên không cần người mua.',
    hint: 'Admin mở Danh mục > Vật tư, sửa dòng đó và chọn "Nhân viên mua hàng".',
    columns: [
      { key: 'vat_tu', label: 'Vật tư' },
      { key: 'ten', label: 'Tên' },
      { key: 'nhom', label: 'Nhóm' },
      { key: 'kho', label: 'Kho' },
    ],
    sql: Prisma.sql`
      SELECT concat('mat:', m.id) AS entity_key, m.code AS vat_tu, m.name AS ten, g.name AS nhom, w.code AS kho
      FROM materials m
      LEFT JOIN material_groups g ON g.id = m."materialGroupId"
      LEFT JOIN warehouses w ON w.id = m."warehouseId"
      WHERE m."deletedAt" IS NULL AND m."isActive" AND m."buyerId" IS NULL
        AND m."steelSubGroup" IS DISTINCT FROM 'FINISHED_COMPONENT'
      ORDER BY m.code
      LIMIT ${ROW_LIMIT}`,
  },
  {
    code: 'MILESTONE_ORDER',
    title: 'Mốc thời gian sai thứ tự',
    severity: 'LOW',
    description:
      'Mốc trước muộn hơn mốc sau theo thứ tự Phú An (Mua VT khung & đan → Phôi → Hàn → Sơn → Khung → Đan → Chuyền kiểm → Đóng gói → Hạn giao; Mua VT còn lại trước Đóng gói). Chỉ xét PI chưa Kết thúc hết.',
    hint: 'KHSX mở "Sửa thời hạn" của SKU và chỉnh lại các mốc.',
    columns: [
      { key: 'pi', label: 'PI' },
      { key: 'sku', label: 'SKU' },
      { key: 'sai', label: 'Sai ở' },
    ],
    sql: Prisma.sql`
      WITH ${FINISHED_PI_CTE}, s AS (
        SELECT i.id, p.code AS pi, mp."factoryCode" AS sku,
          i."materialDeadline"::date AS vt_khung, i."finishedMaterialDeadline"::date AS vt_con_lai,
          i."deliveryDeadline"::date AS giao,
          MAX(st.deadline::date) FILTER (WHERE st."stageType"::text = 'FRAME_PHOI') AS phoi,
          MAX(st.deadline::date) FILTER (WHERE st."stageType"::text = 'FRAME_HAN') AS han,
          MAX(st.deadline::date) FILTER (WHERE st."stageType"::text = 'FRAME_SON') AS son,
          MAX(st.deadline::date) FILTER (WHERE st."stageType"::text = 'FRAME') AS khung,
          MAX(st.deadline::date) FILTER (WHERE st."stageType"::text = 'WEAVING') AS dan,
          MAX(st.deadline::date) FILTER (WHERE st."stageType"::text = 'TRANSFER_CHECK') AS chuyen_kiem,
          MAX(st.deadline::date) FILTER (WHERE st."stageType"::text = 'PACKAGING') AS dong_goi
        FROM production_invoice_items i
        JOIN production_invoices p ON p.id = i."productionInvoiceId"
        LEFT JOIN mfg_products mp ON mp.id = i."mfgProductId"
        LEFT JOIN production_invoice_item_stages st ON st."productionInvoiceItemId" = i.id
        WHERE NOT EXISTS (SELECT 1 FROM finished_pi f WHERE f.pid = i."productionInvoiceId")
        GROUP BY i.id, p.code, mp."factoryCode"
      ), e AS (
        SELECT id, pi, sku, concat_ws(', ',
          CASE WHEN vt_khung > COALESCE(phoi, khung) THEN 'Mua VT khung & đan sau Phôi' END,
          CASE WHEN phoi > han THEN 'Phôi sau Hàn' END,
          CASE WHEN han > son THEN 'Hàn sau Sơn' END,
          CASE WHEN son > khung THEN 'Sơn sau Khung' END,
          CASE WHEN khung > dan THEN 'Khung sau Đan' END,
          CASE WHEN dan > chuyen_kiem THEN 'Đan sau Chuyền kiểm' END,
          CASE WHEN chuyen_kiem > dong_goi THEN 'Chuyền kiểm sau Đóng gói' END,
          CASE WHEN vt_con_lai > dong_goi THEN 'Mua VT còn lại sau Đóng gói' END,
          CASE WHEN dong_goi > giao THEN 'Đóng gói sau Hạn giao' END) AS sai
        FROM s
      )
      SELECT concat('item:', id) AS entity_key, pi, sku, sai FROM e
      WHERE sai <> ''
      ORDER BY pi, sku
      LIMIT ${ROW_LIMIT}`,
  },
];
