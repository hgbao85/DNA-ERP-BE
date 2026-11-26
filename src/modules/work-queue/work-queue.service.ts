import { Inject, Injectable } from '@nestjs/common';
import { MfgRole } from '../../generated/prisma/client';
import { isCkDgQrEnabled } from '../ck-dg-qr/ck-dg-qr.config';
import { BUSINESS_ROLES } from '../../common/constants/roles.constant';
import { WorkshopScopeService } from '../../common/workshop-scope/workshop-scope.service';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CuttingProposalsService } from '../cutting-proposals/cutting-proposals.service';
import { PENDING_APPROVAL_STATUSES } from '../purchase-proposals/purchase-proposals.service';
import { SalesOrdersService } from '../sales-orders/sales-orders.service';
import { PaintTransferReminderService } from '../warehouse-transfers/paint-transfer-reminder.service';
// Phần A – Đợt 4 (YC6): badge Vật tư cần về
import { MaterialsDueService } from '../materials-due/materials-due.service';
import { countKcsByStage, listKcsPendingItems } from '../floor/kcs-pending.util';
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
 * 3. KCS: số đợt chờ chấm lấy từ kcs-pending.util (đang mở + đã chốt, 5 loại) - xem countKcs().
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
    // Phần A – Đợt 4 (YC6)
    private readonly materialsDueService: MaterialsDueService,
    private readonly workshopScope: WorkshopScopeService,
    // N1 (18/11/2026): số lệnh còn mảnh hàn xong chờ chuyển sang kho Sơn (thủ kho Hàn của xưởng không có kho Sơn).
    private readonly paintReminder: PaintTransferReminderService,
  ) {}

  async getWorkQueue(user: {
    /** Phần A – Đợt 4: id người gọi - badge Vật tư cần về của người mua tính theo vật tư mình phụ trách. */
    id?: string;
    roles: string[];
    warehouseScope: string | null;
    /** CK_DG_QR (24/11/2026): KCS chuyền kiểm là tài khoản PIN (vai FLOOR_WORKER) - nhận biết qua mfgRole. */
    mfgRole?: string | null;
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
      set('qlsxProductionQueue', this.countQlsxProductionQueue(user.id));
      set('qlsxAwaitingFinish', this.countQlsxAwaitingFinish(user.id));
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
      // Phần A – Đợt 9 (YC2): lô đổi mốc lệnh đã duyệt đang chờ Sếp duyệt lại (đếm thẳng bằng prisma, không import module PI - tránh vòng).
      set(
        'bossDeadlineChange',
        this.prisma.deadlineChangeBatch.count({ where: { status: 'PENDING' } }),
      );
      // Huỷ lệnh theo SKU (23/11/2026): đề nghị huỷ của KHSX đang chờ Sếp.
      set(
        'bossOrderCancel',
        this.prisma.productionOrderCancelRequest.count({ where: { status: 'PENDING' } }),
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
      // Chỉ thủ kho gắn kho Hàn của xưởng không có kho Sơn mới có khoá này (kho khác: không đặt khoá, FE không hiện số).
      tasks.push(
        this.countWarehouseToPaintPending(user.warehouseScope).then((n) => {
          if (n != null) counts.warehouseToPaintPending = n;
        }),
      );
    }
    if (has(BUSINESS_ROLES.PHOI_STAFF)) {
      // Sắt cây nhận bằng QR "Khu nhận sắt" (đợt 1, 16/11/2026) nên không đếm; màn "Xác nhận nhận sắt" của
      // tài khoản thống kê còn Sắt La (MaterialYieldIssue) + thanh nhôm (MaterialYieldRecipeIssue) chờ nhận.
      set(
        'phoiSteelReceiving',
        Promise.all([
          this.prisma.materialYieldIssue.count({ where: { status: 'ISSUED' } }),
          this.prisma.materialYieldRecipeIssue.count({ where: { status: 'ISSUED' } }),
        ]).then(([yieldIssues, recipeIssues]) => yieldIssues + recipeIssues),
      );
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
    // Chuyền kiểm bằng quét QR (24/11/2026): số đợt công nhân chuyền kiểm báo chờ KCS chuyền kiểm chấm. Tắt công tắc: không có khoá.
    if (user.mfgRole === MfgRole.KCS_CHUYEN_KIEM && isCkDgQrEnabled()) {
      set(
        'kcsChuyenKiem',
        this.prisma.transferCheckBatch.count({
          where: { status: 'AWAITING_KCS', productionInvoiceItem: { cancelledAt: null } },
        }),
      );
    }
    if (has(BUSINESS_ROLES.SALES_STAFF)) {
      set('salesReadyToShip', this.salesOrdersService.countReadyToShip());
    }

    // Phần A – Đợt 4 (YC6): "Vật tư cần về" - người mua (vật tư mình phụ trách) và thủ kho (kho mình); người vừa mua vừa thủ kho
    // tính theo người mua. KHSX / QLSX / Sếp không có badge này (chỉ xem).
    if (has(BUSINESS_ROLES.PURCHASER) || has(BUSINESS_ROLES.WAREHOUSE_STAFF)) {
      set(
        'materialsDueNow',
        this.materialsDueService.countDueNow({
          id: user.id ?? '',
          roles: user.roles,
          warehouseScope: user.warehouseScope,
        }),
      );
    }

    await Promise.all(tasks);
    return new WorkQueueResponseDto({ counts });
  }

  /**
   * PI item WAITING_QLSX + đề xuất cắt sắt cần QLSX xử lý tay (xem lệch #1 ở doc comment lớp).
   * QLSX gắn xưởng (2026-11-12) chỉ đếm lệnh trong phạm vi THAO TÁC (xưởng mình + SKU chưa có xưởng): lệnh xưởng khác mình
   * không bấm được nên không được hiện số đỏ. Đề xuất cắt sắt tính TRƯỚC PI chưa gắn lệnh/xưởng nào nên vẫn đếm chung.
   */
  private async countQlsxProductionQueue(userId: string | undefined): Promise<number> {
    const scope = await this.workshopScope.getScope(userId);
    const [waitingQlsx, needsAction] = await Promise.all([
      this.prisma.productionInvoiceItem.count({
        where: {
          prodApprovalStatus: 'WAITING_QLSX',
          ...(scope.workshopId != null
            ? { OR: [{ workshopId: null }, { workshopId: scope.workshopId }] }
            : {}),
        },
      }),
      this.cuttingProposalsService.countNeedsAction(),
    ]);
    return waitingQlsx + needsAction;
  }

  /**
   * N1 (18/11/2026): số SKU đã đóng gói đủ (Σ boxesPacked >= số lượng) mà QLSX chưa bấm "Kết thúc" - tính từ dữ liệu, không đọc
   * bảng tin, nên dữ liệu cũ trước deploy cũng có mặt. Phạm vi xưởng như countQlsxProductionQueue(): QLSX gắn xưởng chỉ đếm SKU
   * xưởng mình + SKU chưa có xưởng; QLSX chung đếm hết. Bỏ SKU quantity 0, lệnh / SKU đã huỷ.
   */
  private async countQlsxAwaitingFinish(userId: string | undefined): Promise<number> {
    const scope = await this.workshopScope.getScope(userId);
    const candidates = await this.prisma.productionInvoiceItem.findMany({
      where: {
        quantity: { gt: 0 },
        packagingRecords: { some: {} },
        productionOrder: {
          is: {
            floorStage: { not: 'FINISHED' },
            status: { not: 'CANCELLED' },
          },
        },
        productionInvoice: { is: { status: { not: 'CANCELLED' } } },
        ...(scope.workshopId != null
          ? { OR: [{ workshopId: null }, { workshopId: scope.workshopId }] }
          : {}),
      },
      select: { id: true, quantity: true },
    });
    if (candidates.length === 0) return 0;
    const packed = await this.prisma.packagingRecord.groupBy({
      by: ['productionInvoiceItemId'],
      where: { productionInvoiceItemId: { in: candidates.map((c) => c.id) } },
      _sum: { boxesPacked: true },
    });
    const packedById = new Map(
      packed.map((p) => [p.productionInvoiceItemId.toString(), p._sum.boxesPacked ?? 0]),
    );
    return candidates.filter((c) => (packedById.get(c.id.toString()) ?? 0) >= c.quantity).length;
  }

  /** null = kho của người gọi không phải kho Hàn của xưởng không có kho Sơn (không có khoá). */
  private async countWarehouseToPaintPending(
    warehouseScope: string | null,
  ): Promise<number | null> {
    if (!warehouseScope) return null;
    const n = await this.paintReminder.countPendingOrders(warehouseScope);
    if (n > 0) return n;
    return (await this.paintReminder.isPaintLegWeldWarehouse(warehouseScope)) ? 0 : null;
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

  /**
   * Số đỏ menu KCS (P1, 18/11/2026): đợt công nhân đã báo mà KCS chưa chấm - đang mở (chưa bấm Chấm) + đã chốt (AWAITING_QC)
   * của 5 loại (đợt cắt, nhóm công đoạn phụ, lô mảnh Phôi / Hàn / Sơn, pat, chân nhôm), bỏ dòng có blockedReason (lệnh dừng /
   * chưa gắn SKU - dòng xám). Cùng nguồn kcs-pending với summary của QLSX và tin chờ lâu. KCS thấy hết xưởng, không lọc xưởng.
   * tab kcs-phoi = Cắt / công đoạn phụ / pat / chân nhôm / lô mảnh Phôi; kcs-han / kcs-son = lô mảnh của tổ.
   */
  private async countKcs(): Promise<{ phoi: number; han: number; son: number }> {
    return countKcsByStage(await listKcsPendingItems(this.prisma));
  }
}
