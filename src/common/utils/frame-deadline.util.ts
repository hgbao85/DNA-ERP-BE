import { ProdItemStageType } from '../../generated/prisma/client';

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
