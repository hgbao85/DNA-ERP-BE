import { MaterialDetailKind, ProdItemStageType } from '../../generated/prisma/client';

export interface FrameDeadlineItem {
  materialDeadline: Date | null;
  stages: { stageType: ProdItemStageType; deadline: Date }[];
  productionInvoice: { deadline: Date | null } | null;
}

/**
 * Hạn dùng để xếp thứ tự gấp, theo thứ tự ưu tiên:
 *   1. `materialDeadline` của chính item - hạn VẬT TƯ phải sẵn sàng, sát nghĩa nhất với việc
 *      cắt sắt (cắt xong mới có phôi để làm).
 *   2. Mốc Khung cơ khí (FRAME) - công đoạn chứa Phôi.
 *   3. Hạn của cả phiếu sản xuất.
 * KHÔNG rơi tiếp về SalesOrderItem.deliveryDate: SalesOrderItem không có FK tới
 * ProductionInvoiceItem, chỉ khớp được qua mfgProductId mà 1 đơn có thể có nhiều dòng cùng sản
 * phẩm - khớp nhầm hạn còn tệ hơn không có hạn. null = xếp CUỐI, hiện "chưa có hạn".
 *
 * `productionInvoice` nullable (2026-08-20): item vừa tạo từ PO, chưa được KHSX gom, chưa có
 * PI để rơi về mốc 3 - lúc đó chỉ còn materialDeadline/FRAME quyết định.
 *
 * Tách thành util đứng riêng (2026-08-26, L5) thay vì method private của CuttingProposalsService
 * (nơi định nghĩa gốc) vì StockReservationsService cũng cần ĐÚNG thứ tự ưu tiên này để xếp hạng
 * SKU nào được ưu tiên khi credit/drain pool giữ chỗ theo PI - 2 service không nên phụ thuộc
 * chéo chỉ để dùng chung 1 hàm thuần tính toán.
 */
export function frameDeadlineOf(item: FrameDeadlineItem): Date | null {
  const frame = item.stages.find((s) => s.stageType === ProdItemStageType.FRAME);
  return item.materialDeadline ?? frame?.deadline ?? item.productionInvoice?.deadline ?? null;
}

/**
 * 2 nhóm mua theo hạn (Sếp chốt, changelog 2026-09-25 mục 32.5 / 32.7): "VT còn lại" = phụ kiện, nệm, bao bì (theo hạn Đóng
 * gói); mọi thứ khác (sắt, dây, đinh, tán rút, nút, sơn, vật tư hàn/cắt...) là "VT khung & đan" (theo hạn bắt đầu Phôi).
 */
export type PurchaseDeadlineGroup = 'FRAME' | 'FINISHED';

const FINISHED_KINDS = new Set<MaterialDetailKind>([
  MaterialDetailKind.ACCESSORY,
  MaterialDetailKind.CUSHION,
  MaterialDetailKind.PACKAGING,
]);

export function purchaseGroupOf(
  detailKind: MaterialDetailKind | null | undefined,
): PurchaseDeadlineGroup {
  return detailKind && FINISHED_KINDS.has(detailKind) ? 'FINISHED' : 'FRAME';
}

export interface PurchaseDeadlineItem extends FrameDeadlineItem {
  finishedMaterialDeadline: Date | null;
}

/**
 * Hạn vật tư phải về của 1 dòng SKU theo nhóm mua - 1 hàm dùng chung cho Bảng mốc / tin sáng và "Theo dõi mua hàng" để 2 màn
 * không nói 2 ngày khác nhau (test thật 32.27, phần D của 32.5). Chỉ dùng ngày ĐÃ LƯU, không tự trừ ngày theo mốc Phú An:
 *  - VT khung & đan: `frameDeadlineOf` (hạn Mua VT khung → hạn Khung → hạn PI);
 *  - VT còn lại: hạn Mua VT còn lại → hạn Đóng gói → hạn PI.
 */
export function purchaseDeadlineOf(
  item: PurchaseDeadlineItem,
  group: PurchaseDeadlineGroup,
): Date | null {
  if (group === 'FRAME') return frameDeadlineOf(item);
  const packaging = item.stages.find((s) => s.stageType === ProdItemStageType.PACKAGING);
  return (
    item.finishedMaterialDeadline ?? packaging?.deadline ?? item.productionInvoice?.deadline ?? null
  );
}
