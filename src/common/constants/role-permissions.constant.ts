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
  ],
  // QLSX: duyệt cục bộ + gửi Sếp ở cả PlanForm lẫn PI item (APPROVE) - các route tương ứng
  // (qlsx-review/request-boss-approval/reject-qlsx, send-to-boss) còn gắn thêm
  // @RequireMfgRole(PRODUCTION_MANAGER) để tách khỏi bước duyệt CUỐI của Sếp, vốn dùng CHÍNH
  // action APPROVE này nhưng gắn thêm @RequireRole('BOSS') (xem skus/production-invoices
  // controller) - QLSX không tự ý gọi được endpoint duyệt cuối dù permission trùng action.
  [BUSINESS_ROLES.PRODUCTION_MANAGER]: [
    {
      module: PERMISSION_MODULES.SKU,
      actions: [PermissionAction.VIEW, PermissionAction.APPROVE],
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
  ],
  // --- Phase 3 (Kho vận lõi / Ledger Core) ---
  // WAREHOUSE_STAFF: kho nguồn tạo phiếu chuyển kho, kho đích xác nhận/từ chối (cả 2 thao tác
  // đều dùng chung permission WAREHOUSE_TRANSFER - phân biệt kho nào được thao tác qua
  // warehouseScope, enforce ở WarehouseTransfersService, không phải RBAC). STOCK:VIEW để tra
  // tồn kho khả dụng trước khi tạo phiếu.
  [BUSINESS_ROLES.WAREHOUSE_STAFF]: [
    { module: PERMISSION_MODULES.STOCK, actions: [PermissionAction.VIEW] },
    { module: PERMISSION_MODULES.WAREHOUSE_TRANSFER, actions: 'ALL' },
  ],
  // 4 account chuyên trách nhập định mức SKU (mirror đúng mock: Sắt / Dây-Sơn / Phụ kiện-Bao
  // bì) - chỉ UPDATE (nhập liệu qua manh-quota/detail-quota), không APPROVE (duyệt là KHSX).
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
  [BUSINESS_ROLES.SPEC_WIRE_PAINT_STAFF]: [
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
  // [BUSINESS_ROLES.PHOI_STAFF]: [
  //   { module: PERMISSION_MODULES.STEEL_ISSUE, actions: 'ALL' },
  //   { module: PERMISSION_MODULES.PRODUCTION_BATCH, actions: 'ALL' },
  //   { module: PERMISSION_MODULES.MATERIAL_ISSUE, actions: 'ALL' },
  //   { module: PERMISSION_MODULES.WORK_SESSION, actions: 'ALL' },
  // ],
  // [BUSINESS_ROLES.KCS_STAFF]: [
  //   { module: PERMISSION_MODULES.QC_REVIEW, actions: 'ALL' },
  //   { module: PERMISSION_MODULES.REPLENISH_REQUEST, actions: 'ALL' },
  // ],
  // --- Phase 3/8 (Warehouse & Purchasing, + scope) ---
  // [BUSINESS_ROLES.WAREHOUSE_STAFF]: [
  //   { module: PERMISSION_MODULES.STOCK, actions: [PermissionAction.VIEW] },
  //   { module: PERMISSION_MODULES.WAREHOUSE_TRANSFER, actions: 'ALL' },
  // ],
  // [BUSINESS_ROLES.PURCHASER]: [
  //   { module: PERMISSION_MODULES.PURCHASE_PROPOSAL, actions: 'ALL' },
  //   { module: PERMISSION_MODULES.SUPPLIER, actions: 'ALL' },
  // ],
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
  [MfgRole.SPEC_WIRE_PAINT]: BUSINESS_ROLES.SPEC_WIRE_PAINT_STAFF,
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
