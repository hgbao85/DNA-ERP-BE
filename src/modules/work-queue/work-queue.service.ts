import { Inject, Injectable } from '@nestjs/common';
import { BUSINESS_ROLES } from '../../common/constants/roles.constant';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CuttingProposalsService } from '../cutting-proposals/cutting-proposals.service';
import { PENDING_APPROVAL_STATUSES } from '../purchase-proposals/purchase-proposals.service';
import { SalesOrdersService } from '../sales-orders/sales-orders.service';
import { WorkQueueResponseDto } from './dto/work-queue-response.dto';

/**
 * Badge "việc chờ tôi" trên menu - mục 6.3 changelog 2026-09-25 (Phase 4). Đây là QUERY đọc trực
 * tiếp trạng thái nghiệp vụ hiện tại (KHÔNG suy từ bảng `notifications`) - "luôn khớp dữ liệu" theo
 * đúng yêu cầu mục 6.3, không lệch nếu người dùng bỏ lỡ/xoá thông báo.
 *
 * Chỉ tính những khoá KHỚP ĐÚNG role của người gọi (không query dư cho role họ không có) - 1 user
 * có thể có nhiều role (vd 'sales' account vừa WAREHOUSE_STAFF vừa SALES_STAFF, xem seed-demo.ts)
 * nên trả về nhiều khoá cùng lúc là bình thường.
 *
 * 5 chỗ bảng plan gốc mục 6.3 SAI/THIẾU so với code thật hiện tại (research kỹ trước khi code,
 * 2026-09-29) - xem đúng vị trí tương ứng bên dưới để biết lý do từng chỗ:
 * 1. QLSX "cắt sắt cần duyệt tay/FAILED": vẫn còn thật (mục 14 chỉ bỏ THÔNG BÁO, không bỏ trạng
 *    thái/hành động) nhưng phải tái dùng `computeDisplayStatus()` (CuttingProposalsService), không
 *    phải `status IN (DRAFT, FAILED)` thô - sẽ đếm nhầm DRAFT đang trong cửa sổ tự-duyệt 60s.
 * 2. Mua hàng "NEW/QUOTING": QUOTING là tàn dư chết, thiếu SUBMITTED/REJECTED (vẫn sống qua
 *    bossApprove()) - dùng PENDING_APPROVAL_STATUSES (purchase-proposals.service.ts) thay vì liệt
 *    kê lại.
 * 3. KCS "cut bundle/batch AWAITING_QC": thiếu StepBundle + PieceStepBundle (2 bảng AWAITING_QC
 *    thật khác, phục vụ công đoạn phụ của Phôi cho Sắt/vật tư thành phẩm).
 * 4. Sales "dòng đơn DONG_GOI/HOAN_THANH": SalesOrderItem.status đứng yên LEN_KE_HOACH vĩnh viễn
 *    (xem doc comment SalesOrdersService.resolveStages()) - PHẢI gọi countReadyToShip() (dẫn xuất
 *    từ dữ liệu sản xuất thật), lọc thẳng cột status sẽ luôn ra 0.
 * 5. Spec "SKU cần định mức": thiếu điều kiện loại `PlanForm.origin='PRODUCTION_CONFIRM'` (SKU tự
 *    tạo khi Sếp duyệt PI item, ẩn khỏi mọi màn Spec/KHSX) - thiếu điều kiện này sẽ đếm dư.
 */
@Injectable()
export class WorkQueueService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly cuttingProposalsService: CuttingProposalsService,
    private readonly salesOrdersService: SalesOrdersService,
  ) {}

  async getWorkQueue(user: {
    roles: string[];
    warehouseScope: string | null;
  }): Promise<WorkQueueResponseDto> {
    const has = (role: string) => user.roles.includes(role);
    const counts: Record<string, number> = {};
    const tasks: Promise<void>[] = [];
    const set = (key: string, value: Promise<number>) => {
      tasks.push(
        value.then((n) => {
          counts[key] = n;
        }),
      );
    };

    if (has(BUSINESS_ROLES.PRODUCTION_MANAGER)) {
      set('qlsxProductionQueue', this.countQlsxProductionQueue());
    }
    if (has(BUSINESS_ROLES.BOSS)) {
      set(
        'bossSkuApproval',
        this.prisma.planForm.count({ where: { status: 'WAITING_BOSS_APPROVAL' } }),
      );
      set(
        'bossProductionApproval',
        this.prisma.productionInvoiceItem.count({ where: { prodApprovalStatus: 'WAITING_BOSS' } }),
      );
    }
    if (has(BUSINESS_ROLES.PRODUCTION_PLANNER)) {
      set('khsxSkuReview', this.countKhsxSkuReview());
      set(
        'khsxProductionRejected',
        this.prisma.productionInvoiceItem.count({ where: { prodApprovalStatus: 'REJECTED' } }),
      );
    }
    if (has(BUSINESS_ROLES.SPEC_STEEL_STAFF)) {
      set('specSteelQuota', this.countSpecManhQuota());
    }
    if (has(BUSINESS_ROLES.SPEC_ACCESSORY_PACKAGING_STAFF)) {
      set('specDetailQuota', this.countSpecDetailQuota());
    }
    if (has(BUSINESS_ROLES.PURCHASER)) {
      set(
        'purchaserPending',
        this.prisma.purchaseProposalItem.count({
          where: { status: { in: PENDING_APPROVAL_STATUSES } },
        }),
      );
    }
    if (has(BUSINESS_ROLES.WAREHOUSE_STAFF)) {
      set('warehouseTransferPending', this.countWarehouseTransferPending(user.warehouseScope));
      set('warehousePurchaseReceiving', this.countWarehousePurchaseReceiving(user.warehouseScope));
    }
    if (has(BUSINESS_ROLES.PHOI_STAFF)) {
      set('phoiSteelReceiving', this.prisma.steelIssue.count({ where: { status: 'ISSUED' } }));
    }
    if (has(BUSINESS_ROLES.KCS_STAFF)) {
      const kcs = this.countKcs();
      tasks.push(
        kcs.then(({ phoi, han, son }) => {
          counts.kcsPhoi = phoi;
          counts.kcsHan = han;
          counts.kcsSon = son;
        }),
      );
    }
    if (has(BUSINESS_ROLES.SALES_STAFF)) {
      set('salesReadyToShip', this.salesOrdersService.countReadyToShip());
    }

    await Promise.all(tasks);
    return new WorkQueueResponseDto({ counts });
  }

  /** PI item WAITING_QLSX + đề xuất cắt sắt cần QLSX xử lý tay (xem lệch #1 ở doc comment lớp). */
  private async countQlsxProductionQueue(): Promise<number> {
    const [waitingQlsx, needsAction] = await Promise.all([
      this.prisma.productionInvoiceItem.count({ where: { prodApprovalStatus: 'WAITING_QLSX' } }),
      this.cuttingProposalsService.countNeedsAction(),
    ]);
    return waitingQlsx + needsAction;
  }

  /** Định mức mảnh (SAT) + chi tiết (DAY_SON) đã nộp, đang chờ KHSX ra quyết định (status=null -
   *  xem PlanFormManhReview/PlanFormDetailReview doc comment, MANH_GROUPS/DETAIL_GROUPS trong
   *  skus.service.ts chỉ thật sự dùng đúng 1 group mỗi bên, không phải cả 3 giá trị enum). */
  private async countKhsxSkuReview(): Promise<number> {
    const [manh, detail] = await Promise.all([
      this.prisma.planFormManhReview.count({ where: { group: 'SAT', status: null } }),
      this.prisma.planFormDetailReview.count({ where: { group: 'DAY_SON', status: null } }),
    ]);
    return manh + detail;
  }

  /** SKU chưa nộp định mức mảnh HOẶC vừa bị KHSX trả về - loại `origin='PRODUCTION_CONFIRM'` (SKU
   *  tự tạo khi Sếp duyệt PI item, ẩn khỏi mọi màn Spec - xem lệch #5 ở doc comment lớp). */
  private async countSpecManhQuota(): Promise<number> {
    return this.prisma.planForm.count({
      where: {
        origin: { not: 'PRODUCTION_CONFIRM' },
        OR: [
          { manhReviews: { none: { group: 'SAT' } } },
          { manhReviews: { some: { group: 'SAT', status: 'REJECTED' } } },
        ],
      },
    });
  }

  /** Tương tự countSpecManhQuota() cho nhánh chi tiết (Sơn/Phụ kiện/Bao bì, group DAY_SON). */
  private async countSpecDetailQuota(): Promise<number> {
    return this.prisma.planForm.count({
      where: {
        origin: { not: 'PRODUCTION_CONFIRM' },
        OR: [
          { detailReviews: { none: { group: 'DAY_SON' } } },
          { detailReviews: { some: { group: 'DAY_SON', status: 'REJECTED' } } },
        ],
      },
    });
  }

  /** null warehouseScope = tổng kho (Admin/Boss dùng role WAREHOUSE_STAFF hiếm khi xảy ra) - không
   *  lọc gì, đếm mọi kho. */
  private async countWarehouseTransferPending(warehouseScope: string | null): Promise<number> {
    return this.prisma.warehouseTransfer.count({
      where: {
        status: 'PENDING',
        ...(warehouseScope ? { toWarehouse: { code: warehouseScope } } : {}),
      },
    });
  }

  /** Mirror đúng cách PurchaseProposalsService.receiveItem() xác định kho nhận: ưu tiên
   *  `receiveWarehouseCode` (ghi đè), fallback `Material.warehouseId` khi null. */
  private async countWarehousePurchaseReceiving(warehouseScope: string | null): Promise<number> {
    return this.prisma.purchaseProposalItem.count({
      where: {
        status: 'PURCHASING',
        ...(warehouseScope
          ? {
              OR: [
                { receiveWarehouseCode: warehouseScope },
                { receiveWarehouseCode: null, material: { warehouse: { code: warehouseScope } } },
              ],
            }
          : {}),
      },
    });
  }

  /** 4 bảng AWAITING_QC thật (xem lệch #3 ở doc comment lớp) - CutBundle/StepBundle/
   *  PieceStepBundle đều là "Cắt/công đoạn phụ" của Phôi (tab kcs-phoi), ProductionBatch tách theo
   *  `stage` (PHOI/HAN/SON) cho đúng 3 tab riêng của màn KCS. */
  private async countKcs(): Promise<{ phoi: number; han: number; son: number }> {
    const [cutBundle, stepBundle, pieceStepBundle, batchPhoi, batchHan, batchSon] =
      await Promise.all([
        this.prisma.cutBundle.count({ where: { status: 'AWAITING_QC' } }),
        this.prisma.stepBundle.count({ where: { status: 'AWAITING_QC' } }),
        this.prisma.pieceStepBundle.count({ where: { status: 'AWAITING_QC' } }),
        this.prisma.productionBatch.count({ where: { stage: 'PHOI', status: 'AWAITING_QC' } }),
        this.prisma.productionBatch.count({ where: { stage: 'HAN', status: 'AWAITING_QC' } }),
        this.prisma.productionBatch.count({ where: { stage: 'SON', status: 'AWAITING_QC' } }),
      ]);
    return {
      phoi: cutBundle + stepBundle + pieceStepBundle + batchPhoi,
      han: batchHan,
      son: batchSon,
    };
  }
}
