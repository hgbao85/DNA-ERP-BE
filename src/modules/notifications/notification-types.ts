import { MfgRole } from '../../generated/prisma/client';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../common/constants/roles.constant';

/**
 * Tiêu chí chọn người nhận cho 1 lần `NotificationsService.emit()` -
 * `RecipientResolverService.resolve()` dịch tiêu chí này sang danh sách userId cụ thể. Nhiều tiêu
 * chí trong CÙNG 1 criteria là HỢP (OR) - vd `{ roles: [...], warehouseIds: [...] }` gộp cả 2 nhóm
 * lại, không phải AND.
 */
export interface RecipientCriteria {
  /** Role name (`Role.name`, khớp `BUSINESS_ROLES`) - user có role qua UserRole. */
  roles?: string[];
  /** `User.mfgRole` - vai trò sàn xưởng không có Role riêng (Phôi/Hàn/Sơn/KCS/Spec...). */
  mfgRoles?: MfgRole[];
  /** `User.warehouseScope` - báo đúng kho liên quan (vd theo `Material.warehouseId`). */
  warehouseIds?: string[];
  /** Chỉ định đích danh (vd người đã tạo phiếu, để báo kết quả duyệt/từ chối cho đúng họ). */
  userIds?: string[];
  /** Mọi user active/chưa xoá - dùng cho ANNOUNCEMENT audience=ALL. */
  allActiveUsers?: boolean;
}

export type NotificationCategoryValue =
  'ANNOUNCEMENT' | 'ACTION_REQUIRED' | 'RESULT' | 'ALERT' | 'INFO';
export type NotificationSeverityValue = 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';

/** FE dựng URL từ đây (BE không biết cấu trúc route FE - mục 6.2 changelog 2026-09-25). Index
 *  signature vì đây là dữ liệu lưu thẳng vào cột JSONB `Notification.link` (Prisma.InputJsonValue
 *  đòi hỏi kiểu object phải "trông giống JSON", không chấp nhận interface đóng). */
export interface NotificationLink {
  module: string;
  page: string;
  params?: Record<string, string | number | null>;
  [key: string]: unknown;
}

export interface NotificationTypeDef<P> {
  category: NotificationCategoryValue;
  severity: NotificationSeverityValue;
  /** `Notification.entityType` - dùng để `resolve()` tự đóng ACTION_REQUIRED khi đối tượng rời
   *  trạng thái cần xử lý. */
  entityType: string;
  title: (params: P) => string;
  message: (params: P) => string;
  link?: (params: P) => NotificationLink | null;
  recipients: (params: P) => RecipientCriteria;
  /** Mặc định false: loại `actorId` (người gây ra sự kiện) khỏi người nhận - báo cho chính người
   *  vừa thao tác là thừa (nguyên tắc #2, mục 4 changelog 2026-09-25). */
  notifyActor?: boolean;
}

/** Params cho type cắt sắt duy nhất còn lại - chỉ
 *  CuttingProposalsService.notifyProductionManagers() gọi tới. `entityId` truyền riêng ở lệnh gọi
 *  emit() (không phải field render). */
export interface CuttingProposalNotificationParams {
  poNumber: string;
  proposalId: string;
}

/** Params cho CUTTING_WASTE_DEFAULT_CHANGED - KHSX đổi ngưỡng hao hụt mặc định cắt sắt. */
export interface CuttingWasteDefaultChangedParams {
  actorName: string;
  previous: number;
  next: number;
  reason?: string;
}

/** Params cho 2 type "Solve trước" (CUTTING_SOLVE_DONE/CUTTING_SOLVE_FAILED) - báo đích danh người
 *  bấm Tính (`requestedById`), không báo theo role. `label` = mã SKU của tổ hợp đã tính. */
export interface CuttingSolveNotificationParams {
  label: string;
  proposalId: string;
  requestedById: string;
  /** Tóm tắt kết quả (DONE), vd "Tổng 387 cây, hao hụt 0.8%". */
  summary?: string;
  /** Lý do chưa dùng được (FAILED). */
  reason?: string;
}

// KHÔNG gắn `link` cho type cắt sắt dưới đây (sửa 2026-09-25, lần 2 - phát hiện qua câu hỏi
// "solve fail thì sao lại hiện thông báo bên màn QLSX" khi live-test): lúc đầu gắn
// `module: 'production', page: 'lenh-sx'` tưởng là "chỗ QLSX thấy PO này", nhưng đọc kỹ
// `CuttingProposalsController.requestProposal()` thì "lần tính đầu tiên tự động chạy ngầm KHI SẾP
// DUYỆT PI ITEM" - tức là bất kể tính xong/thất bại, PO/PI trong thông báo NÀY LUÔN ĐÃ RA KHỎI
// hàng đợi "Xử lý lệnh sản xuất" (lọc theo status WAITING_QLSX) TỪ TRƯỚC KHI cutting-proposal tồn
// tại - trỏ vào đó chỉ cho QLSX thấy 1 danh sách PI HOÀN TOÀN KHÔNG LIÊN QUAN. Tệ hơn: kể cả đúng
// màn cũng chưa có nút Duyệt/Từ chối cho riêng 1 CuttingProposal (duyệt tay vẫn chỉ gọi thẳng API,
// xem comment đầu cutting-proposals-api.ts bên FE - "chưa có UI"). Trỏ tới 1 màn không liên quan +
// không có hành động nào để làm GÂY HIỂU LẦM hơn là không có link - bỏ hẳn, để title/message (đã
// đủ thông tin: mã PO, lý do) tự đứng một mình. `proposalId` vẫn giữ trong `data` (không phải
// `link`) để dùng khi FE có màn chi tiết CuttingProposal thật.
const cuttingProposalRecipients = (): RecipientCriteria => ({
  roles: [BUSINESS_ROLES.PRODUCTION_MANAGER],
});

/** Params dùng chung cho 9 type SKU/định mức (Phase 3a, mục 7.1 changelog 2026-09-25) - chỉ
 *  SkusService gọi tới. `entityId` (planFormId) truyền riêng ở lệnh gọi emit(), không phải field
 *  render. `hasSalesOrder` chỉ SKU_APPROVED/SKU_REJECTED_BY_BOSS dùng (mở rộng recipients sang
 *  SALES_STAFF khi SKU có gắn đơn hàng - xem ghi chú tại 2 type đó). */
export interface SkuNotificationParams {
  factoryCode: string;
  productName: string;
  reason?: string;
  hasSalesOrder?: boolean;
}

const skuLabel = (p: SkuNotificationParams) => `${p.factoryCode} – ${p.productName}`;

// Link module 'production' page 'setup' PHỤC VỤ CẢ 2 role Spec (Sắt/Chi tiết) - MfgApp.tsx tự
// chọn đúng SpecSteelPage/SpecDetailQuotaPage theo user.mfgRole khi vào tab 'setup' (không cần
// phân biệt ở link). Chưa deep-link tới đúng SKU (SpecSteelPage/SpecDetailQuotaPage chưa đọc
// query param để mở đúng dòng) - mở đúng MÀN đã là cải thiện thật so với không có link nào (khác
// hẳn ca cắt sắt ở mục 12.6: màn ở đây CÓ hành động thật để làm - nhập định mức).
const specSetupLink = () => ({ module: 'production', page: 'setup' });
// Link module 'production_plan' page 'duyet-sku' (SKUReviewPage) - nơi KHSX duyệt/trả định mức
// và forward sang Sếp (approve-parts/approve-detail).
const khsxReviewLink = () => ({ module: 'production_plan', page: 'duyet-sku' });

const skuNeedsQuotaRecipients = (role: string) => (): RecipientCriteria => ({ roles: [role] });

/** Params dùng chung cho 6 type PI (mục 7.2, Phase 3a) - `entityId` (piId hoặc itemId, tuỳ type)
 *  truyền riêng ở lệnh gọi emit(). `count` = số SKU (item) liên quan tới đúng lần emit đó - với 2
 *  type ACTION_REQUIRED (`PI_SENT_TO_QLSX`/`PI_SENT_TO_BOSS`) đây là TỔNG số SKU đang chờ (cộng
 *  dồn qua dedupe, không phải số SKU của riêng lần gọi này) để khớp đúng nghĩa "n SKU chờ duyệt". */
export interface PiNotificationParams {
  piCode: string;
  count: number;
  reason?: string;
  errorMessage?: string;
}

const piLabel = (p: PiNotificationParams) => `${p.piCode}: ${p.count} SKU`;

/** Params dùng chung cho 4 type Đề xuất mua (mục 7.4, Phase 3a) - `entityId` = purchaseProposalId
 *  (chuỗi). `piCode` lấy từ `PurchaseProposal.productionInvoiceId` (khi có) - 3 nguồn tạo đề xuất
 *  (cắt sắt/PieceMaterialYield/tiêu hao) đều ghim field này (mục 7.4 changelog) nên đủ dùng, không
 *  cần dựng lại chuỗi `cuttingProposal -> productionOrder -> productionInvoiceItem` phức tạp như
 *  `PurchaseProposalsService.toResponseDto()` - fallback `#{id}` cho ca hiếm chưa ghim PI nào. */
export interface PurchaseProposalNotificationParams {
  piCode: string;
  count: number;
  materialCode?: string;
  qty?: number;
  unit?: string;
}

/** Phase 3b, nhóm 7.5-i (Sắt → Phôi → KCS). */
export interface SteelIssueNotificationParams {
  piCode: string;
  materialCode: string;
  barCount: number;
}

export interface QcSubmittedNotificationParams {
  piCode: string;
  /** Chỉ `BATCH_TO_KCS` dùng (KCS xem theo 3 tab riêng `kcs-phoi`/`kcs-han`/`kcs-son`, xem
   *  `MfgApp.tsx`) - `ProductionBatch.stage` CÓ THỂ là PHOI (Phôi tự báo sản lượng piece không qua
   *  CutBundle/bin-packing, khác hẳn `CUT_BUNDLE_TO_KCS` vốn luôn gắn 1 tab `kcs-phoi` cố định vì
   *  chỉ có đúng 1 nguồn - xem `ProductionBatchesService.assertMfgRoleMatchesStage()`). Bỏ trống
   *  cho `CUT_BUNDLE_TO_KCS` (không cần rẽ nhánh, luôn `kcs-phoi`). */
  stage?: 'PHOI' | 'HAN' | 'SON';
}

export interface QcResultNotificationParams {
  piCode: string;
  failedQty: number;
  /** Role (`BUSINESS_ROLES`) của tổ gửi - Phôi cho đợt cắt, Hàn/Sơn cho đợt sản xuất. */
  senderRole: string;
}

/** Phase 3b, nhóm 7.5-ii "Xuất vật tư tiêu hao / vật tư thành phẩm / bao bì" (xem changelog
 *  2026-09-25 mục 22). `unit` lấy từ `Material.unit` - hiện đúng đơn vị thật (kg/cái/mét...) thay
 *  vì hard-code "cây" như sắt (chỉ sắt luôn tính theo cây, các vật tư khác thì không). */
export interface MaterialIssueNotificationParams {
  piCode: string;
  materialCode: string;
  qty: number;
  unit: string;
  /** Chỉ `MATERIAL_ISSUE_TO_TEAM` dùng - quyết định tổ nhận (Hàn hay Sơn). */
  stage?: 'HAN' | 'SON';
}

/** Phase 3b, nhóm 7.5-iii "Chuyển kho ngoài đơn hàng" (xem changelog 2026-09-25 mục 23).
 *  `itemCount` = số dòng vật tư HOẶC mảnh trong phiếu (2 loại phiếu loại trừ nhau - 1 phiếu chỉ
 *  toàn `items` (vật tư) hoặc toàn `pieceItems` (mảnh), xem `WarehouseTransfersService.create()`/
 *  `createPieceTransfer()`). `reason` chỉ `WAREHOUSE_TRANSFER_REJECTED` dùng. */
export interface WarehouseTransferNotificationParams {
  code: string;
  fromWarehouseName: string;
  itemCount: number;
  reason?: string;
}

/** Phase 3b, nhóm 7.5-v "Chuyền kiểm có lỗi" (xem changelog 2026-09-25 mục 24). Recipient CHỈ
 *  QLSX (không phải "tổ gửi" Phôi/Hàn/Sơn như nhóm 7.5-i) - `TransferCheckResult` KHÔNG có FK nào
 *  xác định chắc chắn tổ nào đã làm ra mảnh đó (khác `CutBundle`/`ProductionBatch`), suy qua
 *  `BomPiece.needsHan/needsSon` chỉ là suy đoán gián tiếp, không đủ tin cậy để báo đích danh 1 tổ -
 *  đúng như bảng kế hoạch gốc mục 7.5 đã chốt từ đầu. */
export interface TransferCheckDefectNotificationParams {
  piCode: string;
  pieceName: string;
  defectCount: number;
  /** Lý do của lỗi ĐẦU TIÊN trong lần kiểm này - đủ cho QLSX biết sơ bộ, không liệt kê hết mọi lý
   *  do (1 lần kiểm có thể có nhiều defect khác lý do nhau). */
  reason: string;
}

/** Phase 3b, nhóm 7.5-vi "Đóng gói xong → Sales" (xem changelog 2026-09-25 mục 25). Recipient là
 *  CẢ role `SALES_STAFF` (không chỉ định danh 1 người) - cùng lý do đã ghi ở mục 15.2:
 *  `SalesOrder` không có cột "người phụ trách"/người tạo, không nhắm được đích danh 1 Sales cụ thể. */
export interface PackagingCompleteNotificationParams {
  piCode: string;
  factoryCode: string;
  productName: string;
  salesOrderCode: string;
}

/** Phase 3b, nhóm 7.5-iv "Xuất/nhận đan" (xem changelog 2026-09-25 mục 26). `WeavingIssue`/
 *  `WeavingReceipt` là 2 sổ cộng dồn thuần, KHÔNG có FK nối 1 lần xuất với đúng 1 lần nhận (xem
 *  model trong schema.prisma) nên `entityId` (truyền riêng ở emit()) là khoá GHÉP
 *  `${productionOrderId}:${pieceId}:${weavingPointId}`, không phải id 1 dòng - mirror
 *  `PI_SENT_TO_QLSX` (dedupe theo tổng đang chờ, tự đóng khi tổng về đúng 0), không phải state
 *  machine 1-1. `outstandingQty` = TỔNG hiện đang treo tại đúng điểm đan này (đã xuất - đã nhận),
 *  tính lại mỗi lần xuất đan mới - giữ nguyên hạn chế đã chấp nhận ở mục 16.2 (không giảm số hiển
 *  thị khi nhận MỘT PHẦN, chỉ tự đóng khi nhận ĐỦ về 0). `warehouseCodes` không phải field hiển thị
 *  (dùng cho `recipients`) - xem lý do ở doc comment `WEAVING_ISSUE_TO_POINT` bên dưới. */
export interface WeavingIssueNotificationParams {
  poNumber: string;
  pieceName: string;
  weavingPointName: string;
  outstandingQty: number;
}

const notificationTypeDefinitions = {
  // ─── 7.1 SKU/định mức (Phase 3a, 2026-09-26) ───────────────────────────────────────────────

  /** KHSX vừa tạo SKU mới (POST /skus) - luôn cần CẢ 2 nhánh mảnh/chi tiết, nên create() emit
   *  song song type này VÀ SKU_NEEDS_DETAIL_QUOTA. Tự đóng khi Spec Sắt nộp định mức lần đầu
   *  (updateManhQuota) - xem SkusService.resolveSkuQuotaNotifications(). */
  SKU_NEEDS_MANH_QUOTA: {
    category: 'ACTION_REQUIRED',
    severity: 'INFO',
    entityType: 'SKU',
    title: (p: SkuNotificationParams) => `SKU mới cần nhập định mức mảnh: ${skuLabel(p)}`,
    message: () => 'KHSX vừa tạo SKU này - vào nhập định mức mảnh (Sắt/Dây/Đinh/Tán rút/Nút nhựa).',
    link: specSetupLink,
    recipients: skuNeedsQuotaRecipients(BUSINESS_ROLES.SPEC_STEEL_STAFF),
  } satisfies NotificationTypeDef<SkuNotificationParams>,

  /** Cùng sự kiện trigger với SKU_NEEDS_MANH_QUOTA ở trên, khác người nhận (Spec chi tiết). */
  SKU_NEEDS_DETAIL_QUOTA: {
    category: 'ACTION_REQUIRED',
    severity: 'INFO',
    entityType: 'SKU',
    title: (p: SkuNotificationParams) => `SKU mới cần nhập định mức chi tiết: ${skuLabel(p)}`,
    message: () => 'KHSX vừa tạo SKU này - vào nhập định mức chi tiết (Sơn/Phụ kiện/Bao bì).',
    link: specSetupLink,
    recipients: skuNeedsQuotaRecipients(BUSINESS_ROLES.SPEC_ACCESSORY_PACKAGING_STAFF),
  } satisfies NotificationTypeDef<SkuNotificationParams>,

  /** Spec Sắt vừa nộp định mức mảnh (POST .../manh-quota, kể cả nộp lại sau khi bị trả) - báo
   *  KHSX vào duyệt (manh-quota/review) hoặc trả lại. Tự đóng khi KHSX ra quyết định (duyệt HAY
   *  từ chối đều tính - xem reviewManhQuota()), không đợi tới lúc approveParts(). */
  SKU_MANH_QUOTA_SUBMITTED: {
    category: 'ACTION_REQUIRED',
    severity: 'INFO',
    entityType: 'SKU',
    title: (p: SkuNotificationParams) => `${skuLabel(p)}: định mức mảnh đã nộp, cần review`,
    message: () => 'NV định mức mảnh vừa nộp - vào duyệt hoặc trả lại.',
    link: khsxReviewLink,
    recipients: skuNeedsQuotaRecipients(BUSINESS_ROLES.PRODUCTION_PLANNER),
  } satisfies NotificationTypeDef<SkuNotificationParams>,

  /** Tương tự SKU_MANH_QUOTA_SUBMITTED, cho nhánh chi tiết. */
  SKU_DETAIL_QUOTA_SUBMITTED: {
    category: 'ACTION_REQUIRED',
    severity: 'INFO',
    entityType: 'SKU',
    title: (p: SkuNotificationParams) => `${skuLabel(p)}: định mức chi tiết đã nộp, cần review`,
    message: () => 'NV định mức chi tiết vừa nộp - vào duyệt hoặc trả lại.',
    link: khsxReviewLink,
    recipients: skuNeedsQuotaRecipients(BUSINESS_ROLES.PRODUCTION_PLANNER),
  } satisfies NotificationTypeDef<SkuNotificationParams>,

  /** KHSX trả định mức mảnh về (manh-quota/review, status=REJECTED) kèm lý do - báo Spec Sắt sửa
   *  lại. Tự đóng khi Spec nộp lại (updateManhQuota gọi resolve() cho type này). */
  SKU_MANH_QUOTA_REJECTED: {
    category: 'ACTION_REQUIRED',
    severity: 'WARNING',
    entityType: 'SKU',
    title: (p: SkuNotificationParams) => `${skuLabel(p)}: định mức mảnh bị trả lại`,
    message: (p: SkuNotificationParams) =>
      `KHSX trả lại: ${p.reason ?? 'không nêu lý do'}. Sửa rồi nộp lại.`,
    link: specSetupLink,
    recipients: skuNeedsQuotaRecipients(BUSINESS_ROLES.SPEC_STEEL_STAFF),
  } satisfies NotificationTypeDef<SkuNotificationParams>,

  /** Tương tự SKU_MANH_QUOTA_REJECTED, cho nhánh chi tiết. */
  SKU_DETAIL_QUOTA_REJECTED: {
    category: 'ACTION_REQUIRED',
    severity: 'WARNING',
    entityType: 'SKU',
    title: (p: SkuNotificationParams) => `${skuLabel(p)}: định mức chi tiết bị trả lại`,
    message: (p: SkuNotificationParams) =>
      `KHSX trả lại: ${p.reason ?? 'không nêu lý do'}. Sửa rồi nộp lại.`,
    link: specSetupLink,
    recipients: skuNeedsQuotaRecipients(BUSINESS_ROLES.SPEC_ACCESSORY_PACKAGING_STAFF),
  } satisfies NotificationTypeDef<SkuNotificationParams>,

  /** KHSX đã xác nhận xong CẢ 2 nhánh (approve-parts + approve-detail, xem
   *  SkusService.advanceForwardedTrack) - báo Sếp vào duyệt cuối. Tự đóng khi Sếp duyệt hoặc từ
   *  chối (approve()/rejectByBoss() đều gọi resolve() cho type này). */
  SKU_SENT_TO_BOSS: {
    category: 'ACTION_REQUIRED',
    severity: 'INFO',
    entityType: 'SKU',
    title: (p: SkuNotificationParams) => `SKU chờ duyệt: ${skuLabel(p)}`,
    message: () => 'KHSX đã gửi - cả định mức mảnh và chi tiết đã xong.',
    link: () => ({ module: 'boss', page: 'cho-duyet' }),
    recipients: skuNeedsQuotaRecipients(BUSINESS_ROLES.BOSS),
  } satisfies NotificationTypeDef<SkuNotificationParams>,

  /** Sếp duyệt cuối (POST .../approve) - báo lại cho mọi bên đã góp tay (KHSX + 2 role Spec).
   *  Thêm SALES_STAFF khi SKU có gắn Sales Order (`hasSalesOrder`) - SalesOrder KHÔNG có cột
   *  người tạo (không có createdById, xem schema.prisma) nên không nhắm được đích danh "Sales đã
   *  tạo đơn", đành báo role rộng (khớp quyết định mục 9.4 "gửi tất cả người cùng vai trò"). */
  SKU_APPROVED: {
    category: 'RESULT',
    severity: 'SUCCESS',
    entityType: 'SKU',
    title: (p: SkuNotificationParams) => `SKU đã được duyệt: ${skuLabel(p)}`,
    message: () => 'Sếp đã duyệt - định mức chính thức có hiệu lực.',
    link: () => ({ module: 'production_plan', page: 'planforms' }),
    recipients: (p: SkuNotificationParams) => ({
      roles: [
        BUSINESS_ROLES.PRODUCTION_PLANNER,
        BUSINESS_ROLES.SPEC_STEEL_STAFF,
        BUSINESS_ROLES.SPEC_ACCESSORY_PACKAGING_STAFF,
        ...(p.hasSalesOrder ? [BUSINESS_ROLES.SALES_STAFF] : []),
      ],
    }),
  } satisfies NotificationTypeDef<SkuNotificationParams>,

  /** Sếp từ chối (POST .../reject-boss) kèm lý do - rewindToDetailReview() xoá quyết định duyệt
   *  CẢ 2 nhánh (không xoá dữ liệu định mức đã nhập) nên KHSX + Spec đều cần biết để làm lại. */
  SKU_REJECTED_BY_BOSS: {
    category: 'RESULT',
    severity: 'WARNING',
    entityType: 'SKU',
    title: (p: SkuNotificationParams) => `SKU bị Sếp từ chối: ${skuLabel(p)}`,
    message: (p: SkuNotificationParams) =>
      `Lý do: ${p.reason ?? 'không nêu lý do'}. Cần làm lại từ đầu (cả 2 nhánh).`,
    link: khsxReviewLink,
    recipients: (p: SkuNotificationParams) => ({
      roles: [
        BUSINESS_ROLES.PRODUCTION_PLANNER,
        BUSINESS_ROLES.SPEC_STEEL_STAFF,
        BUSINESS_ROLES.SPEC_ACCESSORY_PACKAGING_STAFF,
        ...(p.hasSalesOrder ? [BUSINESS_ROLES.SALES_STAFF] : []),
      ],
    }),
  } satisfies NotificationTypeDef<SkuNotificationParams>,

  // ─── 7.2 Lệnh sản xuất - PI (Phase 3a, 2026-09-26) ─────────────────────────────────────────

  PI_SENT_TO_QLSX: {
    category: 'ACTION_REQUIRED',
    severity: 'INFO',
    entityType: 'PRODUCTION_INVOICE',
    title: (p: PiNotificationParams) => `${piLabel(p)} chờ QLSX duyệt`,
    message: () => 'KHSX đã gửi - vào xử lý.',
    link: () => ({ module: 'production', page: 'lenh-sx' }),
    recipients: () => ({ roles: [BUSINESS_ROLES.PRODUCTION_MANAGER] }),
  } satisfies NotificationTypeDef<PiNotificationParams>,

  /** QLSX từ chối (lẻ hoặc cả phiếu) - PI có thể đã bị XOÁ ngay sau đó nếu hết SKU (xem
   *  rejectItemByQlsx/rejectBatchByQlsx trong service) - `entityId` vẫn giữ nguyên piId cũ, không
   *  sao vì đây là RESULT (không cần resolve() tra lại theo entityId nữa). SKU quay về "chưa gom"
   *  nên link trỏ đúng màn "Tối ưu cắt sắt" (GomDotCatPage) - nơi KHSX gộp/cắt riêng lại. */
  PI_REJECTED_BY_QLSX: {
    category: 'RESULT',
    severity: 'WARNING',
    entityType: 'PRODUCTION_INVOICE',
    title: (p: PiNotificationParams) => `${piLabel(p)} bị QLSX từ chối`,
    message: (p: PiNotificationParams) =>
      `Lý do: ${p.reason ?? 'không nêu lý do'}. SKU đã quay về "Tối ưu cắt sắt" để gộp/cắt lại.`,
    link: () => ({ module: 'production_plan', page: 'gom-cat' }),
    recipients: () => ({ roles: [BUSINESS_ROLES.PRODUCTION_PLANNER] }),
  } satisfies NotificationTypeDef<PiNotificationParams>,

  PI_SENT_TO_BOSS: {
    category: 'ACTION_REQUIRED',
    severity: 'INFO',
    entityType: 'PRODUCTION_INVOICE',
    title: (p: PiNotificationParams) => `${piLabel(p)} chờ Sếp duyệt`,
    message: () => 'QLSX đã gửi - vào xử lý.',
    link: () => ({ module: 'boss', page: 'cho-duyet' }),
    recipients: () => ({ roles: [BUSINESS_ROLES.BOSS] }),
  } satisfies NotificationTypeDef<PiNotificationParams>,

  /** Recipients gồm CẢ KHSX lẫn QLSX - 2 role có module "nhà" KHÁC NHAU (production_plan vs
   *  production) và nhân viên thường bị khoá cứng vào module của mình (chỉ Giám đốc mới vượt rào
   *  đổi module tuỳ ý, xem app/page.tsx) - 1 `link` duy nhất KHÔNG THỂ đúng cho cả 2 phía cùng lúc,
   *  bên còn lại sẽ bị bật về module mặc định + toast (mục 6.2). Cố ý BỎ HẲN `link` ở 2 type
   *  RESULT này (khác PI_SENT_TO_QLSX/PI_SENT_TO_BOSS ở trên - mỗi type đó chỉ có 1 role, không bị
   *  vướng) - đúng tinh thần mục 12.6 "thà không có link còn hơn có link sai với 1 nửa người nhận". */
  PI_APPROVED_BY_BOSS: {
    category: 'RESULT',
    severity: 'SUCCESS',
    entityType: 'PRODUCTION_INVOICE',
    title: (p: PiNotificationParams) => `${piLabel(p)} đã được Sếp duyệt`,
    message: () => 'Đã tạo lệnh sản xuất, bắt đầu cắt sắt.',
    recipients: () => ({
      roles: [BUSINESS_ROLES.PRODUCTION_PLANNER, BUSINESS_ROLES.PRODUCTION_MANAGER],
    }),
  } satisfies NotificationTypeDef<PiNotificationParams>,

  PI_REJECTED_BY_BOSS: {
    category: 'RESULT',
    severity: 'WARNING',
    entityType: 'PRODUCTION_INVOICE',
    title: (p: PiNotificationParams) => `${piLabel(p)} bị Sếp từ chối`,
    message: (p: PiNotificationParams) =>
      `Lý do: ${p.reason ?? 'không nêu lý do'}. SKU đã quay về "Tối ưu cắt sắt".`,
    recipients: () => ({
      roles: [BUSINESS_ROLES.PRODUCTION_PLANNER, BUSINESS_ROLES.PRODUCTION_MANAGER],
    }),
  } satisfies NotificationTypeDef<PiNotificationParams>,

  /** SKU đã duyệt nhưng tạo `ProductionOrder` thất bại (race hiếm - BOM bị deactivate đúng lúc,
   *  xem docstring `retryProductionOrder()`) - CHỈ báo ADMIN (2026-09-26, người dùng chốt), KHÔNG
   *  báo QLSX: khắc phục đi qua `POST .../retry-production-order` yêu cầu role ADMIN
   *  (`@RequireRole(DEFAULT_ROLES.ADMIN)`) và FE CHƯA có nút nào gọi route này (chỉ có hàm gọi API
   *  sẵn, không màn nào dùng tới) - báo QLSX 1 việc họ không tự làm được lặp lại đúng lỗi vừa sửa ở
   *  mục 14 (3 loại thông báo cắt sắt "không hành động được" đã bị bỏ). `severity=CRITICAL` nên
   *  Sếp cũng tự động nhận (mục 9.3) - đúng chủ đích, đây là sự cố kỹ thuật cần biết tới. Không có
   *  `link` (không có màn nào để trỏ tới). `entityType` = item (không phải PI) vì đây là sự cố của
   *  riêng 1 SKU, PI có thể còn nhiều SKU khác vẫn ổn. */
  PI_PRODUCTION_ORDER_FAILED: {
    category: 'ALERT',
    severity: 'CRITICAL',
    entityType: 'PRODUCTION_INVOICE_ITEM',
    title: (p: PiNotificationParams) => `Tạo lệnh sản xuất thất bại: ${p.piCode}`,
    message: (p: PiNotificationParams) =>
      `Lỗi: ${p.errorMessage ?? 'không rõ'}. SKU đã duyệt nhưng CHƯA có lệnh sản xuất - cần Admin ` +
      `gọi lại API tạo lệnh (retry-production-order), FE chưa có nút cho việc này.`,
    recipients: () => ({ roles: [DEFAULT_ROLES.ADMIN] }),
  } satisfies NotificationTypeDef<PiNotificationParams>,

  // ─── 7.4 Đề xuất mua hàng (Phase 3a, 2026-09-26) ───────────────────────────────────────────

  /** 1 trong 3 nguồn (cắt sắt/PieceMaterialYield/tiêu hao) vừa tìm-hoặc-tạo xong `PurchaseProposal`
   *  chung của 1 PI, VÀ rollup còn vật tư chưa PURCHASING/PURCHASED (xem
   *  `notifyPurchaseProposalCreated()` trong `purchase-proposal-notify.util.ts`). `dedupeKey` theo
   *  proposalId - tính lại nhiều lần (mỗi SKU mới trong PI được duyệt, hoặc "Tính lại") gộp vào 1
   *  dòng, `count` cập nhật theo tổng vật tư còn cần mua tại lần gọi gần nhất. */
  PURCHASE_PROPOSAL_CREATED: {
    category: 'ACTION_REQUIRED',
    severity: 'INFO',
    entityType: 'PURCHASE_PROPOSAL',
    title: (p: PurchaseProposalNotificationParams) => `${p.piCode}: ${p.count} vật tư cần mua`,
    message: () => 'Đề xuất mua mới - vào xem và xử lý.',
    link: () => ({ module: 'purchasing', page: 'lenh-mua-ncc' }),
    recipients: () => ({ roles: [BUSINESS_ROLES.PURCHASER] }),
  } satisfies NotificationTypeDef<PurchaseProposalNotificationParams>,

  /** Mua hàng tải file duyệt ký tay xong (`bossApprove()`) - `count` = số vật tư vừa được ĐÚNG
   *  người mua này duyệt trong lần gọi này (bossApprove() duyệt riêng theo `Material.buyerId`,
   *  không phải luôn cả đề xuất - xem docstring service). */
  PURCHASE_PROPOSAL_APPROVED: {
    category: 'RESULT',
    severity: 'INFO',
    entityType: 'PURCHASE_PROPOSAL',
    title: (p: PurchaseProposalNotificationParams) => `${p.piCode}: đề xuất mua đã có Sếp duyệt`,
    message: (p: PurchaseProposalNotificationParams) =>
      `Mua hàng đã tải file duyệt ký tay cho ${p.count} vật tư - đang đặt hàng.`,
    link: () => ({ module: 'production', page: 'lenh-sx' }),
    recipients: () => ({ roles: [BUSINESS_ROLES.PRODUCTION_MANAGER] }),
  } satisfies NotificationTypeDef<PurchaseProposalNotificationParams>,

  /** Thủ kho xác nhận nhận 1 dòng hàng về (`receiveItem()`). Recipients gồm CẢ kho (theo
   *  `warehouseIds`) lẫn QLSX (`PRODUCTION_MANAGER`) - 2 module "nhà" khác nhau
   *  (`inbound_warehouse` vs `production`) nên KHÔNG gắn `link` (cùng lý do
   *  `PI_APPROVED_BY_BOSS`/`PI_REJECTED_BY_BOSS` ở mục 16.2 - 1 link không thể đúng cho cả 2 phía). */
  PURCHASE_PROPOSAL_ITEM_RECEIVED: {
    category: 'RESULT',
    severity: 'INFO',
    entityType: 'PURCHASE_PROPOSAL',
    title: (p: PurchaseProposalNotificationParams) => `${p.piCode}: hàng về kho`,
    message: (p: PurchaseProposalNotificationParams) =>
      `${p.materialCode ?? 'Vật tư'}: đã nhận ${p.qty ?? 0}${p.unit ? ` ${p.unit}` : ''}.`,
    recipients: (p: PurchaseProposalNotificationParams & { warehouseCode?: string }) => ({
      ...(p.warehouseCode ? { warehouseIds: [p.warehouseCode] } : {}),
      roles: [BUSINESS_ROLES.PRODUCTION_MANAGER],
    }),
  } satisfies NotificationTypeDef<PurchaseProposalNotificationParams & { warehouseCode?: string }>,

  /** Đề xuất đủ hàng - MỌI dòng đã PURCHASED (rollup, xem `recomputeProposalStatus`). Cùng lý do
   *  không có `link` như `PURCHASE_PROPOSAL_ITEM_RECEIVED` ở trên (2 role, 2 module khác nhau). */
  PURCHASE_PROPOSAL_PURCHASED: {
    category: 'RESULT',
    severity: 'SUCCESS',
    entityType: 'PURCHASE_PROPOSAL',
    title: (p: PurchaseProposalNotificationParams) => `${p.piCode}: đề xuất mua đã đủ hàng`,
    message: () => 'Mọi vật tư trong đề xuất đã nhận đủ.',
    recipients: () => ({
      roles: [BUSINESS_ROLES.PRODUCTION_MANAGER, BUSINESS_ROLES.PURCHASER],
    }),
  } satisfies NotificationTypeDef<PurchaseProposalNotificationParams>,

  // ─── Phase 3b, nhóm 7.5-i "Sắt → Phôi → KCS" (xem changelog 2026-09-25 mục 19) ─────────────
  /** Kho xuất sắt cho PI - Phôi vào xác nhận đã nhận. Tự đóng khi Phôi `receive()`.
   *  `link` thêm ở mục 22.2 (2026-09-28) - lúc mục 19 làm, `MfgApp.tsx` CHƯA có `?p=` URL-sync nên
   *  cố ý bỏ trống (mục 19.2); nay đã có (mọi app shell, mục 20) nên nối vào đúng tab Phôi xác nhận
   *  nhận sắt/vật tư (trang DÙNG CHUNG cho cả sắt lẫn vật tư thành phẩm, xem
   *  `XacNhanNhanSatPage.tsx`). An toàn nối vì recipient CHỈ 1 role (PHOI_STAFF) - không rơi vào
   *  ca "2 role khác tab" đã né ở PI_APPROVED_BY_BOSS (mục 16.2)/QC_FAILED (giữ nguyên không link,
   *  xem dưới). */
  STEEL_ISSUE_TO_PHOI: {
    category: 'ACTION_REQUIRED',
    severity: 'INFO',
    entityType: 'STEEL_ISSUE',
    title: (p: SteelIssueNotificationParams) => `${p.piCode}: sắt đã xuất - vào xác nhận nhận`,
    message: (p: SteelIssueNotificationParams) => `${p.materialCode}: ${p.barCount} cây.`,
    link: () => ({ module: 'production', page: 'phoi-xac-nhan-nhan-sat' }),
    recipients: () => ({ roles: [BUSINESS_ROLES.PHOI_STAFF] }),
  } satisfies NotificationTypeDef<SteelIssueNotificationParams>,

  /** Phôi báo xong 1 đợt cắt - chờ KCS chấm. Tự đóng khi KCS `reviewCutBundle()`. `link` thêm ở
   *  mục 22.2 - cùng lý do STEEL_ISSUE_TO_PHOI, recipient chỉ KCS_STAFF nên an toàn nối. */
  CUT_BUNDLE_TO_KCS: {
    category: 'ACTION_REQUIRED',
    severity: 'INFO',
    entityType: 'CUT_BUNDLE',
    title: (p: QcSubmittedNotificationParams) => `${p.piCode}: Phôi báo xong đợt cắt`,
    message: () => 'Chờ KCS chấm.',
    link: () => ({ module: 'production', page: 'kcs-phoi' }),
    recipients: () => ({ roles: [BUSINESS_ROLES.KCS_STAFF] }),
  } satisfies NotificationTypeDef<QcSubmittedNotificationParams>,

  /** Phôi/Hàn/Sơn báo xong 1 đợt sản xuất (`ProductionBatch`, khác `CutBundle` - piece không qua
   *  bin-packing) - chờ KCS chấm. Tự đóng khi KCS `reviewProductionBatch()`. `link` thêm ở mục
   *  22.2 - KHÁC CUT_BUNDLE_TO_KCS: KCS xem theo 3 TAB RIÊNG (`kcs-phoi`/`kcs-han`/`kcs-son`) nên
   *  phải rẽ theo `p.stage` (đã truyền từ `ProductionBatchesService.finishProductionBatch()`, biết
   *  chắc `batch.stage` tại chỗ gọi) - không thể trỏ cố định 1 page. */
  BATCH_TO_KCS: {
    category: 'ACTION_REQUIRED',
    severity: 'INFO',
    entityType: 'PRODUCTION_BATCH',
    title: (p: QcSubmittedNotificationParams) => `${p.piCode}: đợt sản xuất báo xong`,
    message: () => 'Chờ KCS chấm.',
    link: (p: QcSubmittedNotificationParams) => ({
      module: 'production',
      page: p.stage === 'SON' ? 'kcs-son' : p.stage === 'HAN' ? 'kcs-han' : 'kcs-phoi',
    }),
    recipients: () => ({ roles: [BUSINESS_ROLES.KCS_STAFF] }),
  } satisfies NotificationTypeDef<QcSubmittedNotificationParams>,

  /** KCS chấm có lỗi (failedQty > 0) - báo tổ gửi (Phôi/Hàn/Sơn tuỳ nguồn) + QLSX. Không tự đóng
   *  (RESULT, không có hành động tiếp theo nào khoá bởi type này).
   *  VẪN KHÔNG `link` dù `?p=` đã sẵn (mục 22.2, khác STEEL_ISSUE_TO_PHOI/CUT_BUNDLE_TO_KCS/
   *  BATCH_TO_KCS ở trên) - 2 role nhận (tổ gửi + QLSX) cần 2 tab HÀNH ĐỘNG khác nhau trong CÙNG
   *  module `production` (tổ gửi cần `phoi-lenh-sx` để sửa/báo bù, QLSX không nằm trong điều kiện
   *  hiện tab đó ở `MfgApp.tsx` nên sẽ thấy màn trống) - đúng lớp vấn đề đã né ở
   *  PI_APPROVED_BY_BOSS (mục 16.2), chỉ khác là cùng module thay vì khác module. */
  QC_FAILED: {
    category: 'RESULT',
    severity: 'WARNING',
    entityType: 'QC_REVIEW',
    title: (p: QcResultNotificationParams) => `${p.piCode}: KCS chấm lỗi ${p.failedQty}`,
    message: () => 'Kiểm tra lại, sửa hoặc báo bù đủ bằng đợt mới.',
    recipients: (p: QcResultNotificationParams) => ({
      roles: [p.senderRole, BUSINESS_ROLES.PRODUCTION_MANAGER],
    }),
  } satisfies NotificationTypeDef<QcResultNotificationParams>,

  /** KCS chấm đạt (failedQty = 0) - báo QLSX. Đơn giản hoá so với plan gốc mục 7.5 ("gộp theo
   *  PI/ngày"): mỗi lượt duyệt phát 1 thông báo riêng, KHÔNG gộp theo ngày - xem changelog 2026-09-25
   *  mục 19.2 lý do (dedupeKey theo ngày dựa trên "count đã đọc lại từ thông báo cũ" dễ vỡ, rủi ro
   *  cao hơn lợi ích của 1 type chỉ mang tính thông tin). Không `link` (khác 3 type trên) - dù chỉ
   *  1 role (QLSX) nên VỀ MẶT KỸ THUẬT nối được, nhưng không có tab nào "về đúng việc vừa xảy ra"
   *  cho QLSX (khác Phôi/KCS có tab thao tác trực tiếp) - trỏ về `ke-hoach` (dashboard mặc định)
   *  không thêm giá trị gì so với việc QLSX tự bấm vào module của mình.
   */
  QC_PASSED: {
    category: 'RESULT',
    severity: 'INFO',
    entityType: 'QC_REVIEW',
    title: (p: QcSubmittedNotificationParams) => `${p.piCode}: KCS duyệt đạt`,
    message: () => 'Không có lỗi.',
    recipients: () => ({ roles: [BUSINESS_ROLES.PRODUCTION_MANAGER] }),
  } satisfies NotificationTypeDef<QcSubmittedNotificationParams>,

  // ─── Phase 3b, nhóm 7.5-ii "Xuất vật tư tiêu hao / vật tư thành phẩm / bao bì" (2026-09-28,
  // xem changelog mục 22) ───────────────────────────────────────────────────────────────────────
  /** Kho xuất vật tư tiêu hao (CO₂, dây hàn, bột sơn...) cho Hàn/Sơn - tổ nhận vào xác nhận đã
   *  nhận. Tự đóng khi tổ nhận `MaterialIssuesService.receive()`. 1 type dùng chung 2 stage (mirror
   *  QC_FAILED) - `link` cố định 1 page vì `han-son-xac-nhan-vat-tu` (MfgApp.tsx) là tab DÙNG
   *  CHUNG cho cả Hàn lẫn Sơn, tự chọn đúng `stage` theo `user.mfgRole` của người xem, không theo
   *  URL - khác BATH_TO_KCS phải rẽ link vì KCS xem Hàn/Sơn ở 2 TAB RIÊNG. */
  MATERIAL_ISSUE_TO_TEAM: {
    category: 'ACTION_REQUIRED',
    severity: 'INFO',
    entityType: 'MATERIAL_ISSUE',
    title: (p: MaterialIssueNotificationParams) =>
      `${p.piCode}: vật tư đã xuất - vào xác nhận nhận`,
    message: (p: MaterialIssueNotificationParams) => `${p.materialCode}: ${p.qty} ${p.unit}.`,
    link: () => ({ module: 'production', page: 'han-son-xac-nhan-vat-tu' }),
    recipients: (p: MaterialIssueNotificationParams) => ({
      roles: [p.stage === 'SON' ? BUSINESS_ROLES.SON_STAFF : BUSINESS_ROLES.HAN_STAFF],
    }),
  } satisfies NotificationTypeDef<MaterialIssueNotificationParams>,

  /** Kho xuất vật tư thành phẩm (Sắt La → Pat, thanh nhôm → chân nhôm...) cho Phôi - vào xác nhận
   *  đã nhận. Tự đóng khi Phôi `MaterialYieldIssuesService.receive()`. Cùng trang với
   *  STEEL_ISSUE_TO_PHOI (`XacNhanNhanSatPage.tsx` xử lý CẢ 2 loại "xác nhận nhận" của Phôi). */
  MATERIAL_YIELD_ISSUE_TO_PHOI: {
    category: 'ACTION_REQUIRED',
    severity: 'INFO',
    entityType: 'MATERIAL_YIELD_ISSUE',
    title: (p: MaterialIssueNotificationParams) =>
      `${p.piCode}: vật tư đã xuất - vào xác nhận nhận`,
    message: (p: MaterialIssueNotificationParams) => `${p.materialCode}: ${p.qty} ${p.unit}.`,
    link: () => ({ module: 'production', page: 'phoi-xac-nhan-nhan-sat' }),
    recipients: () => ({ roles: [BUSINESS_ROLES.PHOI_STAFF] }),
  } satisfies NotificationTypeDef<MaterialIssueNotificationParams>,

  /** Kho xuất vật tư đóng gói (tem nhãn, màng PE, túi zip...) cho PO - báo QLSX theo dõi tiến độ.
   *  KHÔNG có bước "nhận hàng" (`PackagingIssuesService` không có `receive()` - cả kho nguồn lẫn
   *  kho đích đều là thủ kho, xem doc comment đầu service đó) nên KHÔNG tự đóng (INFO thuần, không
   *  phải ACTION_REQUIRED) - đã chốt với người dùng TRƯỚC khi code ở mục 19.1 lúc rà toàn bộ bảng
   *  7.5. Không `link` - không có màn nào cho QLSX xem riêng "các lần xuất đóng gói", trỏ về
   *  `ke-hoach` (dashboard mặc định) không thêm giá trị gì (cùng lý do QC_PASSED). */
  PACKAGING_ISSUE_CREATED: {
    category: 'INFO',
    severity: 'INFO',
    entityType: 'PACKAGING_ISSUE',
    title: (p: MaterialIssueNotificationParams) => `${p.piCode}: vật tư đóng gói đã xuất`,
    message: (p: MaterialIssueNotificationParams) => `${p.materialCode}: ${p.qty} ${p.unit}.`,
    recipients: () => ({ roles: [BUSINESS_ROLES.PRODUCTION_MANAGER] }),
  } satisfies NotificationTypeDef<MaterialIssueNotificationParams>,

  // ─── Phase 3b, nhóm 7.5-iii "Chuyển kho ngoài đơn hàng" (2026-09-28, xem changelog mục 23) ────
  /** Phiếu chuyển kho vừa tạo (vật tư hoặc mảnh - `WarehouseTransfersService.create()`/
   *  `createPieceTransfer()`) - báo kho ĐÍCH vào xác nhận/từ chối. Tự đóng khi kho đích
   *  `confirm()` HOẶC `reject()` (cả 2 đều đưa phiếu rời PENDING). `link` trỏ tới sub-tab "Nhập nội
   *  bộ" của `NhapKhoPage.tsx` qua `link.params.sub` - lần ĐẦU TIÊN 1 type thực sự dùng tới
   *  `NotificationLink.params` (trường đã có sẵn nhưng `NotificationCenter.tsx`/
   *  `MyNotificationsPage.tsx` trước đây KHÔNG hề đọc, xem mục 23.2) vì `NhapKhoPage` có 2 sub-tab
   *  hoàn toàn khác chức năng ("Nhập kho" mua hàng vs "Nhập nội bộ" chuyển kho) chọn bằng local
   *  state - chỉ trỏ `page:'nhap-kho'` sẽ luôn rơi vào sub-tab SAI (mặc định "Nhập kho"), đúng lớp
   *  "gây hiểu lầm hơn không link" đã né nhiều lần trước (mục 12.6) nếu không sửa. */
  WAREHOUSE_TRANSFER_CREATED: {
    category: 'ACTION_REQUIRED',
    severity: 'INFO',
    entityType: 'WAREHOUSE_TRANSFER',
    title: (p: WarehouseTransferNotificationParams) => `Phiếu ${p.code} chờ xác nhận nhận hàng`,
    message: (p: WarehouseTransferNotificationParams) =>
      `Từ ${p.fromWarehouseName}: ${p.itemCount} dòng.`,
    link: () => ({ module: 'inbound_warehouse', page: 'nhap-kho', params: { sub: 'noi-bo' } }),
    recipients: (p: WarehouseTransferNotificationParams & { toWarehouseCode: string }) => ({
      warehouseIds: [p.toWarehouseCode],
    }),
  } satisfies NotificationTypeDef<
    WarehouseTransferNotificationParams & { toWarehouseCode: string }
  >,

  /** Kho đích từ chối phiếu (kèm lý do) - báo NGƯỜI TẠO phiếu. Không tự đóng (RESULT, không có
   *  hành động tiếp theo nào khoá bởi type này). `link` trỏ "Lịch sử kho" (`lich-su-kho`, tự scope
   *  theo kho của người xem, không cần tham số) - nơi DUY NHẤT xem lại phiếu đã REJECTED (mục
   *  "Nhập nội bộ" chỉ hiện phiếu PENDING, xem doc comment `NhapNoiBoSection`). An toàn nối 1 page
   *  cố định vì mọi kho (vat-tu-tp/phoi-son-han/thanh-pham) đều thấy tab này. */
  WAREHOUSE_TRANSFER_REJECTED: {
    category: 'RESULT',
    severity: 'WARNING',
    entityType: 'WAREHOUSE_TRANSFER',
    title: (p: WarehouseTransferNotificationParams) => `Phiếu ${p.code} bị từ chối`,
    message: (p: WarehouseTransferNotificationParams) => `Lý do: ${p.reason}`,
    link: () => ({ module: 'inbound_warehouse', page: 'lich-su-kho' }),
    recipients: (p: WarehouseTransferNotificationParams & { createdById: string }) => ({
      userIds: [p.createdById],
    }),
  } satisfies NotificationTypeDef<WarehouseTransferNotificationParams & { createdById: string }>,

  // ─── Phase 3b, nhóm 7.5-v "Chuyền kiểm có lỗi" (2026-09-28, xem changelog mục 24) ──────────
  /** Thủ kho ghi nhận 1 lần "Chuyền kiểm" (`ProductionInvoicesService.recordTransferCheck()`) có
   *  kèm lỗi - báo QLSX. Không tự đóng (RESULT, không có hành động tiếp theo nào khoá bởi type
   *  này - khác `ACTION_REQUIRED`, mảnh lỗi được xử lý ngoài phần mềm). Không `link` - màn "Chuyền
   *  kiểm" (`KhoChuyenKiemPage.tsx`) thuộc module `inbound_warehouse` (thủ kho thao tác), QLSX
   *  không có tab này trong module `production` của mình - trỏ vào sẽ vô nghĩa/gây hiểu lầm, đúng
   *  tinh thần mục 12.6. */
  TRANSFER_CHECK_DEFECT_FOUND: {
    category: 'RESULT',
    severity: 'WARNING',
    entityType: 'TRANSFER_CHECK_RESULT',
    title: (p: TransferCheckDefectNotificationParams) =>
      `${p.piCode}: ${p.pieceName} chuyền kiểm có lỗi`,
    message: (p: TransferCheckDefectNotificationParams) =>
      p.defectCount > 1 ? `${p.reason} (và ${p.defectCount - 1} lỗi khác).` : `${p.reason}.`,
    recipients: () => ({ roles: [BUSINESS_ROLES.PRODUCTION_MANAGER] }),
  } satisfies NotificationTypeDef<TransferCheckDefectNotificationParams>,

  // ─── Phase 3b, nhóm 7.5-vi "Đóng gói xong → Sales" (2026-09-28, xem changelog mục 25) ──────
  /** SKU vừa đóng gói ĐỦ số lượng (`ProductionInvoicesService.recordPackaging()`, khi
   *  `packedQty` đạt đúng `productionOrder.quantity`) - báo Sales dòng đơn đã sẵn sàng giao. Tự
   *  nhiên chỉ bắn ĐÚNG 1 LẦN cho mỗi item (nghiệp vụ đã chặn `packedQty` vượt `totalQty` ngay từ
   *  `recordPackaging()`, nên gọi lại sau khi đã đủ luôn bị 400 - không cần dedupe/guard thêm).
   *  Không tự đóng (RESULT, Sales tự `shipItem()` khi thật sự giao, không phải hành động khoá bởi
   *  type này). `link` trỏ `sales/orders` (`OrderManagementPage.tsx`) - an toàn nối vì recipient
   *  chỉ 1 role SALES_STAFF, không lẫn role khác cần tab riêng. */
  PI_ITEM_PACKAGING_COMPLETE: {
    category: 'RESULT',
    severity: 'SUCCESS',
    entityType: 'PRODUCTION_INVOICE_ITEM',
    title: (p: PackagingCompleteNotificationParams) =>
      `${p.piCode}: ${p.factoryCode} đã đóng gói xong`,
    message: (p: PackagingCompleteNotificationParams) => `Đơn ${p.salesOrderCode} sẵn sàng giao.`,
    link: () => ({ module: 'sales', page: 'orders' }),
    recipients: () => ({ roles: [BUSINESS_ROLES.SALES_STAFF] }),
  } satisfies NotificationTypeDef<PackagingCompleteNotificationParams>,

  // ─── Cắt sắt (Phase 1, xem lịch sử ở changelog 2026-09-25/26) ──────────────────────────────
  /** Tính xong + tự duyệt ngay (Sếp chốt 2026-08-15: không cần QLSX bấm duyệt riêng).
   *
   *  2026-09-26 (người dùng chốt): đây là type CẮT SẮT DUY NHẤT còn báo QLSX - 3 nhánh
   *  "không thành công" (cần duyệt tay / auto-duyệt lỗi / solver lỗi) đã bị BỎ HẲN (không chỉ bỏ
   *  `link` như lần sửa trước), quay lại đúng flow cũ: chỉ báo khi tính xong VÀ tự duyệt OK, im
   *  lặng ở mọi nhánh còn lại (vẫn có `logger.error`/`logger.warn` trong
   *  `cutting-proposals.service.ts` cho ai đọc log server). Lý do: 3 nhánh kia luôn trỏ ý "còn
   *  việc cần QLSX làm" nhưng KHÔNG có màn nào cho QLSX làm việc đó (mục 12.6 changelog
   *  2026-09-25) - thông báo không hành động được coi là nhiễu hơn là hữu ích ở giai đoạn này. */
  CUTTING_PROPOSAL_AUTO_APPROVED: {
    category: 'RESULT',
    severity: 'SUCCESS',
    entityType: 'CUTTING_PROPOSAL',
    title: (p: CuttingProposalNotificationParams) =>
      `Đề xuất cắt sắt cho ${p.poNumber} đã tính xong và tự động duyệt`,
    message: () => 'Đã tự trừ tồn kho và chuyển đề xuất mua hàng (nếu thiếu vật tư) sang Mua hàng.',
    recipients: cuttingProposalRecipients,
  } satisfies NotificationTypeDef<CuttingProposalNotificationParams>,

  // ─── Ngưỡng hao hụt mặc định (2026-09-30) ───────────────────────────────────────────────────
  /** KHSX đổi ngưỡng hao hụt mặc định cắt sắt -> báo Sếp + QLSX để biết và can thiệp nếu không đồng ý
   *  (không cần Sếp duyệt trước - đã có AuditLog). KHÔNG gắn `link`: 2 role nhận thuộc 2 module "nhà"
   *  khác nhau, 1 link không đúng cho cả hai (cùng lý do PI_APPROVED_BY_BOSS). */
  CUTTING_WASTE_DEFAULT_CHANGED: {
    category: 'INFO',
    severity: 'WARNING',
    entityType: 'SYSTEM_CONFIG',
    title: (p: CuttingWasteDefaultChangedParams) =>
      `Ngưỡng hao hụt mặc định đổi: ${p.previous}% → ${p.next}%`,
    message: (p: CuttingWasteDefaultChangedParams) =>
      `${p.actorName} (KHSX) đổi ngưỡng hao hụt mặc định cho cắt sắt${
        p.reason ? ` — lý do: ${p.reason}` : ''
      }. Áp cho loại sắt chưa có ngưỡng riêng, mọi lượt tính từ giờ.`,
    recipients: () => ({ roles: [BUSINESS_ROLES.BOSS, BUSINESS_ROLES.PRODUCTION_MANAGER] }),
  } satisfies NotificationTypeDef<CuttingWasteDefaultChangedParams>,

  // ─── Solve trước → tạo PI (2026-09-30) ─────────────────────────────────────────────────────
  /** Lượt tính cắt sắt KHSX bấm ở "Tối ưu cắt sắt" đã xong VÀ dùng được (mọi loại sắt cắt được,
   *  không vượt ngưỡng) - báo đích danh người bấm để họ quay lại tạo lệnh sản xuất. Khác
   *  CUTTING_PROPOSAL_AUTO_APPROVED (báo QLSX sau khi Sếp duyệt, luồng cũ). */
  CUTTING_SOLVE_DONE: {
    category: 'RESULT',
    severity: 'SUCCESS',
    entityType: 'CUTTING_PROPOSAL',
    title: (p: CuttingSolveNotificationParams) => `Đã tính xong phương án cắt: ${p.label}`,
    message: (p: CuttingSolveNotificationParams) =>
      `${p.summary ?? 'Phương án dùng được'} - vào "Tối ưu cắt sắt" để tạo lệnh sản xuất.`,
    link: () => ({ module: 'production_plan', page: 'gom-cat' }),
    recipients: (p: CuttingSolveNotificationParams) => ({ userIds: [p.requestedById] }),
    notifyActor: true,
  } satisfies NotificationTypeDef<CuttingSolveNotificationParams>,

  /** Lượt tính xong nhưng CHƯA dùng được (có loại sắt không cắt được / vượt ngưỡng) hoặc solver
   *  lỗi/hết giờ - KHSX phải chỉnh (gộp khác, xin đặc cách, cây riêng) rồi tính lại. Đây chính là
   *  chỗ luồng cũ im lặng (Sếp duyệt xong mới lòi ra, không ai được báo). */
  CUTTING_SOLVE_FAILED: {
    category: 'ALERT',
    severity: 'WARNING',
    entityType: 'CUTTING_PROPOSAL',
    title: (p: CuttingSolveNotificationParams) => `Phương án cắt chưa dùng được: ${p.label}`,
    message: (p: CuttingSolveNotificationParams) =>
      `${p.reason ?? 'Solver không cho ra phương án'} - chỉnh tổ hợp/thông số ở "Tối ưu cắt sắt" rồi tính lại.`,
    link: () => ({ module: 'production_plan', page: 'gom-cat' }),
    recipients: (p: CuttingSolveNotificationParams) => ({ userIds: [p.requestedById] }),
    notifyActor: true,
  } satisfies NotificationTypeDef<CuttingSolveNotificationParams>,

  // ─── Phase 3b, nhóm 7.5-iv "Xuất/nhận đan" (2026-09-28, xem changelog mục 26) ──────────────
  /** Kho vật tư-TP xuất mảnh cho 1 điểm đan (`WeavingIssuesService.create()`) - báo kho thành phẩm
   *  biết có hàng đang treo tại điểm đan đó, chờ nhận về. Tự đóng khi kho thành phẩm nhận ĐỦ
   *  (`WeavingIssuesService.receive()`, outstanding về đúng 0). Không nhắm đích danh 1 kho vật lý cụ
   *  thể như `WAREHOUSE_TRANSFER_CREATED` (nơi `toWarehouseId` do người tạo phiếu CHỌN TAY) - ở đây
   *  `WeavingIssue`/`WeavingReceipt` không lưu warehouseId nào cả (chỉ có productionOrderId/pieceId/
   *  weavingPointId, xem schema.prisma) nên phải báo CẢ GIA ĐÌNH kho 'thanh-pham' (mọi thủ kho
   *  thuộc gia đình đó, dù có nhiều kho vật lý - `warehouseCodes` do call site tự liệt kê qua
   *  `resolveThanhPhamWarehouseCodes()`, không phải field hiển thị). */
  WEAVING_ISSUE_TO_POINT: {
    category: 'ACTION_REQUIRED',
    severity: 'INFO',
    entityType: 'WEAVING_ALLOCATION',
    title: (p: WeavingIssueNotificationParams) =>
      `${p.poNumber}: ${p.pieceName} đang chờ nhận về từ điểm đan ${p.weavingPointName}`,
    message: (p: WeavingIssueNotificationParams) => `Đang treo: ${p.outstandingQty}.`,
    link: () => ({ module: 'inbound_warehouse', page: 'nhap-dan' }),
    recipients: (p: WeavingIssueNotificationParams & { warehouseCodes: string[] }) => ({
      warehouseIds: p.warehouseCodes,
    }),
  } satisfies NotificationTypeDef<WeavingIssueNotificationParams & { warehouseCodes: string[] }>,
};

/** Danh mục loại thông báo - 1 nguồn duy nhất cho text/link/mức độ/người nhận (mục 5.2 changelog
 *  2026-09-25). Thêm type mới ở Phase 3 thì thêm 1 khoá vào đây, KHÔNG rải rác ở service khác. */
// Mỗi type có 1 shape params khác nhau (P riêng qua `satisfies` ở từng entry phía trên) - map tổng
// hợp buộc phải xoá kiểu cụ thể đó để giữ được 1 Record đồng nhất; NotificationsService.emit()
// nhận params: Record<string, unknown> nên không có chỗ nào thực sự dựa vào P cụ thể ở đây (`any`
// ở đây chỉ là warn theo eslint.config.mjs, không phải error - không cần eslint-disable).
export const NOTIFICATION_TYPES: Record<
  string,
  NotificationTypeDef<any>
> = notificationTypeDefinitions;

export type NotificationType = keyof typeof notificationTypeDefinitions;
