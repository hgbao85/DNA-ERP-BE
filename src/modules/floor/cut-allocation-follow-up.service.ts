import { Inject, Injectable, Logger } from '@nestjs/common';
import { MfgStage } from '../../generated/prisma/client';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import type { CutPullSteelToIssueParams } from '../notifications/notification-types';
import { NotificationsService } from '../notifications/notifications.service';
import { CutAllocationService } from './cut-allocation.service';
import type { AllocatedOrder, SteelGap } from './cut-allocation-types';
import { FloorAdminService } from './floor-admin.service';

export type CutAllocationSource = 'AUTO_PULL' | 'MANUAL';

/**
 * Params của tin CUT_PULL_STEEL_TO_ISSUE dựng từ TOÀN BỘ chỗ thiếu sắt hiện hành của lệnh (không chỉ
 * loại sắt vừa chia), để tin gộp (cùng dedupeKey, ghi đè nội dung) không làm mất loại sắt khác. Dùng
 * chung cho follow-up sau khi chia và đối soát nền để câu chữ luôn giống nhau.
 */
export function buildPullSteelParams(args: {
  piCode: string;
  workshopId: string;
  gaps: SteelGap[];
  source?: CutPullSteelToIssueParams['source'];
}): CutPullSteelToIssueParams {
  const gaps = [...args.gaps].sort((a, b) => {
    const x = BigInt(a.materialId);
    const y = BigInt(b.materialId);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return {
    piCode: args.piCode,
    workshopId: args.workshopId,
    lines: gaps.map((g) => `${g.materialLabel}: còn ${g.missingBars} cây`).join('; '),
    warehouseCodes: [...new Set(gaps.flatMap((g) => g.warehouseCodes))].sort(),
    ...(args.source ? { source: args.source } : {}),
  };
}

/**
 * Việc theo sau khi lệnh được chia cho máy cắt (QLSX chia tay hoặc máy rảnh tự kéo): đưa lệnh vào
 * hàng đợi Phôi và báo thủ kho xuất sắt xuống Phôi. Chạy SAU khi transaction chia đã commit, mỗi lệnh
 * 1 transaction riêng (khoá hàng đợi Phôi) nên không lồng khoá. Không bao giờ ném lỗi: lỗi chỉ ghi
 * log, việc chia đã xong. Xếp hàng đợi Phôi không phụ thuộc FLOOR_ALERTS (đây là sự kiện do người
 * bấm); còn tin xuất sắt thì FLOOR_ALERTS=off không phát, vì chỉ lượt nền mới đóng tin này (tắt nhắc
 * nền mà phát thì tin mở mãi, giống PaintTransferReminderService.refreshForOrder).
 */
@Injectable()
export class CutAllocationFollowUpService {
  private readonly logger = new Logger(CutAllocationFollowUpService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly admin: FloorAdminService,
    private readonly notifications: NotificationsService,
    private readonly cutAllocation: CutAllocationService,
  ) {}

  async afterAllocated(args: {
    workshopId: bigint | string;
    orders: AllocatedOrder[];
    source: CutAllocationSource;
  }): Promise<void> {
    if (args.orders.length === 0) return;
    try {
      await this.admin.ensurePhoiQueued(args.orders.map((o) => BigInt(o.productionInvoiceId)));
    } catch (e) {
      this.logger.error(`Queue allocated orders to Phôi failed: ${(e as Error).message}`);
    }
    if (process.env.FLOOR_ALERTS === 'off') return;
    const recheck = await this.loadRecheckPiIds(args.orders);
    // Các cặp vừa chia chỉ quyết định CÓ phát hay không; nội dung tin lấy từ toàn bộ chỗ thiếu sắt
    // hiện hành của lệnh (tải 1 lần cho cả xưởng, chỉ khi có lệnh cần phát).
    let current: Map<string, SteelGap[]> | null | undefined;
    for (const o of args.orders) {
      const warehouseCodes = [...new Set(o.steelGaps.flatMap((g) => g.warehouseCodes))];
      if (o.steelGaps.length === 0 || warehouseCodes.length === 0) continue;
      if (recheck.has(o.productionInvoiceId)) {
        // Lệnh đang chờ KHSX kiểm lại phương án cắt: kho chưa chuyển / xuất sắt, không báo thủ kho.
        this.logger.log(
          `Bỏ tin xuất sắt của lệnh ${o.productionInvoiceId}: đang chờ KHSX kiểm lại phương án cắt`,
        );
        continue;
      }
      if (current === undefined) current = await this.loadCurrentGaps(args.workshopId);
      // Tra lỗi thì dùng tạm các cặp vừa chia; tra được mà lệnh đã hết thiếu thì khỏi báo.
      const gaps = current ? (current.get(o.productionInvoiceId) ?? []) : o.steelGaps;
      const params = buildPullSteelParams({
        piCode: o.piCode,
        workshopId: String(args.workshopId),
        gaps,
        source: args.source,
      });
      if (gaps.length === 0 || params.warehouseCodes.length === 0) continue;
      // Gọi emit() thẳng (không emitOnce): tin cũ của lệnh còn mở cùng dedupeKey sẽ được gộp và cập
      // nhật theo danh sách đầy đủ vừa dựng.
      const dedupeKey = `cut-pull-steel:${o.productionInvoiceId}`;
      try {
        await this.notifications.emit('CUT_PULL_STEEL_TO_ISSUE', {
          entityId: o.productionInvoiceId,
          dedupeKey,
          params: { ...params },
        });
      } catch (e) {
        this.logger.error(
          `Failed to emit CUT_PULL_STEEL_TO_ISSUE (${dedupeKey}): ${(e as Error).message}`,
        );
      }
    }
  }

  /** Chỗ thiếu sắt hiện hành theo lệnh của xưởng; null khi tra lỗi (chỉ ghi log). */
  private async loadCurrentGaps(
    workshopId: bigint | string,
  ): Promise<Map<string, SteelGap[]> | null> {
    try {
      return await this.cutAllocation.steelGapsByPi(BigInt(workshopId));
    } catch (e) {
      this.logger.error(`Load current steel gaps failed: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Đối soát: lệnh có dòng chia mà chưa có dòng hàng đợi Phôi nào (mọi trạng thái) thì xếp vào cuối
   * hàng đợi Phôi. Lệnh đã có dòng thì không đụng tới. Lỗi chỉ ghi log.
   */
  async queueMissingPhoi(piIds: bigint[]): Promise<void> {
    if (piIds.length === 0) return;
    try {
      const have = await this.prisma.floorQueueEntry.findMany({
        where: { stage: MfgStage.PHOI, productionInvoiceId: { in: piIds } },
        select: { productionInvoiceId: true },
      });
      const haveIds = new Set(have.map((h) => h.productionInvoiceId.toString()));
      const missing = piIds.filter((id) => !haveIds.has(id.toString()));
      if (missing.length === 0) return;
      await this.admin.ensurePhoiQueued(missing);
    } catch (e) {
      this.logger.error(`Reconcile Phôi queue failed: ${(e as Error).message}`);
    }
  }

  /** Lệnh đang chờ KHSX kiểm lại phương án cắt; lỗi tra cứu thì coi như không có (vẫn báo). */
  private async loadRecheckPiIds(orders: AllocatedOrder[]): Promise<Set<string>> {
    try {
      const rows = await this.prisma.productionInvoice.findMany({
        where: {
          id: { in: orders.map((o) => BigInt(o.productionInvoiceId)) },
          cuttingRecheckRequired: true,
        },
        select: { id: true },
      });
      return new Set(rows.map((r) => r.id.toString()));
    } catch (e) {
      this.logger.error(`Load cuttingRecheckRequired failed: ${(e as Error).message}`);
      return new Set();
    }
  }
}
