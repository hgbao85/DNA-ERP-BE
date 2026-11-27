import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AuditAction, MfgStage, Prisma, PrismaClient } from '../../generated/prisma/client';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { loadLenhDisplayCodes } from '../../common/utils/lenh-code.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { segmentCodeLabel } from '../../common/utils/segment-code.util';
import {
  WorkshopScope,
  WorkshopScopeService,
} from '../../common/workshop-scope/workshop-scope.service';
import { writeAuditLog } from '../../prisma/extensions/audit-log.extension';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ListSegmentOveragesQueryDto, SegmentOverageResponseDto } from './dto/segment-overage.dto';

const OVERAGE_INCLUDE = {
  productionBatch: { select: { piece: { select: { code: true, name: true } } } },
  warehouse: { select: { name: true } },
  segmentSpec: { select: { cutLengthMm: true, material: { select: { code: true } } } },
} satisfies Prisma.SegmentOverageInclude;
type OverageRow = Prisma.SegmentOverageGetPayload<{ include: typeof OVERAGE_INCLUDE }>;

const userName = (u: { firstName: string; lastName: string; username: string } | undefined) =>
  u ? `${u.lastName} ${u.firstName}`.trim() || u.username : null;

/**
 * Sổ báo vượt tồn đoạn (13/11/2026, nghiệp vụ câu 2, 6, 7, 9). Hàn / Sơn báo vượt không bị chặn; phía trừ
 * (ProductionBatchesService.consumeSegmentsByCode) ghi 1 dòng ở đây khi thiếu đoạn hoặc làm vượt số lượng lệnh / làm lại.
 * QLSX xem và đóng từng dòng (bắt buộc lý do, có nhật ký); KHSX xem. QLSX gắn xưởng chỉ thấy / đóng dòng mà kho Phôi trên dòng thuộc xưởng mình (TĐ9, xem canHandle).
 */
@Injectable()
export class SegmentOveragesService {
  private readonly logger = new Logger(SegmentOveragesService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly cls: ClsService<AppClsStore>,
    private readonly workshopScope: WorkshopScopeService,
    private readonly notifications: NotificationsService,
  ) {}

  async findAll(
    query: ListSegmentOveragesQueryDto,
    userId: string,
  ): Promise<SegmentOverageResponseDto[]> {
    const status = query.status ?? 'open';
    const scope = await this.workshopScope.getScope(userId);
    const where: Prisma.SegmentOverageWhereInput = {};
    if (status === 'open') where.resolvedAt = null;
    else if (status === 'resolved') where.resolvedAt = { not: null };
    if (query.productionInvoiceId)
      where.productionInvoiceId = parseBigIntId(query.productionInvoiceId);
    const handled = this.handledWhere(scope);
    if (handled) where.AND = [handled];
    const rows = await this.prisma.segmentOverage.findMany({
      where,
      include: OVERAGE_INCLUDE,
      orderBy: { id: 'desc' },
      take: 300,
    });
    return this.toDtos(rows);
  }

  async resolve(id: string, reason: string, userId: string): Promise<SegmentOverageResponseDto> {
    const bigId = parseBigIntId(id);
    const row = await this.prisma.segmentOverage.findUnique({
      where: { id: bigId },
      select: {
        productionBatchId: true,
        stage: true,
        warehouse: { select: { workshopId: true } },
      },
    });
    if (!row) throw new NotFoundException(`Không tìm thấy dòng báo vượt ${id}`);
    const scope = await this.workshopScope.getScope(userId);
    if (!this.canHandle(scope, row.stage, row.warehouse.workshopId)) {
      // Ném đúng câu lỗi "thuộc xưởng khác" chung của hệ thống.
      this.workshopScope.assertCanManage(scope, [row.warehouse.workshopId], 'dòng báo vượt này');
    }
    // Đóng có điều kiện: 2 người bấm cùng lúc thì người sau nhận 409, lý do của người trước không bị ghi đè.
    const { count } = await this.prisma.segmentOverage.updateMany({
      where: { id: bigId, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedById: userId, resolveReason: reason },
    });
    if (count === 0) throw new ConflictException('Dòng này đã được đóng - tải lại trang');
    await writeAuditLog(this.prisma as unknown as Pick<PrismaClient, 'auditLog'>, this.cls, {
      action: AuditAction.UPDATE,
      tableName: 'SegmentOverage',
      recordId: id,
      oldValue: { resolvedAt: null },
      newValue: { event: 'segment-overage-resolved', reason },
    });
    await this.resolveNotificationIfDone(row.productionBatchId);
    const fresh = await this.prisma.segmentOverage.findUniqueOrThrow({
      where: { id: bigId },
      include: OVERAGE_INCLUDE,
    });
    return (await this.toDtos([fresh]))[0];
  }

  /**
   * TĐ9 (rà soát 14/11): xem và đóng dùng CÙNG 1 quy tắc - thấy được thì đóng được. Căn cứ là xưởng của KHO PHÔI ghi trên dòng
   * (nơi đoạn thật sự bị lấy), không theo "lệnh có SKU thuộc xưởng nào" như trước (xem theo "có ít nhất 1 dòng của xưởng mình",
   * đóng đòi "mọi dòng" -> lệnh trải 2 xưởng thì ai cũng thấy mà không ai đóng được). Dòng của tổ Sơn: xưởng đang sơn nhờ cho
   * xưởng có kho đó cũng xử lý được (cùng quy tắc hàng đợi tổ Sơn). Kho chưa gắn xưởng: ai cũng được. QLSX không gắn xưởng: tất cả.
   */
  private canHandle(scope: WorkshopScope, stage: MfgStage, workshopId: bigint | null): boolean {
    if (scope.workshopId == null || workshopId == null) return true;
    if (workshopId === scope.workshopId) return true;
    return stage === MfgStage.SON && (scope.visibleWorkshopIds ?? []).includes(workshopId);
  }

  private handledWhere(scope: WorkshopScope): Prisma.SegmentOverageWhereInput | null {
    if (scope.workshopId == null) return null;
    const paintsFor = (scope.visibleWorkshopIds ?? []).filter((w) => w !== scope.workshopId);
    return {
      OR: [
        { warehouse: { workshopId: null } },
        { warehouse: { workshopId: scope.workshopId } },
        ...(paintsFor.length > 0
          ? [{ stage: MfgStage.SON, warehouse: { workshopId: { in: paintsFor } } }]
          : []),
      ],
    };
  }

  /** Đợt không còn dòng sổ nào mở -> đóng thông báo SEGMENT_OVERAGE_REPORTED của đợt. Best-effort: lỗi chỉ log. */
  private async resolveNotificationIfDone(productionBatchId: bigint): Promise<void> {
    try {
      const open = await this.prisma.segmentOverage.count({
        where: { productionBatchId, resolvedAt: null },
      });
      if (open > 0) return;
      await this.notifications.resolve({
        entityType: 'PRODUCTION_BATCH',
        entityId: productionBatchId.toString(),
        types: ['SEGMENT_OVERAGE_REPORTED'],
      });
    } catch (error) {
      this.logger.error(
        `Không đóng được thông báo báo vượt đoạn (đợt ${productionBatchId}): ${(error as Error).message}`,
      );
    }
  }

  private async toDtos(rows: OverageRow[]): Promise<SegmentOverageResponseDto[]> {
    if (rows.length === 0) return [];
    const userIds = [
      ...new Set(
        rows.flatMap((r) => [r.reportedById, r.resolvedById]).filter((x): x is string => !!x),
      ),
    ];
    const [codes, users] = await Promise.all([
      loadLenhDisplayCodes(
        this.prisma,
        rows.map((r) => r.productionInvoiceId),
      ),
      userIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, firstName: true, lastName: true, username: true },
          })
        : Promise.resolve([]),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    return rows.map(
      (r) =>
        new SegmentOverageResponseDto({
          id: r.id.toString(),
          productionInvoiceId: r.productionInvoiceId.toString(),
          lenhCode: codes.get(r.productionInvoiceId.toString()) ?? `#${r.productionInvoiceId}`,
          productionOrderId: r.productionOrderId.toString(),
          productionBatchId: r.productionBatchId.toString(),
          pieceCode: r.productionBatch.piece.code,
          pieceName: r.productionBatch.piece.name,
          stage: r.stage,
          warehouseName: r.warehouse.name,
          segmentLabel: segmentCodeLabel(
            r.segmentSpec.material.code,
            Number(r.segmentSpec.cutLengthMm),
            r.segmentSteps,
          ),
          neededQty: Number(r.neededQty),
          takenQty: Number(r.takenQty),
          shortageQty: Number(r.shortageQty),
          overPieces: r.overPieces,
          extraQty: Number(r.extraQty),
          extraKind: r.extraKind,
          reportedByName: r.reportedById ? userName(userById.get(r.reportedById)) : null,
          createdAt: r.createdAt,
          resolvedAt: r.resolvedAt,
          resolvedByName: r.resolvedById ? userName(userById.get(r.resolvedById)) : null,
          resolveReason: r.resolveReason,
        }),
    );
  }
}
