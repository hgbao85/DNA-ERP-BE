import { MfgRole, PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES, PermissionModule } from './permission-modules.constant';
import { BUSINESS_ROLES, BusinessRole } from './roles.constant';

/**
 * A grant = a module + which actions on it. `'ALL'` expands to every PermissionAction.
 * The `module` field is typed as PermissionModule, so a grant can only reference a module
 * that already exists in PERMISSION_MODULES - you literally cannot write a grant for a
 * module a future phase hasn't registered yet (it won't type-check). That is intentional.
 */
export interface ModuleGrant {
  module: PermissionModule;
  actions: PermissionAction[] | 'ALL';
}

/**
 * Granted to EVERY business role: any authenticated staff member can read the
 * notifications targeted at them. Keeps a freshly-seeded business role from being a
 * completely empty shell before its domain modules land.
 */
export const UNIVERSAL_BUSINESS_GRANTS: ModuleGrant[] = [
  { module: PERMISSION_MODULES.NOTIFICATION, actions: [PermissionAction.VIEW] },
];

/**
 * SINGLE SOURCE OF TRUTH for "what can role X do". As each backend phase lands and adds
 * its module to PERMISSION_MODULES, uncomment / add that module's grant to the relevant
 * role here - do NOT scatter permission-granting across modules/migrations. The seed
 * SYNCS each managed role to exactly this set (adds missing + removes extra) on every run.
 *
 * BOSS is intentionally NOT listed: it is derived in the seed as VIEW+APPROVE across every
 * module, so it auto-covers modules added by future phases without editing this file.
 *
 * At Phase 1 the only business modules that exist are NOTIFICATION / SYSTEM_CONFIG, so most
 * roles carry only the universal NOTIFICATION:VIEW. The commented blocks are the template
 * for the phase that introduces each module (module names must be added to
 * PERMISSION_MODULES first, or the grant won't compile).
 */
export const ROLE_GRANTS: Partial<Record<BusinessRole, ModuleGrant[]>> = {
  // --- Sales Order + Production Order domain ---
  // Sales tạo/sửa đơn hàng và dòng SKU của đơn. CUSTOMER: ALL vì Sales tự quản lý khách
  // hàng của mình (thêm/sửa/xoá) ngay trên CustomerManagementPage, không chỉ đọc để chọn.
  [BUSINESS_ROLES.SALES_STAFF]: [
    { module: PERMISSION_MODULES.SALES_ORDER, actions: 'ALL' },
    { module: PERMISSION_MODULES.CUSTOMER, actions: 'ALL' },
    // resolve-or-create sản phẩm theo mã SKU khi tạo dòng PO (xem resolveMfgProduct ở FE).
    {
      module: PERMISSION_MODULES.PRODUCT,
      actions: [PermissionAction.VIEW, PermissionAction.CREATE],
    },
    // Việc 2: ô chọn SKU khi tạo PO (OrderManagementPage) chỉ liệt kê SKU đã APPROVED -
    // gọi GET /skus để dựng danh sách; thiếu quyền này ô chọn SKU luôn rỗng.
    {
      module: PERMISSION_MODULES.SKU,
      actions: [PermissionAction.VIEW],
    },
  ],
  // KHSX: tạo PlanForm + tự duyệt/từ chối từng nhóm mảnh-chi tiết và 2 mốc approve-parts/
  // approve-detail (APPROVE) - KHÔNG có UPDATE trên SKU vì nhập định mức (manh-quota/
  // detail-quota) là việc của 4 account chuyên trách (SPEC_*_STAFF, xem bên dưới), không phải
  // KHSX. Chỉ VIEW SalesOrder (không sửa đơn của Sales); tạo/sửa PI nhưng KHÔNG duyệt sản
  // xuất từng item (đó là QLSX/Sếp, xem PRODUCTION_MANAGER + RequireRole('BOSS') ở controller)
  // - PRODUCTION_INVOICE ở đây cố tình không có APPROVE.
  [BUSINESS_ROLES.PRODUCTION_PLANNER]: [
    {
      module: PERMISSION_MODULES.SKU,
      actions: [
        PermissionAction.VIEW,
        PermissionAction.CREATE,
        PermissionAction.APPROVE,
        PermissionAction.DELETE,
      ],
    },
    { module: PERMISSION_MODULES.SALES_ORDER, actions: [PermissionAction.VIEW] },
    {
      module: PERMISSION_MODULES.PRODUCTION_INVOICE,
      actions: [PermissionAction.VIEW, PermissionAction.CREATE, PermissionAction.UPDATE],
    },
    // tạo SKU mới khi nhập "Duyệt SKU" (SKUReviewPage) trước khi tạo PlanForm cho SKU đó.
    {
      module: PERMISSION_MODULES.PRODUCT,
      actions: [PermissionAction.VIEW, PermissionAction.CREATE],
    },
    // SKUReviewPage gọi getSalesCustomers (GET /customers) ngay khi mount cho MỌI role kể cả
    // KHSX (cùng lý do đã thêm cho SALES_STAFF/PRODUCTION_MANAGER) - thiếu quyền này thì tab
    // "Duyệt SKU mới" luôn lỗi 403.
    {
      module: PERMISSION_MODULES.CUSTOMER,
      actions: [PermissionAction.VIEW],
    },
    // Click vào 1 SKU trong SKUReviewPage mở ThongKePagePlan ("Bảng thống kê") - trang này gọi
    // GET /weaving-points để dựng execution stage của công đoạn Dệt (genExecutionStages), thiếu
    // quyền này crash cả trang với lỗi "Missing required permission(s): WEAVING_POINT:VIEW".
    {
      module: PERMISSION_MODULES.WEAVING_POINT,
      actions: [PermissionAction.VIEW],
    },
    // Phase 3: "KHSX kiểm tra vật tư" (dna-erp-db-schema.html mục 0, node k2) đọc GET
    // /stock-quant để biết tồn kho hiện tại trước khi xác nhận sản xuất - chỉ VIEW, KHSX
    // không tự ghi/điều chỉnh kho.
    {
      module: PERMISSION_MODULES.STOCK,
      actions: [PermissionAction.VIEW],
    },
    // Phase 10 (2026-08-12): KHSX là người tạo Lệnh kiểm tra vật tư + bấm "Bắt đầu sản xuất"
    // (CREATE+UPDATE), và cũng là người duy nhất tạo đề xuất mua thủ công từ kho thiếu vật tư
    // (PURCHASE_PROPOSAL:CREATE - chỉ role này có action CREATE trên module đó, khác thủ
    // kho/Mua hàng chỉ VIEW/UPDATE, xem PurchaseProposalsController).
    {
      module: PERMISSION_MODULES.MATERIAL_INSPECTION,
      actions: [PermissionAction.VIEW, PermissionAction.CREATE, PermissionAction.UPDATE],
    },
    // VIEW thêm 2026-08-12 (gộp chung mục với CREATE ở trên - CỐ Ý không tách 2 mục cùng module
    // cho 1 role, resolveGrants() gộp hết vào 1 Set nên trùng vẫn chạy đúng, nhưng để 2 mục là
    // mời người sau "dọn trùng" và xoá mất 1 quyền): tab "Bảng thống kê" (ThongKePagePlan,
    // ProductionPlanApp.tsx:81) có mục Mua hàng hiển thị NCC đã chọn/đơn giá/đã mua của từng vật
    // tư - đọc từ GET /purchase-proposals. Thiếu VIEW thì mục đó TRỐNG vĩnh viễn mà không báo
    // lỗi gì (403 bị .catch() nuốt, xem InspectionContext.tsx) - cùng loại lỗi đã gặp với
    // SKUReviewPage ở trên, phát hiện lại khi test E2E. KHSX tạo được đề xuất nhưng KHÔNG báo
    // giá/duyệt mua (không có UPDATE/APPROVE).
    {
      module: PERMISSION_MODULES.PURCHASE_PROPOSAL,
      actions: [PermissionAction.VIEW, PermissionAction.CREATE],
    },
    // 2026-08-12: KHSX đọc GET /cutting-batch-suggestions (màn "Gộp đợt cắt" + badge trên menu)
    // để biết loại sắt nào vượt ngưỡng hao hụt và gộp với đơn nào thì đạt. CHỈ VIEW - quyết định
    // gộp/duyệt phương án cắt vẫn là của QLSX/Sếp (xem PRODUCTION_MANAGER có thêm CREATE+APPROVE).
    {
      module: PERMISSION_MODULES.CUTTING_PROPOSAL,
      actions: [PermissionAction.VIEW],
    },
  ],
  // QLSX: bước duyệt cục bộ SKU (qlsx-review/request-boss-approval/reject-qlsx) đã bị bỏ khỏi
  // pipeline - QLSX chỉ còn VIEW trên SKU (tab "Danh sách SKU" đọc-only). QLSX vẫn duyệt PI
  // item (APPROVE trên PRODUCTION_INVOICE) - route đó gắn thêm @RequireMfgRole(PRODUCTION_MANAGER)
  // để tách khỏi bước duyệt CUỐI của Sếp, vốn dùng CHÍNH action APPROVE này nhưng gắn thêm
  // @RequireRole('BOSS') (xem production-invoices controller).
  [BUSINESS_ROLES.PRODUCTION_MANAGER]: [
    {
      module: PERMISSION_MODULES.SKU,
      actions: [PermissionAction.VIEW],
    },
    {
      module: PERMISSION_MODULES.PRODUCTION_INVOICE,
      actions: [PermissionAction.VIEW, PermissionAction.APPROVE],
    },
    // LenhSXPage: QLSX chọn kho thành phẩm từ danh sách tài khoản thủ kho (role=WAREHOUSE_STAFF,
    // warehouseScope=thành phẩm) trước khi gửi sếp duyệt - gọi GET /users, thiếu quyền này ô
    // chọn kho luôn rỗng ("Không có kho thành phẩm").
    {
      module: PERMISSION_MODULES.USER,
      actions: [PermissionAction.VIEW],
    },
    // SKUReviewPage (tab "Duyệt SKU mới") gọi getSkuOptions (GET /sales-orders + /products)
    // và getSalesCustomers (GET /customers) ngay khi mount cho MỌI role kể cả QLSX, dù nút Tạo
    // SKU (nơi tiêu thụ data này) đã ẩn với QLSX - thiếu 3 quyền VIEW này thì tab luôn lỗi 403.
    {
      module: PERMISSION_MODULES.SALES_ORDER,
      actions: [PermissionAction.VIEW],
    },
    {
      module: PERMISSION_MODULES.PRODUCT,
      actions: [PermissionAction.VIEW],
    },
    {
      module: PERMISSION_MODULES.CUSTOMER,
      actions: [PermissionAction.VIEW],
    },
    // MfgApp tab "Kế hoạch" mở ThongKePagePlan cho QLSX (isProdMgr) - cùng lý do đã thêm cho
    // PRODUCTION_PLANNER: trang gọi GET /weaving-points, thiếu quyền này crash cả trang.
    {
      module: PERMISSION_MODULES.WEAVING_POINT,
      actions: [PermissionAction.VIEW],
    },
    // Phase 7: ProductionOrder tự sinh khi Sếp duyệt PI item (không có CREATE thủ công ở bản
    // này) - QLSX chỉ xem. CuttingProposal: QLSX xem + có thể bấm "Tính lại" (CREATE) + duyệt
    // phương án cắt cuối cùng (APPROVE) trước khi Phôi cắt theo.
    {
      module: PERMISSION_MODULES.PRODUCTION_ORDER,
      actions: [PermissionAction.VIEW],
    },
    {
      module: PERMISSION_MODULES.CUTTING_PROPOSAL,
      actions: [PermissionAction.VIEW, PermissionAction.CREATE, PermissionAction.APPROVE],
    },
    // MfgWarehousesPage (Tổng hợp kho): QLSX chỉ xem tồn kho - quyền "Thêm vật tư" (CREATE) đã
    // chuyển cho WAREHOUSE_STAFF (thủ kho là người biết rõ tồn vật lý thực tế của kho mình khi
    // khai báo Tồn kho ban đầu lúc tạo vật tư, xem MaterialsService.create()). WAREHOUSE:VIEW
    // để xem/tạo kho thành phẩm phụ (CREATE riêng do isAdmin-gated ở FE, không cần cấp thêm ở đây).
    {
      module: PERMISSION_MODULES.MATERIAL,
      actions: [PermissionAction.VIEW],
    },
    { module: PERMISSION_MODULES.WAREHOUSE, actions: [PermissionAction.VIEW] },
    { module: PERMISSION_MODULES.STOCK, actions: [PermissionAction.VIEW] },
    // Tab "Kế hoạch" của QLSX mở ThongKePagePlan (MfgApp.tsx:234) - cùng trang KHSX dùng, có
    // mục Mua hàng đọc GET /purchase-proposals. Xem ghi chú ở PRODUCTION_PLANNER phía trên
    // (phát hiện 2026-08-12 khi test E2E: thiếu quyền -> mục Mua hàng trống, không báo lỗi).
    // Chỉ VIEW - QLSX không tham gia báo giá/duyệt mua.
    {
      module: PERMISSION_MODULES.PURCHASE_PROPOSAL,
      actions: [PermissionAction.VIEW],
    },
  ],
  // --- Phase 3 (Kho vận lõi / Ledger Core) ---
  // WAREHOUSE_STAFF: kho nguồn tạo phiếu chuyển kho, kho đích xác nhận/từ chối (cả 2 thao tác
  // đều dùng chung permission WAREHOUSE_TRANSFER - phân biệt kho nào được thao tác qua
  // warehouseScope, enforce ở WarehouseTransfersService, không phải RBAC). STOCK:VIEW để tra
  // tồn kho khả dụng trước khi tạo phiếu; STOCK:UPDATE mở khoá đúng 1 endpoint POST
  // /stock-ledger/adjust ("ngoại lệ duy nhất", xem stock-ledger.controller.ts:26-27) - dùng
  // cho ô "Tồn" sửa nhanh trên bảng ở MfgWarehousesPage (thủ kho tự điền/sửa tồn kho vật tư đã
  // tạo sẵn). Cũng bị giới hạn theo warehouseScope (enforce ở StockLedgerService.adjust(), cùng
  // pattern WAREHOUSE_TRANSFER) để thủ kho không chỉnh được tồn kho ở kho mình không phụ trách.
  // MATERIAL:VIEW+CREATE + WAREHOUSE:VIEW để MfgWarehousesPage (Tổng hợp kho) liệt kê được vật
  // tư/kho thật của chính kho mình phụ trách, và tự thêm vật tư mới (kèm khai báo Tồn kho ban
  // đầu - MaterialsService.create()) - quyền CREATE này trước đây cấp cho QLSX, đã chuyển hẳn
  // sang thủ kho vì thủ kho mới là người biết rõ tồn vật lý thực tế của kho mình.
  // PURCHASE_PROPOSAL: VIEW+UPDATE (KHÔNG phải 'ALL') để NhapKhoPage.tsx xem đề xuất mua hàng
  // đang chờ và gọi POST .../items/:itemId/receive xác nhận đã nhận hàng - cố ý không cấp
  // APPROVE (duyệt đề xuất mua là việc của Sếp, không phải thủ kho).
  // SKU:VIEW để XuatKhoPage.tsx liệt kê SKU lúc xuất kho.
  // STEEL_ISSUE: CREATE+VIEW (Phase 9, 2026-08-11) - thủ kho trung tâm là người xuất sắt cho
  // Phôi (POST /production-orders/:id/steel-issues), KHÔNG phải PHOI_STAFF (đội Phôi chỉ
  // nhận/báo cắt - xem PHOI_STAFF bên dưới). Không có UPDATE/DELETE: sửa/hoàn tác 1 đợt đã xuất
  // chưa có endpoint ở bản này.
  // QC_REVIEW: chỉ UPDATE (fulfill/reject replenish-requests) - thủ kho là người cấp bù vật lý
  // khi KCS chấm phế, nhưng KHÔNG được tạo/tự duyệt qc-review (đó là việc của KCS_STAFF).
  // WEAVING_ISSUE: CREATE (xuất đan)+UPDATE (nhập đan)+VIEW (Phase 9b, 2026-08-11) - thủ kho
  // vật tư-TP là người duy nhất thực hiện cả 2 chiều Đan (không có mfgRole "Đan" - việc đan
  // diễn ra ở điểm đan NGOÀI, không phải 1 tổ trong xưởng, xem MFG_FLOOR_ROLES). Không cấp cho
  // PHOI_STAFF/HAN_STAFF/SON_STAFF/KCS_STAFF.
  // MATERIAL_ISSUE: chỉ CREATE+VIEW (Phase 9c, 2026-08-11) - thủ kho vật tư-TP là người cấp vật
  // tư tiêu hao (POST /production-orders/:id/material-issues), KHÔNG có UPDATE - "tổ xác nhận
  // nhận" là việc của HAN_STAFF/SON_STAFF (xem 2 role đó bên dưới), không phải thủ kho.
  [BUSINESS_ROLES.WAREHOUSE_STAFF]: [
    { module: PERMISSION_MODULES.STOCK, actions: [PermissionAction.VIEW, PermissionAction.UPDATE] },
    { module: PERMISSION_MODULES.WAREHOUSE_TRANSFER, actions: 'ALL' },
    {
      module: PERMISSION_MODULES.MATERIAL,
      actions: [PermissionAction.VIEW, PermissionAction.CREATE],
    },
    { module: PERMISSION_MODULES.WAREHOUSE, actions: [PermissionAction.VIEW] },
    {
      module: PERMISSION_MODULES.PURCHASE_PROPOSAL,
      actions: [PermissionAction.VIEW, PermissionAction.UPDATE],
    },
    { module: PERMISSION_MODULES.SKU, actions: [PermissionAction.VIEW] },
    {
      module: PERMISSION_MODULES.STEEL_ISSUE,
      actions: [PermissionAction.CREATE, PermissionAction.VIEW],
    },
    { module: PERMISSION_MODULES.QC_REVIEW, actions: [PermissionAction.UPDATE] },
    {
      module: PERMISSION_MODULES.WEAVING_ISSUE,
      actions: [PermissionAction.CREATE, PermissionAction.UPDATE, PermissionAction.VIEW],
    },
    {
      module: PERMISSION_MODULES.MATERIAL_ISSUE,
      actions: [PermissionAction.CREATE, PermissionAction.VIEW],
    },
    // Phase 10 (2026-08-12): thủ kho (3 kho vật lý, scope enforce ở MaterialInspectionService.
    // assertWarehouseScope()) xác nhận tồn kho thật cho Lệnh kiểm tra vật tư KHSX gửi tới
    // (UPDATE = submitKho). KHÔNG có CREATE - tạo request là việc của KHSX.
    {
      module: PERMISSION_MODULES.MATERIAL_INSPECTION,
      actions: [PermissionAction.VIEW, PermissionAction.UPDATE],
    },
    // Vá lỗ quyền có sẵn từ M2 "Chuyền kiểm" (2026-08-11, chưa từng cấp): thủ kho thành phẩm
    // cần VIEW+UPDATE trên PRODUCTION_INVOICE để gọi được GET/POST .../transfer-check VÀ
    // .../packaging (Đóng gói, Phase 10) - trước bản vá này chỉ QLSX/Sếp mới gọi được 2 nhóm
    // endpoint đó dù chúng thuộc đúng nghiệp vụ của thủ kho thành phẩm.
    {
      module: PERMISSION_MODULES.PRODUCTION_INVOICE,
      actions: [PermissionAction.VIEW, PermissionAction.UPDATE],
    },
    // Vá lỗ quyền có sẵn từ M2 "Phân bổ/nhận hàng đan" (2026-08-11, chưa từng cấp - phát hiện lúc
    // nối FE material-issues 2026-08-12): FE resolveProductionOrderId() (weaving-issues-api.ts,
    // material-issues-api.ts) phải gọi GET /production-orders?limit=100 để tra productionOrderId
    // từ productionInvoiceItemId (không có endpoint lọc theo item) - thiếu PRODUCTION_ORDER:VIEW
    // thì MỌI trang kho key theo productionOrderId (KhoXuatDanPage/KhoNhapDanPage,
    // XuatVatTuTieuHaoPage) đều 403 ngay bước resolve, trước cả khi chạm tới nghiệp vụ.
    {
      module: PERMISSION_MODULES.PRODUCTION_ORDER,
      actions: [PermissionAction.VIEW],
    },
    // Vá lỗ quyền phát hiện qua browser thật 2026-08-14: InboundWarehouseApp.tsx cho đúng
    // scope 'vat-tu-tp' tab "Quản lý điểm đan" (QuanLyDiemDanPage -> WeavingPointsPage,
    // readOnly=false) để thủ kho vật tư-TP tự thêm/sửa/xoá điểm đan gia công ngoài - nhưng
    // WAREHOUSE_STAFF chưa từng có WEAVING_POINT nên GET /weaving-points 403 ngay từ bước
    // load trang ("Missing required permission(s): WEAVING_POINT:VIEW"). 'ALL' (không chỉ
    // VIEW) vì trang có đủ nút Thêm/Sửa/Xoá, không phải chỉ xem như PRODUCTION_PLANNER/
    // PRODUCTION_MANAGER (2 role đó chỉ đọc weaving-points để dựng execution stage).
    {
      module: PERMISSION_MODULES.WEAVING_POINT,
      actions: 'ALL',
    },
  ],
  // 2 account chuyên trách nhập định mức SKU (Sắt = định mức mảnh; Phụ kiện/Bao bì = định mức
  // chi tiết, gồm cả Sơn) - chỉ UPDATE (nhập liệu qua manh-quota/detail-quota), không APPROVE
  // (duyệt là KHSX).
  // MATERIAL:VIEW (Việc 2) - MaterialPicker dùng chung ở cả 4 trang Spec gọi GET /materials
  // để chọn vật tư. Từ khi bỏ Material.kind, phân loại vật tư chuyển hoàn toàn sang
  // materialGroup.systemKey - cả 4 trang giờ đều gọi GET /material-groups để resolve id nhóm
  // hệ thống (Sắt/Dây/Đinh/Sơn/Phụ kiện/Bao bì), nên đều cần thêm MATERIAL_GROUP:VIEW.
  [BUSINESS_ROLES.SPEC_STEEL_STAFF]: [
    {
      module: PERMISSION_MODULES.SKU,
      actions: [PermissionAction.VIEW, PermissionAction.UPDATE],
    },
    {
      module: PERMISSION_MODULES.MATERIAL,
      actions: [PermissionAction.VIEW],
    },
    {
      module: PERMISSION_MODULES.MATERIAL_GROUP,
      actions: [PermissionAction.VIEW],
    },
  ],
  [BUSINESS_ROLES.SPEC_ACCESSORY_PACKAGING_STAFF]: [
    {
      module: PERMISSION_MODULES.SKU,
      actions: [PermissionAction.VIEW, PermissionAction.UPDATE],
    },
    {
      module: PERMISSION_MODULES.MATERIAL,
      actions: [PermissionAction.VIEW],
    },
    {
      module: PERMISSION_MODULES.MATERIAL_GROUP,
      actions: [PermissionAction.VIEW],
    },
  ],
  // --- Phase 9 (MES-B execution) ---
  // PHOI_STAFF chỉ UPDATE+VIEW trên STEEL_ISSUE (receive/complete-cutting/rework) - KHÔNG có
  // CREATE (xuất đợt là việc của thủ kho, xem WAREHOUSE_STAFF ở trên). Sửa lại 2026-08-11: bản
  // scaffold cũ (actions:'ALL') SAI - đã xác nhận lại nghiệp vụ, PHOI_STAFF không tự xuất sắt
  // cho mình. PRODUCTION_BATCH nay đã tồn tại (Phase 9d) nhưng KHÔNG cấp cho PHOI_STAFF - báo
  // sản lượng chỉ dành cho Hàn/Sơn, Phôi báo qua LenhSanXuatPhoi (mock, chưa nối module riêng).
  // WORK_SESSION vẫn chưa tồn tại (xem comment schema.prisma "Phase 9d" - không triển khai vì
  // mock không có khái niệm ca làm việc để validate).
  [BUSINESS_ROLES.PHOI_STAFF]: [
    {
      module: PERMISSION_MODULES.STEEL_ISSUE,
      actions: [PermissionAction.UPDATE, PermissionAction.VIEW],
    },
    // Vá lỗ quyền phát hiện lúc nối FE KhoPhoiPage (2026-08-14, xem docs/quy-doi-doan-phoi.md):
    // trang đọc GET /stock-quant (segmentSpecId) để hiện tồn đoạn sắt thật - PHOI_STAFF trước
    // bản vá này không có STOCK:VIEW nên 403 âm thầm ngay từ lời gọi đầu tiên. Chỉ VIEW - thủ kho
    // (WAREHOUSE_STAFF, đã có STOCK:VIEW+UPDATE) mới là người ghi tồn qua stock-ledger/adjust.
    {
      module: PERMISSION_MODULES.STOCK,
      actions: [PermissionAction.VIEW],
    },
    // Vá lỗ quyền phát hiện lúc nối FE XacNhanSanLuongPage (M3, báo cắt xong theo đúng pattern
    // đã duyệt): completeCutting() cần proposalPatternId thật (CuttingProposalPatternResponseDto.id,
    // vừa lộ ra) để dựng đúng segments của bundle - PHOI_STAFF trước bản vá này không có cách nào
    // đọc CuttingProposal (GET production-orders/:id/cutting-proposals rồi GET cutting-proposals/:id)
    // dù đã biết productionOrderId từ chính SteelIssue của mình (không cần PRODUCTION_ORDER:VIEW).
    // Chỉ VIEW - Phôi không tự tạo/duyệt phương án cắt.
    {
      module: PERMISSION_MODULES.CUTTING_PROPOSAL,
      actions: [PermissionAction.VIEW],
    },
    // Vá lỗ quyền phát hiện qua browser thật 2026-08-13: LenhSanXuatPhoi/XacNhanSanLuongPage gọi
    // getQcReviewsForSteelIssues() (GET /qc-reviews?limit=100) để hiện cột "Đã KCS đạt" - PHOI_STAFF
    // trước bản vá này không có QC_REVIEW:VIEW nên 2 trang đều 403 âm thầm ở lời gọi này (không chặn
    // trang, chỉ mất cột). Chỉ VIEW - duyệt (QC_REVIEW ghi) vẫn là việc riêng của KCS_STAFF, xem
    // comment ở trên.
    {
      module: PERMISSION_MODULES.QC_REVIEW,
      actions: [PermissionAction.VIEW],
    },
  ],
  // HAN_STAFF/SON_STAFF (Phase 9c+9d, 2026-08-11). MATERIAL_ISSUE: chỉ UPDATE+VIEW (POST
  // /material-issues/:id/receive, "tổ xác nhận nhận") - KHÔNG có CREATE, cấp vật tư là việc của
  // WAREHOUSE_STAFF (xem ở trên). PRODUCTION_BATCH: CREATE+VIEW (POST
  // /production-orders/:id/production-batches, "báo sản lượng") - KHÔNG có UPDATE, duyệt
  // (QC_REVIEW) là việc của KCS_STAFF, không phải tự duyệt.
  [BUSINESS_ROLES.HAN_STAFF]: [
    {
      module: PERMISSION_MODULES.MATERIAL_ISSUE,
      actions: [PermissionAction.UPDATE, PermissionAction.VIEW],
    },
    {
      module: PERMISSION_MODULES.PRODUCTION_BATCH,
      actions: [PermissionAction.CREATE, PermissionAction.VIEW],
    },
    // Vá lỗ quyền phát hiện lúc nối FE LenhSanXuatHan (M3, báo sản lượng): trước bản vá này
    // HAN_STAFF không có cách nào biết trước productionOrderId nào để gọi GET .../production-
    // batch-plan (partId thật) - cùng tiền lệ đã cấp cho WAREHOUSE_STAFF (role-permissions này,
    // "Vá lỗ quyền có sẵn từ M2 Phân bổ/nhận hàng đan"). Chỉ VIEW - HAN_STAFF không tự tạo/sửa
    // ProductionOrder.
    {
      module: PERMISSION_MODULES.PRODUCTION_ORDER,
      actions: [PermissionAction.VIEW],
    },
  ],
  [BUSINESS_ROLES.SON_STAFF]: [
    {
      module: PERMISSION_MODULES.MATERIAL_ISSUE,
      actions: [PermissionAction.UPDATE, PermissionAction.VIEW],
    },
    {
      module: PERMISSION_MODULES.PRODUCTION_BATCH,
      actions: [PermissionAction.CREATE, PermissionAction.VIEW],
    },
    // Cùng lý do đã thêm cho HAN_STAFF ở trên.
    {
      module: PERMISSION_MODULES.PRODUCTION_ORDER,
      actions: [PermissionAction.VIEW],
    },
  ],
  // KCS_STAFF toàn quyền QC_REVIEW (tạo qc-review + tạo replenish-request, đều qua action
  // CREATE/UPDATE của module này - xem QcReviewsController) - fulfill/reject request thuộc về
  // WAREHOUSE_STAFF (cấp bù vật lý), không phải KCS. Nhánh productionBatchId (Phase 9d,
  // POST /production-batches/:id/qc-review) dùng CHUNG permission QC_REVIEW này, không cần cấp
  // thêm gì - đúng thiết kế gốc "2 endpoint riêng ở tầng REST chỉ để URL rõ ràng, service dùng
  // chung logic". REPLENISH_REQUEST không phải module riêng -
  // dùng chung QC_REVIEW (đúng thiết kế gốc docs/dna-erp-backend-implementation-plan.html 9.2:
  // "2 endpoint riêng ở tầng REST chỉ để URL rõ ràng, service dùng chung logic").
  [BUSINESS_ROLES.KCS_STAFF]: [
    {
      module: PERMISSION_MODULES.QC_REVIEW,
      actions: [PermissionAction.CREATE, PermissionAction.VIEW, PermissionAction.UPDATE],
    },
    // Vá lỗ quyền phát hiện lúc nối FE KcsStagePage (M3): KCS_STAFF chưa từng có
    // PRODUCTION_BATCH:VIEW nên không gọi được cả GET /production-batches (flat, mới thêm) lẫn
    // GET production-orders/:id/production-batches cũ - không có cách nào xem lô Hàn/Sơn đang chờ
    // duyệt. Chỉ VIEW, không CREATE (KCS không tự báo sản lượng).
    {
      module: PERMISSION_MODULES.PRODUCTION_BATCH,
      actions: [PermissionAction.VIEW],
    },
    // Vá lỗ quyền phát hiện lúc nối FE KcsPhoiPage (M3, cùng tiền lệ PRODUCTION_BATCH:VIEW ở trên):
    // KCS_STAFF chưa từng có STEEL_ISSUE:VIEW nên không gọi được GET /steel-issues (flat, mới thêm)
    // để xem đợt Phôi đang AWAITING_QC. Chỉ VIEW - KCS không tự xuất/nhận sắt.
    {
      module: PERMISSION_MODULES.STEEL_ISSUE,
      actions: [PermissionAction.VIEW],
    },
  ],
  // --- Phase 8 (Mua hàng) ---
  // Mua hàng: báo giá/gửi Sếp duyệt/theo dõi nhận hàng trên đề xuất mua + quản lý danh mục NCC
  // của riêng mình (thêm NCC mới ngay lúc báo giá).
  // PURCHASE_PROPOSAL: CỐ Ý không có APPROVE (khác SUPPLIER/'ALL' ở dưới) - duyệt/từ chối đề
  // xuất mua là việc của Sếp, cùng nguyên tắc "duyệt đề xuất mua là việc của Sếp, không phải
  // thủ kho" đã áp cho WAREHOUSE_STAFF (xem QC_REVIEW ở trên). Trước đây cấp 'ALL' (bao gồm cả
  // APPROVE) - chỉ bị chặn ở tầng FE (không có nút), BE vẫn cho Mua hàng tự duyệt đơn của chính
  // mình nếu gọi thẳng API - lỗ hổng đã xác nhận, sửa 2026-08-11 (D.h4-purchaser-approve).
  // SUPPLIER: ALL - vừa quản lý entity Supplier (suppliers.controller.ts) vừa quản lý các route
  // lồng POST/GET/PATCH/DELETE .../materials/:id/suppliers (gắn NCC + giá vào vật tư, xem
  // materials.controller.ts) - cả 2 nhóm route đều gắn permission module SUPPLIER.
  // MATERIAL: chỉ VIEW (KHÔNG UPDATE) - VatTuNCCPage.tsx chỉ cần liệt kê vật tư để chọn, không
  // sửa vật tư gốc (tên/mã/đơn vị). Trước đây từng cấp thêm UPDATE vì route gắn NCC bị gắn nhầm
  // module MATERIAL - đã fix (xem review rủi ro #2, materials.controller.ts) nên không cần nữa;
  // giữ UPDATE sẽ vô tình cho phép PURCHASER gọi PATCH /materials/:id (sửa vật tư gốc) dù UI
  // không có chỗ nào dùng tới.
  [BUSINESS_ROLES.PURCHASER]: [
    {
      module: PERMISSION_MODULES.PURCHASE_PROPOSAL,
      actions: [PermissionAction.VIEW, PermissionAction.UPDATE],
    },
    { module: PERMISSION_MODULES.SUPPLIER, actions: 'ALL' },
    { module: PERMISSION_MODULES.MATERIAL, actions: [PermissionAction.VIEW] },
  ],
};

/**
 * Links the per-user `mfgRole` attribute (authorization layer 2 / scope) to the
 * capability Role (layer 1 / RBAC) that grants its permissions. Setting a user's mfgRole
 * can therefore also assign the matching Role in one place, keeping the two layers from
 * drifting apart (see the mfg-attributes endpoint). Not every MfgRole has a paired role
 * yet - only those with a seeded business role are listed.
 */
export const MFG_ROLE_TO_BUSINESS_ROLE: Partial<Record<MfgRole, BusinessRole>> = {
  [MfgRole.PRODUCTION_MANAGER]: BUSINESS_ROLES.PRODUCTION_MANAGER,
  [MfgRole.PHOI]: BUSINESS_ROLES.PHOI_STAFF,
  [MfgRole.HAN]: BUSINESS_ROLES.HAN_STAFF,
  [MfgRole.SON]: BUSINESS_ROLES.SON_STAFF,
  [MfgRole.KCS]: BUSINESS_ROLES.KCS_STAFF,
  [MfgRole.SPEC_STEEL]: BUSINESS_ROLES.SPEC_STEEL_STAFF,
  [MfgRole.SPEC_ACCESSORY]: BUSINESS_ROLES.SPEC_ACCESSORY_PACKAGING_STAFF,
  [MfgRole.SPEC_PACKAGING]: BUSINESS_ROLES.SPEC_ACCESSORY_PACKAGING_STAFF,
};

/**
 * The 4 floor operations (Phôi/Hàn/Sơn/KCS) all live in a single physical warehouse.
 * A user assigned one of these mfgRoles must carry this exact warehouseScope - enforced
 * server-side (see UsersService.updateMfgAttributes) rather than trusted from the caller,
 * since any client with API access (not just the admin form) can hit this endpoint.
 */
export const MFG_FLOOR_WAREHOUSE_SCOPE = 'phoi-son-han';
export const MFG_FLOOR_ROLES: MfgRole[] = [MfgRole.PHOI, MfgRole.HAN, MfgRole.SON, MfgRole.KCS];
