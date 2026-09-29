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
    recipients: (p: PurchaseProposalNotificationParams & { warehouseId?: string }) => ({
      ...(p.warehouseId ? { warehouseIds: [p.warehouseId] } : {}),
      roles: [BUSINESS_ROLES.PRODUCTION_MANAGER],
    }),
  } satisfies NotificationTypeDef<PurchaseProposalNotificationParams & { warehouseId?: string }>,

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
