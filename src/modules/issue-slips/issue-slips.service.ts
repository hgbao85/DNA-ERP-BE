import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  IssueSlipLineKind,
  IssueSlipStatus,
  Prisma,
  StockLedgerRefType,
} from '../../generated/prisma/client';
import { MATERIAL_GROUP_SYSTEM_KEYS } from '../../common/constants/material-group-system-keys.constant';
import { loadLenhDisplayCodes } from '../../common/utils/lenh-code.util';
import { loadBomOptionExclusions } from '../bom-revisions/bom-option.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { isFamilyScope, warehouseFamilyOf } from '../../common/utils/warehouse-family.util';
import { WarehouseLike, WorkshopWarehouseResolver } from '../stock/workshop-warehouse.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import {
  MaterialIssueRow,
  MaterialIssuesService,
  PreparedMaterialIssue,
} from '../material-issues/material-issues.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FloorAlertsService } from '../floor/floor-alerts.service';
import {
  PackagingIssueRow,
  PackagingIssuesService,
  PreparedPackagingIssue,
} from '../packaging-issues/packaging-issues.service';
import {
  MaterialYieldIssueRow,
  MaterialYieldIssuesService,
  PreparedMaterialYieldIssue,
} from '../material-yield-issues/material-yield-issues.service';
import {
  MaterialYieldRecipeIssueRow,
  MaterialYieldRecipeIssuesService,
  PreparedMaterialYieldRecipeIssue,
} from '../material-yield-recipes/material-yield-recipe-issues.service';
import {
  PreparedWeavingMaterial,
  PreparedWeavingPiece,
  WeavingIssueRow,
  WeavingIssuesService,
} from '../weaving-issues/weaving-issues.service';
import {
  PreparedSteelIssue,
  SteelIssueRow,
  SteelIssuesService,
} from '../steel-issues/steel-issues.service';
import { CreateIssueSlipDto, IssueSlipLineDto, ListIssueSlipsQueryDto } from './dto/issue-slip.dto';
import { allocateSlipCode } from './slip-code.util';

const PRODUCTION_WAREHOUSE_CODE = 'PRODUCTION';
const STEEL_FAMILY = 'phoi-son-han';
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const cleanUrls = (urls: string[]) => [...new Set(urls.map((u) => u.trim()).filter(Boolean))];

const SLIP_INCLUDE = {
  warehouse: { select: { code: true, name: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  issuedBy: { select: { firstName: true, lastName: true } },
  weavingPoint: { select: { code: true, fullName: true } },
  pairedSlip: { select: { id: true, code: true, status: true } },
  lines: {
    orderBy: { id: 'asc' },
    include: {
      material: { select: { code: true, name: true, unit: true } },
      piece: { select: { code: true, name: true } },
    },
  },
} satisfies Prisma.IssueSlipInclude;

const WEAVING_KINDS: IssueSlipLineKind[] = [
  IssueSlipLineKind.WEAVING_PIECE,
  IssueSlipLineKind.WEAVING_MATERIAL,
];

type SlipRow = Prisma.IssueSlipGetPayload<{ include: typeof SLIP_INCLUDE }>;

/** 1 dòng đã kiểm xong trước transaction - đủ để ghi trong transaction xác nhận. */
type PreparedLine =
  | { lineId: bigint; kind: 'STEEL'; prepared: PreparedSteelIssue }
  | { lineId: bigint; kind: 'CONSUMABLE'; prepared: PreparedMaterialIssue }
  | { lineId: bigint; kind: 'SHARED'; materialId: bigint; warehouseId: bigint; qty: number }
  | { lineId: bigint; kind: 'WEAVING_PIECE'; prepared: PreparedWeavingPiece }
  | { lineId: bigint; kind: 'WEAVING_MATERIAL'; prepared: PreparedWeavingMaterial }
  | { lineId: bigint; kind: 'PACKAGING'; prepared: PreparedPackagingIssue }
  | { lineId: bigint; kind: 'MATERIAL_YIELD'; prepared: PreparedMaterialYieldIssue }
  | { lineId: bigint; kind: 'MATERIAL_YIELD_RECIPE'; prepared: PreparedMaterialYieldRecipeIssue };

/** Dòng phiếu sau khi kiểm (lúc tạo phiếu) - kèm kho thật của dòng để bắt "mỗi phiếu chỉ 1 kho". */
interface CheckedLine {
  dto: IssueSlipLineDto;
  materialId: bigint | null;
  pieceId: bigint | null;
  warehouseId: bigint;
  productionInvoiceId: bigint | null;
  productionOrderId: bigint | null;
  recipeId?: bigint | null;
  /** Dòng mảnh xuất đan - kiểm trần trong transaction tạo phiếu. */
  weavingPiece?: PreparedWeavingPiece;
  /** Dòng đóng gói / vật tư kèm đan - kiểm tồn khả dụng ngay lúc lập phiếu (RPK.2). */
  packaging?: PreparedPackagingIssue;
  weavingMaterial?: PreparedWeavingMaterial;
}

/** Phiếu xuất đan: điểm đan + (phiếu vật tư) phiếu mảnh cùng chuyến. */
interface WeavingHeader {
  weavingPointId: bigint;
  weavingPointName: string;
  pairedSlipId: bigint | null;
}

const fullName = (u: { firstName: string; lastName: string } | null) =>
  u ? `${u.lastName} ${u.firstName}`.trim() : null;

/**
 * Phiếu xuất kho XK-yymmdd-NNN. Gồm xuất sắt cho Phôi và xuất vật tư tiêu hao
 * Hàn/Sơn, thêm dòng "Dùng chung" (không theo lệnh, chỉ lấy từ tồn chưa giữ).
 *
 * 2 bước: tạo phiếu (kiểm từng dòng, cấp số, CHƯA trừ tồn) -> in -> người nhận ký -> thủ kho tải
 * ảnh phiếu đã ký và "Xác nhận xuất" - lúc đó mới trừ tồn MỌI dòng trong 1 transaction (dùng lõi
 * createInTx của SteelIssuesService/MaterialIssuesService, giữ nguyên mọi chốt cũ: giữ chỗ, tồn khả
 * dụng, định mức, ưu tiên SKU sớm YC11). Một dòng hỏng thì cả phiếu không xuất. Khoá cứng: route
 * xuất từng dòng cũ đã gỡ, không còn đường xuất nào thiếu ảnh (V4-1).
 */
@Injectable()
export class IssueSlipsService {
  private readonly logger = new Logger(IssueSlipsService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly steelIssues: SteelIssuesService,
    private readonly materialIssues: MaterialIssuesService,
    private readonly stockLedger: StockLedgerService,
    private readonly reservations: StockReservationsService,
    private readonly realtime: RealtimeService,
    private readonly weaving: WeavingIssuesService,
    private readonly notifications: NotificationsService,
    private readonly packaging: PackagingIssuesService,
    private readonly materialYield: MaterialYieldIssuesService,
    private readonly materialYieldRecipe: MaterialYieldRecipeIssuesService,
    private readonly floorAlerts: FloorAlertsService,
  ) {}

  async create(dto: CreateIssueSlipDto, userId: string, scope: string | null) {
    const header = await this.checkWeavingHeader(dto);
    const checked: CheckedLine[] = [];
    for (const line of dto.lines) checked.push(await this.checkLine(line, scope, header));
    if (header) this.assertNoDuplicateWeavingLines(checked);
    const warehouseIds = new Set(checked.map((c) => c.warehouseId.toString()));
    if (warehouseIds.size > 1) {
      throw new BadRequestException(
        'Mỗi phiếu xuất chỉ cho một kho - các vật tư đã chọn nằm ở nhiều kho khác nhau, tách thành nhiều phiếu',
      );
    }

    const slipId = await this.prisma.$transaction(
      async (tx) => {
        // Phiếu mảnh xuất đan: chặn vượt định mức / số mảnh còn ở kho ngay lúc cấp số (tính cả
        // phiếu chờ ký khác).
        for (const c of checked) {
          if (c.weavingPiece) await this.weaving.assertPieceCapInTx(tx, c.weavingPiece, null);
          // RPK.2: đóng gói + vật tư kèm đan kiểm tồn cả lúc lập (trước đây chỉ lúc xác nhận - lập
          // được phiếu khi kho = 0).
          if (c.packaging) await this.packaging.assertStockForSlip(tx, c.packaging);
          if (c.weavingMaterial)
            await this.weaving.assertMaterialStockForSlip(tx, c.weavingMaterial);
        }
        const code = await allocateSlipCode(tx, 'XK');
        const slip = await tx.issueSlip.create({
          data: {
            code,
            warehouseId: checked[0].warehouseId,
            recipientName: dto.recipientName?.trim() || header?.weavingPointName || null,
            note: dto.note?.trim() || null,
            createdById: userId,
            weavingPointId: header?.weavingPointId ?? null,
            pairedSlipId: header?.pairedSlipId ?? null,
            lines: {
              create: checked.map((c) => ({
                kind: c.dto.kind,
                materialId: c.materialId,
                pieceId: c.pieceId,
                recipeId: c.recipeId ?? null,
                productionInvoiceId: c.productionInvoiceId,
                productionOrderId: c.productionOrderId,
                stage: c.dto.kind === IssueSlipLineKind.CONSUMABLE ? c.dto.stage : null,
                barLengthMm: c.dto.kind === IssueSlipLineKind.STEEL ? c.dto.barLengthMm : null,
                qty: c.dto.qty,
                note: c.dto.note?.trim() || null,
              })),
            },
          },
        });
        return slip.id;
      },
      { timeout: 20_000 },
    );
    this.publish(slipId, 'CREATED', userId);
    if (header) {
      await this.syncWeavingMaterialNotice(header.pairedSlipId ?? slipId);
      this.publishWeaving(slipId, userId);
    }
    return this.findOne(slipId.toString());
  }

  /**
   * Phiếu xuất đan: phiếu mảnh cần điểm đan; phiếu vật tư kèm cần phiếu mảnh cùng chuyến (lấy điểm
   * đan của phiếu đó). Phiếu không có dòng xuất đan trả null.
   */
  private async checkWeavingHeader(dto: CreateIssueSlipDto): Promise<WeavingHeader | null> {
    const kinds = new Set(dto.lines.map((l) => l.kind));
    const weavingKinds = WEAVING_KINDS.filter((k) => kinds.has(k));
    if (weavingKinds.length === 0) return null;
    if (kinds.size > 1) {
      throw new BadRequestException(
        'Phiếu xuất đan chỉ gồm 1 loại dòng: mảnh (kho giữ mảnh) hoặc vật tư kèm (kho Phụ kiện) - không trộn',
      );
    }
    if (kinds.has(IssueSlipLineKind.WEAVING_PIECE)) {
      if (!dto.weavingPointId) throw new BadRequestException('Phiếu xuất đan cần chọn điểm đan');
      const point = await this.prisma.weavingPoint.findUnique({
        where: { id: parseBigIntId(dto.weavingPointId) },
        select: { id: true, code: true, fullName: true },
      });
      if (!point) throw new NotFoundException(`Không tìm thấy điểm đan ${dto.weavingPointId}`);
      return {
        weavingPointId: point.id,
        weavingPointName: point.fullName?.trim() || point.code,
        pairedSlipId: null,
      };
    }
    if (!dto.pairedSlipId) {
      throw new BadRequestException('Phiếu vật tư kèm đan cần chọn phiếu mảnh đi cùng chuyến');
    }
    const paired = await this.prisma.issueSlip.findUnique({
      where: { id: parseBigIntId(dto.pairedSlipId) },
      select: {
        id: true,
        code: true,
        status: true,
        weavingPointId: true,
        weavingPoint: { select: { code: true, fullName: true } },
        lines: { select: { kind: true, productionOrderId: true, pieceId: true } },
      },
    });
    if (
      !paired?.weavingPointId ||
      !paired.weavingPoint ||
      !paired.lines.some((l) => l.kind === IssueSlipLineKind.WEAVING_PIECE)
    ) {
      throw new BadRequestException(`Phiếu ${dto.pairedSlipId} không phải phiếu mảnh xuất đan`);
    }
    if (paired.status === IssueSlipStatus.CANCELLED) {
      throw new ConflictException(`Phiếu mảnh ${paired.code} đã huỷ`);
    }
    const pieceKeys = new Set(
      paired.lines
        .filter((l) => l.kind === IssueSlipLineKind.WEAVING_PIECE)
        .map((l) => `${l.productionOrderId}:${l.pieceId}`),
    );
    for (const l of dto.lines) {
      const key = `${l.productionOrderId ? parseBigIntId(l.productionOrderId) : ''}:${l.pieceId ? parseBigIntId(l.pieceId) : ''}`;
      if (!pieceKeys.has(key)) {
        throw new BadRequestException(
          `Vật tư kèm phải theo đúng mảnh có trên phiếu ${paired.code}`,
        );
      }
    }
    return {
      weavingPointId: paired.weavingPointId,
      weavingPointName: paired.weavingPoint.fullName?.trim() || paired.weavingPoint.code,
      pairedSlipId: paired.id,
    };
  }

  private assertNoDuplicateWeavingLines(checked: CheckedLine[]): void {
    const seen = new Set<string>();
    for (const c of checked) {
      const key = `${c.productionOrderId}:${c.pieceId}:${c.materialId ?? ''}`;
      if (seen.has(key)) {
        throw new BadRequestException(
          'Phiếu có 2 dòng trùng cùng mảnh / vật tư của cùng SKU - gộp lại',
        );
      }
      seen.add(key);
    }
  }

  /**
   * Vật tư cần cấp kèm đan (phần mềm báo kho Phụ kiện số vật tư cần cấp kèm): theo từng phiếu mảnh
   * còn hiệu lực (chờ ký hoặc đã xuất, 90 ngày gần nhất) = định mức vật tư / mảnh × số mảnh trên
   * phiếu − đã nằm trên phiếu vật tư cùng chuyến (chưa huỷ). Thủ kho chỉ thấy vật tư thuộc kho
   * mình. Chỉ trả phiếu còn thiếu.
   */
  async getWeavingMaterialDemand(scope: string | null) {
    const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
    const slips = await this.prisma.issueSlip.findMany({
      where: {
        status: { in: [IssueSlipStatus.DRAFT, IssueSlipStatus.ISSUED] },
        createdAt: { gte: since },
        lines: { some: { kind: IssueSlipLineKind.WEAVING_PIECE } },
      },
      include: {
        ...SLIP_INCLUDE,
        pairedBy: {
          where: { status: { not: IssueSlipStatus.CANCELLED } },
          select: {
            code: true,
            status: true,
            lines: {
              select: { productionOrderId: true, pieceId: true, materialId: true, qty: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const demand = await this.computeWeavingDemand(slips);
    const codes = await this.lenhCodesOf(...slips);
    const result = [];
    for (const slip of slips) {
      const lines = (demand.get(slip.id.toString()) ?? []).filter(
        (d) => d.remainingQty > 0 && (!scope || d.warehouseCode === scope),
      );
      if (lines.length === 0) continue;
      result.push({
        slipId: slip.id.toString(),
        slipCode: slip.code,
        slipStatus: slip.status,
        warehouseName: slip.warehouse.name,
        weavingPointId: slip.weavingPointId?.toString() ?? null,
        weavingPointName: slip.weavingPoint
          ? slip.weavingPoint.fullName?.trim() || slip.weavingPoint.code
          : null,
        createdAt: slip.createdAt,
        pairedSlipCodes: slip.pairedBy.map((p) => p.code),
        lines: lines.map((d) => {
          const order = codes.byOrder.get(d.productionOrderId);
          return { ...d, lenhCode: order?.lenhCode ?? null, sku: order?.sku ?? null };
        }),
      });
    }
    return result;
  }

  /** Nhu cầu vật tư kèm theo từng phiếu mảnh (key = id phiếu mảnh). */
  private async computeWeavingDemand(
    slips: (SlipRow & {
      pairedBy: {
        lines: {
          productionOrderId: bigint | null;
          pieceId: bigint | null;
          materialId: bigint | null;
          qty: Prisma.Decimal;
        }[];
      }[];
    })[],
  ) {
    const pieceLines = slips.flatMap((s) =>
      s.lines.filter((l) => l.kind === IssueSlipLineKind.WEAVING_PIECE && l.productionOrderId),
    );
    const orderIds = [...new Set(pieceLines.map((l) => l.productionOrderId!))];
    const orders =
      orderIds.length > 0
        ? await this.prisma.productionOrder.findMany({
            where: { id: { in: orderIds } },
            select: {
              id: true,
              bomRevisionId: true,
              wireMaterialId: true,
              cushionMaterialId: true,
            },
          })
        : [];
    const orderById = new Map(orders.map((o) => [o.id.toString(), o]));
    const [linesByPiece, exclusions] = await Promise.all([
      this.weaving.getWovenMaterialLinesByPiece([...new Set(orders.map((o) => o.bomRevisionId))]),
      loadBomOptionExclusions(this.prisma, orders),
    ]);
    const materialIds = new Set<bigint>();
    for (const v of linesByPiece.values()) {
      for (const l of [...v.wire, ...v.nail, ...v.plasticButton, ...v.finishedComponent]) {
        materialIds.add(BigInt(l.materialId));
      }
    }
    const materials =
      materialIds.size > 0
        ? await this.prisma.material.findMany({
            where: { id: { in: [...materialIds] } },
            select: { id: true, warehouse: { select: { code: true } } },
          })
        : [];
    const whOf = new Map(materials.map((m) => [m.id.toString(), m.warehouse?.code ?? null]));

    const out = new Map<
      string,
      {
        productionOrderId: string;
        pieceId: string;
        pieceCode: string;
        pieceName: string;
        pieceQty: number;
        materialId: string;
        materialCode: string;
        materialName: string;
        unit: string;
        warehouseCode: string | null;
        qtyPerPiece: number;
        demandQty: number;
        coveredQty: number;
        remainingQty: number;
        onHandQty: number;
      }[]
    >();
    for (const slip of slips) {
      const covered = new Map<string, number>();
      for (const p of slip.pairedBy) {
        for (const l of p.lines) {
          const k = `${l.productionOrderId}:${l.pieceId}:${l.materialId}`;
          covered.set(k, (covered.get(k) ?? 0) + l.qty.toNumber());
        }
      }
      const rows = [];
      for (const l of slip.lines) {
        if (l.kind !== IssueSlipLineKind.WEAVING_PIECE || !l.productionOrderId || !l.pieceId)
          continue;
        const order = orderById.get(l.productionOrderId.toString());
        if (!order) continue;
        const excluded = exclusions.get(order.id.toString()) ?? new Set<string>();
        const v = linesByPiece.get(`${order.bomRevisionId}:${l.pieceId}`);
        if (!v) continue;
        const pieceQty = l.qty.toNumber();
        for (const m of [...v.wire, ...v.nail, ...v.plasticButton, ...v.finishedComponent]) {
          if (excluded.has(m.materialId)) continue;
          const demandQty = round4(m.qtyPerPiece * pieceQty);
          const coveredQty = round4(
            covered.get(`${l.productionOrderId}:${l.pieceId}:${m.materialId}`) ?? 0,
          );
          rows.push({
            productionOrderId: l.productionOrderId.toString(),
            pieceId: l.pieceId.toString(),
            pieceCode: l.piece?.code ?? '',
            pieceName: l.piece?.name ?? '',
            pieceQty,
            materialId: m.materialId,
            materialCode: m.materialCode,
            materialName: m.materialName,
            unit: m.materialUnit,
            warehouseCode: whOf.get(m.materialId) ?? null,
            qtyPerPiece: m.qtyPerPiece,
            demandQty,
            coveredQty,
            remainingQty: round4(Math.max(0, demandQty - coveredQty)),
            onHandQty: m.onHandQty,
          });
        }
      }
      out.set(slip.id.toString(), rows);
    }
    return out;
  }

  /**
   * Báo kho giữ vật tư kèm (thường kho Phụ kiện) khi phiếu mảnh còn thiếu phiếu vật tư; tự đóng khi
   * đã đủ hoặc phiếu mảnh huỷ. Best-effort sau commit - lỗi chỉ ghi log.
   */
  private async syncWeavingMaterialNotice(pieceSlipId: bigint): Promise<void> {
    try {
      const slip = await this.prisma.issueSlip.findUnique({
        where: { id: pieceSlipId },
        include: {
          ...SLIP_INCLUDE,
          pairedBy: {
            where: { status: { not: IssueSlipStatus.CANCELLED } },
            select: {
              lines: {
                select: { productionOrderId: true, pieceId: true, materialId: true, qty: true },
              },
            },
          },
        },
      });
      if (!slip) return;
      const entityId = slip.id.toString();
      const lines =
        slip.status === IssueSlipStatus.CANCELLED
          ? []
          : ((await this.computeWeavingDemand([slip])).get(entityId) ?? []).filter(
              (d) => d.remainingQty > 0 && d.warehouseCode,
            );
      if (lines.length === 0) {
        await this.notifications.resolve({
          entityType: 'ISSUE_SLIP',
          entityId,
          types: ['WEAVING_MATERIALS_NEEDED'],
        });
        return;
      }
      const pieces = new Map<string, string>();
      for (const l of slip.lines) {
        if (l.kind === IssueSlipLineKind.WEAVING_PIECE) {
          pieces.set(
            `${l.productionOrderId}:${l.pieceId}`,
            `${l.piece?.name ?? ''} ×${l.qty.toNumber()}`,
          );
        }
      }
      await this.notifications.emit('WEAVING_MATERIALS_NEEDED', {
        entityId,
        actorId: slip.createdById,
        dedupeKey: `WEAVING_MATERIALS_NEEDED:${entityId}`,
        params: {
          slipCode: slip.code,
          weavingPointName: slip.weavingPoint
            ? slip.weavingPoint.fullName?.trim() || slip.weavingPoint.code
            : '',
          pieceSummary: [...pieces.values()].join(', '),
          warehouseCodes: [...new Set(lines.map((l) => l.warehouseCode!))],
        },
      });
    } catch (error) {
      this.logger.error(
        `Không cập nhật được thông báo vật tư kèm đan (phiếu ${pieceSlipId}): ${(error as Error).message}`,
      );
    }
  }

  /**
   * Bước 2: ảnh phiếu đã ký -> trừ tồn mọi dòng trong 1 transaction. Gửi lại cùng Idempotency-Key
   * trả kết quả cũ.
   */
  async confirm(
    id: string,
    signedSlipUrls: string[],
    userId: string,
    scope: string | null,
    idempotencyKey: string,
  ) {
    const slip = await this.findRowOrThrow(id);
    if (slip.status === IssueSlipStatus.ISSUED && slip.confirmKey === idempotencyKey) {
      return this.toDto(slip, await this.lenhCodesOf(slip));
    }
    this.assertDraft(slip);
    const urls = cleanUrls(signedSlipUrls);
    if (urls.length === 0) {
      throw new BadRequestException('Cần ảnh phiếu xuất đã có chữ ký người nhận');
    }

    // Kiểm lại từng dòng (trạng thái lệnh/định mức có thể đã đổi từ lúc in phiếu) - đọc ngoài
    // transaction như luồng cũ.
    if (slip.pairedSlip?.status === IssueSlipStatus.CANCELLED) {
      throw new ConflictException(
        `Phiếu mảnh ${slip.pairedSlip.code} đi cùng chuyến đã huỷ - huỷ phiếu vật tư kèm này`,
      );
    }
    const prepared: PreparedLine[] = [];
    const slipWarehouse = { id: slip.warehouseId, code: slip.warehouse.code };
    for (const line of slip.lines)
      prepared.push(await this.prepareLine(line, scope, slipWarehouse, slip.weavingPointId));
    // Thứ tự ghi cố định theo vật tư/mảnh rồi dòng - 2 phiếu chạm cùng hàng khoá cùng thứ tự, không
    // khoá chéo.
    const order = [...prepared].sort((a, b) => {
      const ma = this.sortKeyOf(a);
      const mb = this.sortKeyOf(b);
      if (ma !== mb) return ma < mb ? -1 : 1;
      return a.lineId < b.lineId ? -1 : 1;
    });

    const done = await this.prisma.$transaction(
      async (tx) => {
        const [row] = await tx.$queryRaw<{ status: IssueSlipStatus }[]>`
          SELECT "status" FROM "issue_slips" WHERE "id" = ${slip.id} FOR UPDATE
        `;
        if (row?.status !== IssueSlipStatus.DRAFT) {
          throw new ConflictException(
            `Phiếu ${slip.code} vừa được xuất hoặc huỷ ở nơi khác - tải lại trang`,
          );
        }
        const steel: SteelIssueRow[] = [];
        const consumables: MaterialIssueRow[] = [];
        const weavingPieces: WeavingIssueRow[] = [];
        const packagings: PackagingIssueRow[] = [];
        const yields: MaterialYieldIssueRow[] = [];
        const recipeIssues: MaterialYieldRecipeIssueRow[] = [];
        for (const p of order) {
          const key = `issue-slip:${slip.id}:line:${p.lineId}`;
          if (p.kind === 'PACKAGING') {
            const issue = await this.packaging.createInTx(tx, p.prepared, userId, key);
            await tx.issueSlipLine.update({
              where: { id: p.lineId },
              data: { packagingIssueId: issue.id },
            });
            packagings.push(issue);
            continue;
          }
          if (p.kind === 'MATERIAL_YIELD') {
            const issue = await this.materialYield.createInTx(tx, p.prepared, userId, key);
            await tx.issueSlipLine.update({
              where: { id: p.lineId },
              data: { materialYieldIssueId: issue.id },
            });
            yields.push(issue);
            continue;
          }
          if (p.kind === 'MATERIAL_YIELD_RECIPE') {
            const issue = await this.materialYieldRecipe.createInTx(tx, p.prepared, userId, key);
            await tx.issueSlipLine.update({
              where: { id: p.lineId },
              data: { materialYieldRecipeIssueId: issue.id },
            });
            recipeIssues.push(issue);
            continue;
          }
          if (p.kind === 'WEAVING_PIECE') {
            await this.weaving.assertPieceCapInTx(tx, p.prepared, slip.id);
            const issue = await this.weaving.createPieceIssueInTx(tx, p.prepared, userId, key);
            await tx.issueSlipLine.update({
              where: { id: p.lineId },
              data: { weavingIssueId: issue.id },
            });
            weavingPieces.push(issue);
            continue;
          }
          if (p.kind === 'WEAVING_MATERIAL') {
            const row = await this.weaving.createMaterialIssueInTx(tx, p.prepared, userId, key);
            await tx.issueSlipLine.update({
              where: { id: p.lineId },
              data: { weavingIssueMaterialId: row.id },
            });
            continue;
          }
          if (p.kind === 'STEEL') {
            const issue = await this.steelIssues.createInTx(tx, p.prepared, userId, key);
            await tx.issueSlipLine.update({
              where: { id: p.lineId },
              data: { steelIssueId: issue.id },
            });
            steel.push(issue);
          } else if (p.kind === 'CONSUMABLE') {
            const issue = await this.materialIssues.createInTx(tx, p.prepared, userId, key);
            await tx.issueSlipLine.update({
              where: { id: p.lineId },
              data: { materialIssueId: issue.id },
            });
            consumables.push(issue);
          } else {
            await this.issueShared(tx, p, userId, slip.code);
          }
        }
        await tx.issueSlip.update({
          where: { id: slip.id },
          data: {
            status: IssueSlipStatus.ISSUED,
            signedSlipUrls: urls,
            issuedById: userId,
            issuedAt: new Date(),
            confirmKey: idempotencyKey,
          },
        });
        return { steel, consumables, weavingPieces, packagings, yields, recipeIssues };
      },
      { timeout: 60_000 },
    );

    for (const issue of done.steel) await this.steelIssues.afterCreate(issue, userId);
    for (const issue of done.consumables) await this.materialIssues.afterCreate(issue, userId);
    for (const issue of done.weavingPieces) await this.weaving.afterPieceIssue(issue, userId);
    for (const issue of done.packagings) await this.packaging.afterCreate(issue, userId);
    for (const issue of done.yields) await this.materialYield.afterCreate(issue, userId);
    for (const issue of done.recipeIssues)
      await this.materialYieldRecipe.afterCreate(issue, userId);
    if (slip.weavingPointId) this.publishWeaving(slip.id, userId);
    this.publish(slip.id, 'UPDATED', userId);
    if (done.steel.length > 0) this.requestFloorAlertsCheck(slip.code);
    return this.findOne(id);
  }

  /**
   * Phiếu có dòng sắt vừa xuất: nhờ FloorAlertsService quét sớm để tin "Xuất sắt ..." tự đóng
   * ngay thay vì đợi lượt định kỳ. Là phần phụ: lỗi chỉ ghi log, không làm hỏng xác nhận phiếu.
   */
  private requestFloorAlertsCheck(slipCode: string): void {
    try {
      this.floorAlerts.requestEvaluate({ urgent: true });
    } catch (error) {
      this.logger.warn(
        `Không yêu cầu được quét nhắc việc sau khi xuất sắt (phiếu ${slipCode}): ${(error as Error).message}`,
      );
    }
  }

  /** Huỷ phiếu CHƯA xuất (in sai, người nhận không nhận...). Số phiếu giữ nguyên, không cấp lại. */
  async cancel(id: string, reason: string, userId: string, scope: string | null) {
    const slip = await this.findRowOrThrow(id);
    this.assertDraft(slip);
    this.assertSlipScope(slip, scope);
    const { count } = await this.prisma.issueSlip.updateMany({
      where: { id: slip.id, status: IssueSlipStatus.DRAFT },
      data: {
        status: IssueSlipStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: reason.trim(),
      },
    });
    if (count !== 1) {
      throw new ConflictException(
        `Phiếu ${slip.code} vừa được xuất hoặc huỷ ở nơi khác - tải lại trang`,
      );
    }
    this.publish(slip.id, 'UPDATED', userId);
    if (slip.weavingPointId) {
      await this.syncWeavingMaterialNotice(slip.pairedSlipId ?? slip.id);
      this.publishWeaving(slip.id, userId);
    }
    return this.findOne(id);
  }

  async findAll(query: ListIssueSlipsQueryDto, scope: string | null) {
    const rows = await this.prisma.issueSlip.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.productionInvoiceId
          ? {
              lines: {
                some: {
                  OR: [
                    { productionInvoiceId: parseBigIntId(query.productionInvoiceId) },
                    {
                      productionOrderId: {
                        in: await this.orderIdsOfPi(parseBigIntId(query.productionInvoiceId)),
                      },
                    },
                  ],
                },
              },
            }
          : {}),
      },
      include: SLIP_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    // Thủ kho chỉ thấy phiếu kho mình (họ kho phoi-son-han thấy cả kho phụ cùng họ); tổng kho
    // (null) thấy hết.
    const visible = scope ? rows.filter((r) => this.inScope(r.warehouse.code, scope)) : rows;
    const codes = await this.lenhCodesOf(...visible);
    return visible.map((r) => this.toDto(r, codes));
  }

  async findOne(id: string) {
    const slip = await this.findRowOrThrow(id);
    return this.toDto(slip, await this.lenhCodesOf(slip));
  }

  // ─── kiểm dòng ──────────────────────────────────────────────────────────────────────────────

  private async checkLine(
    line: IssueSlipLineDto,
    scope: string | null,
    header: WeavingHeader | null,
  ): Promise<CheckedLine> {
    if (line.kind === IssueSlipLineKind.WEAVING_PIECE) {
      if (!line.productionOrderId || !line.pieceId) {
        throw new BadRequestException('Dòng mảnh xuất đan cần SKU (lệnh sản xuất) và mảnh');
      }
      const prepared = await this.weaving.prepareWeavingPiece(
        line.productionOrderId,
        line.pieceId,
        header!.weavingPointId,
        line.qty,
        scope,
      );
      return {
        dto: line,
        materialId: null,
        pieceId: prepared.pieceId,
        warehouseId: prepared.warehouse.id,
        productionInvoiceId: null,
        productionOrderId: prepared.order.id,
        weavingPiece: prepared,
      };
    }
    if (line.kind === IssueSlipLineKind.MATERIAL_YIELD_RECIPE) {
      if (!line.productionInvoiceId || !line.recipeId) {
        throw new BadRequestException('Dòng vật tư TP theo công thức cần lệnh và công thức');
      }
      const prepared = await this.materialYieldRecipe.prepareIssue(
        line.productionInvoiceId,
        { recipeId: line.recipeId, issuedQty: line.qty },
        scope,
      );
      return {
        dto: line,
        materialId: prepared.inputMaterial.id,
        pieceId: null,
        warehouseId: prepared.warehouse.id,
        productionInvoiceId: prepared.piId,
        productionOrderId: null,
        recipeId: prepared.recipeBigId,
      };
    }
    if (!line.materialId) throw new BadRequestException('Dòng phiếu xuất cần vật tư');
    if (line.kind === IssueSlipLineKind.PACKAGING) {
      if (!line.productionOrderId) {
        throw new BadRequestException('Dòng vật tư đóng gói cần SKU (lệnh sản xuất)');
      }
      const prepared = await this.packaging.prepareIssue(
        line.productionOrderId,
        { materialId: line.materialId, issuedQty: line.qty, note: line.note?.trim() || undefined },
        scope,
      );
      return {
        dto: line,
        materialId: prepared.materialBigId,
        pieceId: null,
        warehouseId: prepared.sourceWarehouse.id,
        productionInvoiceId: null,
        productionOrderId: prepared.order.id,
        packaging: prepared,
      };
    }
    if (line.kind === IssueSlipLineKind.MATERIAL_YIELD) {
      if (!line.productionOrderId) {
        throw new BadRequestException('Dòng vật tư TP cần SKU (lệnh sản xuất)');
      }
      const prepared = await this.materialYield.prepareIssue(
        line.productionOrderId,
        { materialId: line.materialId, issuedQty: line.qty },
        scope,
      );
      return {
        dto: line,
        materialId: prepared.materialBigId,
        pieceId: null,
        warehouseId: prepared.warehouse.id,
        productionInvoiceId: null,
        productionOrderId: prepared.order.id,
      };
    }
    if (line.kind === IssueSlipLineKind.WEAVING_MATERIAL) {
      if (!line.productionOrderId || !line.pieceId) {
        throw new BadRequestException('Dòng vật tư kèm đan cần SKU (lệnh sản xuất) và mảnh');
      }
      const prepared = await this.weaving.prepareWeavingMaterial(
        line.productionOrderId,
        line.pieceId,
        line.materialId,
        header!.weavingPointId,
        line.qty,
        scope,
      );
      return {
        dto: line,
        materialId: prepared.materialId,
        pieceId: prepared.pieceId,
        warehouseId: prepared.warehouseId,
        productionInvoiceId: null,
        productionOrderId: prepared.order.id,
        weavingMaterial: prepared,
      };
    }
    const materialId = parseBigIntId(line.materialId);
    if (line.kind === IssueSlipLineKind.STEEL) {
      if (!line.productionInvoiceId || !line.barLengthMm) {
        throw new BadRequestException('Dòng sắt cần lệnh và chiều dài cây');
      }
      if (!Number.isInteger(line.qty)) {
        throw new BadRequestException('Số cây sắt phải là số nguyên');
      }
      this.assertSteelScope(scope);
      const prepared = await this.steelIssues.prepareIssue(line.productionInvoiceId, {
        materialId: line.materialId,
        barLengthMm: line.barLengthMm,
        barCount: line.qty,
      });
      this.steelIssues.assertWarehouseScope(prepared, scope);
      return {
        dto: line,
        materialId,
        pieceId: null,
        warehouseId: prepared.warehouse.id,
        productionInvoiceId: prepared.productionInvoiceId,
        productionOrderId: null,
      };
    }
    if (line.kind === IssueSlipLineKind.CONSUMABLE) {
      if (!line.productionOrderId || !line.stage) {
        throw new BadRequestException('Dòng vật tư tiêu hao cần SKU (lệnh sản xuất) và công đoạn');
      }
      const prepared = await this.materialIssues.prepareIssue(
        line.productionOrderId,
        { stage: line.stage, materialId: line.materialId, issuedQty: line.qty },
        scope,
      );
      return {
        dto: line,
        materialId,
        pieceId: null,
        warehouseId: prepared.warehouse.id,
        productionInvoiceId: null,
        productionOrderId: prepared.order.id,
      };
    }
    const material = await this.loadSharedMaterial(materialId, scope, null);
    return {
      dto: line,
      materialId,
      pieceId: null,
      warehouseId: material.warehouseId,
      productionInvoiceId: null,
      productionOrderId: null,
    };
  }

  private async prepareLine(
    line: SlipRow['lines'][number],
    scope: string | null,
    slipWarehouse: WarehouseLike,
    weavingPointId: bigint | null,
  ): Promise<PreparedLine> {
    const qty = line.qty.toNumber();
    if (line.kind === IssueSlipLineKind.WEAVING_PIECE) {
      const prepared = await this.weaving.prepareWeavingPiece(
        line.productionOrderId!.toString(),
        line.pieceId!.toString(),
        weavingPointId!,
        qty,
        scope,
      );
      if (prepared.warehouse.id !== slipWarehouse.id) {
        throw new ConflictException(
          `Mảnh ${prepared.pieceName} nay thuộc kho ${prepared.warehouse.code}, khác kho của phiếu - huỷ phiếu và lập lại`,
        );
      }
      return { lineId: line.id, kind: 'WEAVING_PIECE', prepared };
    }
    if (line.kind === IssueSlipLineKind.MATERIAL_YIELD_RECIPE) {
      const prepared = await this.materialYieldRecipe.prepareIssue(
        line.productionInvoiceId!.toString(),
        { recipeId: line.recipeId!.toString(), issuedQty: qty },
        scope,
      );
      return { lineId: line.id, kind: 'MATERIAL_YIELD_RECIPE', prepared };
    }
    const materialId = line.materialId!;
    if (line.kind === IssueSlipLineKind.PACKAGING) {
      const prepared = await this.packaging.prepareIssue(
        line.productionOrderId!.toString(),
        { materialId: materialId.toString(), issuedQty: qty, note: line.note ?? undefined },
        scope,
      );
      return { lineId: line.id, kind: 'PACKAGING', prepared };
    }
    if (line.kind === IssueSlipLineKind.MATERIAL_YIELD) {
      const prepared = await this.materialYield.prepareIssue(
        line.productionOrderId!.toString(),
        { materialId: materialId.toString(), issuedQty: qty },
        scope,
      );
      return { lineId: line.id, kind: 'MATERIAL_YIELD', prepared };
    }
    if (line.kind === IssueSlipLineKind.WEAVING_MATERIAL) {
      const prepared = await this.weaving.prepareWeavingMaterial(
        line.productionOrderId!.toString(),
        line.pieceId!.toString(),
        materialId.toString(),
        weavingPointId!,
        qty,
        scope,
      );
      return { lineId: line.id, kind: 'WEAVING_MATERIAL', prepared };
    }
    if (line.kind === IssueSlipLineKind.STEEL) {
      this.assertSteelScope(scope);
      const prepared = await this.steelIssues.prepareIssue(line.productionInvoiceId!.toString(), {
        materialId: materialId.toString(),
        barLengthMm: line.barLengthMm!,
        barCount: qty,
      });
      this.steelIssues.assertWarehouseScope(prepared, scope);
      return { lineId: line.id, kind: 'STEEL', prepared };
    }
    if (line.kind === IssueSlipLineKind.CONSUMABLE) {
      const prepared = await this.materialIssues.prepareIssue(
        line.productionOrderId!.toString(),
        { stage: line.stage!, materialId: materialId.toString(), issuedQty: qty },
        scope,
      );
      return { lineId: line.id, kind: 'CONSUMABLE', prepared };
    }
    const material = await this.loadSharedMaterial(materialId, scope, slipWarehouse);
    return {
      lineId: line.id,
      kind: 'SHARED',
      materialId,
      warehouseId: material.warehouseId,
      qty,
    };
  }

  /**
   * Dòng "Dùng chung" (4.9): không trừ định mức lệnh nào, chỉ lấy từ tồn CHƯA giữ cho lệnh nào -
   * tồn khả dụng trừ MỌI giữ chỗ (không loại trừ PI nào, khác luồng xuất theo lệnh).
   */
  private async issueShared(
    tx: PrismaTx,
    p: Extract<PreparedLine, { kind: 'SHARED' }>,
    userId: string,
    slipCode: string,
  ): Promise<void> {
    const [stockRow] = await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
      SELECT "qty" FROM "stock_quant"
      WHERE "warehouseId" = ${p.warehouseId} AND "materialId" = ${p.materialId}
        AND "stockLengthMm" = 0 AND "spec" = ''
      FOR UPDATE
    `;
    const onHand = stockRow?.qty.toNumber() ?? 0;
    const available = await this.reservations.getAvailableQty(
      tx,
      p.warehouseId,
      p.materialId,
      onHand,
    );
    if (p.qty > available) {
      const material = await tx.material.findUniqueOrThrow({
        where: { id: p.materialId },
        select: { code: true },
      });
      throw new ConflictException(
        `Phiếu ${slipCode}: tồn chưa giữ cho lệnh nào của ${material.code} chỉ còn ${round4(Math.max(0, available))} - không đủ xuất dùng chung ${p.qty}`,
      );
    }
    const production = await tx.warehouse.findUniqueOrThrow({
      where: { code: PRODUCTION_WAREHOUSE_CODE },
    });
    await this.stockLedger.postEntry(
      {
        fromWarehouseId: p.warehouseId,
        toWarehouseId: production.id,
        materialId: p.materialId,
        qty: p.qty,
        refType: StockLedgerRefType.ISSUE_SLIP_SHARED,
        refId: p.lineId.toString(),
        createdById: userId,
        idempotencyKey: `issue-slip-line:${p.lineId}:shared`,
      },
      tx,
    );
  }

  /**
   * Dòng "Dùng chung" lấy ở kho CÙNG LOẠI với kho mặc định của vật tư, thuộc xưởng của thủ kho (thủ
   * kho Hàn Phước An lấy dây hàn ở kho mình). Lúc xác nhận dùng đúng kho đã ghi trên phiếu
   * (`slipWarehouseId`), không suy lại.
   */
  private async loadSharedMaterial(
    materialId: bigint,
    scope: string | null,
    slipWarehouse: WarehouseLike | null,
  ) {
    const m = await this.prisma.material.findUnique({
      where: { id: materialId },
      select: {
        code: true,
        warehouseId: true,
        warehouse: { select: { id: true, code: true, kind: true, workshopId: true } },
        materialGroup: { select: { systemKey: true } },
      },
    });
    if (!m) throw new NotFoundException(`Không tìm thấy vật tư ${materialId}`);
    if (!m.warehouseId || !m.warehouse) {
      throw new BadRequestException(`Vật tư ${m.code} chưa được gán kho`);
    }
    if (m.materialGroup?.systemKey === MATERIAL_GROUP_SYSTEM_KEYS.STEEL_BAR) {
      throw new BadRequestException(`Sắt (${m.code}) xuất theo lệnh, không xuất dùng chung`);
    }
    // Thủ kho Phôi/Hàn/Sơn xuất "Dùng chung" từ CHÍNH kho mình (vd đá cắt kho mặc định kho Phôi, đã
    // chuyển một phần sang kho Hàn bằng phiếu chuyển kho) - đủ hay không do bước xác nhận kiểm tồn
    // khả dụng của kho đó.
    const scopeWarehouse =
      !slipWarehouse && scope && warehouseFamilyOf(scope) === STEEL_FAMILY
        ? await this.prisma.warehouse.findUnique({
            where: { code: scope },
            select: { id: true, code: true },
          })
        : null;
    const real =
      slipWarehouse ??
      scopeWarehouse ??
      (await new WorkshopWarehouseResolver(this.prisma).sameKindAs(
        {
          id: m.warehouseId,
          code: m.warehouse.code,
          kind: m.warehouse.kind,
          workshopId: m.warehouse.workshopId,
        },
        scope,
      ));
    if (scope && real.code !== scope) {
      throw new ForbiddenException(`Bạn không phụ trách kho ${real.code} của vật tư ${m.code}`);
    }
    return { warehouseId: real.id };
  }

  private assertSteelScope(scope: string | null): void {
    if (scope && !isFamilyScope(scope, STEEL_FAMILY)) {
      throw new ForbiddenException(`Bạn phụ trách kho '${scope}', không xuất sắt được`);
    }
  }

  private assertSlipScope(slip: SlipRow, scope: string | null): void {
    if (scope && !this.inScope(slip.warehouse.code, scope)) {
      throw new ForbiddenException(`Phiếu ${slip.code} thuộc kho ${slip.warehouse.code}`);
    }
  }

  /**
   * Kho của phiếu thuộc phạm vi thủ kho: đúng kho (mỗi kho Phôi/Hàn/Sơn có thủ kho riêng, không còn
   * xem chung cả họ).
   */
  private inScope(warehouseCode: string, scope: string): boolean {
    return warehouseCode === scope;
  }

  private assertDraft(slip: SlipRow): void {
    if (slip.status !== IssueSlipStatus.DRAFT) {
      throw new ConflictException(
        slip.status === IssueSlipStatus.ISSUED
          ? `Phiếu ${slip.code} đã xuất`
          : `Phiếu ${slip.code} đã huỷ`,
      );
    }
  }

  /** Khoá sắp thứ tự ghi: vật tư theo id, mảnh theo (lệnh, mảnh) - chuỗi đệm số để so được. */
  private sortKeyOf(p: PreparedLine): string {
    const pad = (n: bigint) => n.toString().padStart(20, '0');
    if (p.kind === 'WEAVING_PIECE') {
      return `p:${pad(p.prepared.order.id)}:${pad(p.prepared.pieceId)}`;
    }
    if (p.kind === 'STEEL') return `m:${pad(p.prepared.materialId)}`;
    if (p.kind === 'CONSUMABLE') return `m:${pad(p.prepared.materialBigId)}`;
    if (p.kind === 'WEAVING_MATERIAL') return `m:${pad(p.prepared.materialId)}`;
    if (p.kind === 'PACKAGING' || p.kind === 'MATERIAL_YIELD') {
      return `m:${pad(p.prepared.materialBigId)}`;
    }
    if (p.kind === 'MATERIAL_YIELD_RECIPE') return `m:${pad(p.prepared.inputMaterial.id)}`;
    return `m:${pad(p.materialId)}`;
  }

  private async orderIdsOfPi(piId: bigint): Promise<bigint[]> {
    const orders = await this.prisma.productionOrder.findMany({
      where: { productionInvoiceItem: { productionInvoiceId: piId } },
      select: { id: true },
    });
    return orders.map((o) => o.id);
  }

  private async findRowOrThrow(id: string): Promise<SlipRow> {
    const slip = await this.prisma.issueSlip.findUnique({
      where: { id: parseBigIntId(id) },
      include: SLIP_INCLUDE,
    });
    if (!slip) throw new NotFoundException(`Không tìm thấy phiếu xuất ${id}`);
    return slip;
  }

  // ─── hiển thị ───────────────────────────────────────────────────────────────────────────────

  /** Mã lệnh hiển thị (số LSX) của từng dòng: dòng sắt theo PI, dòng tiêu hao theo đúng SKU đó. */
  private async lenhCodesOf(...slips: SlipRow[]) {
    const lines = slips.flatMap((s) => s.lines);
    const piIds = lines.map((l) => l.productionInvoiceId).filter((x): x is bigint => x != null);
    const orderIds = lines.map((l) => l.productionOrderId).filter((x): x is bigint => x != null);
    const [byPi, orders] = await Promise.all([
      loadLenhDisplayCodes(this.prisma, piIds),
      orderIds.length > 0
        ? this.prisma.productionOrder.findMany({
            where: { id: { in: orderIds } },
            select: {
              id: true,
              poNumber: true,
              mfgProduct: { select: { factoryCode: true } },
              productionInvoiceItem: {
                select: {
                  lsxCode: true,
                  productionInvoiceId: true,
                  productionInvoice: { select: { code: true } },
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);
    const byOrder = new Map(
      orders.map((o) => [
        o.id.toString(),
        {
          lenhCode:
            o.productionInvoiceItem.lsxCode?.trim() ||
            o.productionInvoiceItem.productionInvoice?.code ||
            o.poNumber,
          sku: o.mfgProduct.factoryCode,
          productionInvoiceId: o.productionInvoiceItem.productionInvoiceId?.toString() ?? null,
        },
      ]),
    );
    return { byPi, byOrder };
  }

  private toDto(slip: SlipRow, codes: Awaited<ReturnType<IssueSlipsService['lenhCodesOf']>>) {
    return {
      id: slip.id.toString(),
      code: slip.code,
      status: slip.status,
      warehouseCode: slip.warehouse.code,
      warehouseName: slip.warehouse.name,
      recipientName: slip.recipientName,
      note: slip.note,
      signedSlipUrls: slip.signedSlipUrls,
      createdByName: fullName(slip.createdBy),
      createdAt: slip.createdAt,
      issuedByName: fullName(slip.issuedBy),
      issuedAt: slip.issuedAt,
      cancelledAt: slip.cancelledAt,
      cancelReason: slip.cancelReason,
      weavingPointId: slip.weavingPointId?.toString() ?? null,
      weavingPointName: slip.weavingPoint
        ? slip.weavingPoint.fullName?.trim() || slip.weavingPoint.code
        : null,
      pairedSlipId: slip.pairedSlip?.id.toString() ?? null,
      pairedSlipCode: slip.pairedSlip?.code ?? null,
      lines: slip.lines.map((l) => {
        const order = l.productionOrderId
          ? codes.byOrder.get(l.productionOrderId.toString())
          : null;
        return {
          id: l.id.toString(),
          kind: l.kind,
          materialId: l.materialId?.toString() ?? null,
          // Dòng mảnh: mã/tên hàng là mã/tên mảnh (phiếu in cùng cột "Mã vật tư").
          materialCode: l.material?.code ?? l.piece?.code ?? '',
          materialName: l.material?.name ?? l.piece?.name ?? '',
          unit:
            l.kind === IssueSlipLineKind.STEEL
              ? 'cây'
              : l.kind === IssueSlipLineKind.WEAVING_PIECE
                ? 'mảnh'
                : (l.material?.unit ?? ''),
          pieceId: l.pieceId?.toString() ?? null,
          pieceName: l.piece?.name ?? null,
          recipeId: l.recipeId?.toString() ?? null,
          productionInvoiceId:
            l.productionInvoiceId?.toString() ?? order?.productionInvoiceId ?? null,
          productionOrderId: l.productionOrderId?.toString() ?? null,
          lenhCode: l.productionInvoiceId
            ? (codes.byPi.get(l.productionInvoiceId.toString()) ?? null)
            : (order?.lenhCode ?? null),
          sku: order?.sku ?? null,
          stage: l.stage,
          barLengthMm: l.barLengthMm,
          qty: l.qty.toNumber(),
          note: l.note,
        };
      }),
    };
  }

  /** Màn xuất đan / vật tư kèm nghe topic 'weaving-issues'. */
  private publishWeaving(id: bigint, actorId: string): void {
    try {
      this.realtime.publishEntityChanged({
        entity: 'WEAVING_ISSUE',
        entityId: id,
        action: 'UPDATED',
        actorId,
      });
    } catch (error) {
      this.logger.error(`Không phát realtime xuất đan (phiếu ${id}): ${(error as Error).message}`);
    }
  }

  private publish(id: bigint, action: 'CREATED' | 'UPDATED', actorId: string): void {
    try {
      this.realtime.publishEntityChanged({ entity: 'ISSUE_SLIP', entityId: id, action, actorId });
    } catch (error) {
      this.logger.error(`Không phát realtime phiếu xuất ${id}: ${(error as Error).message}`);
    }
  }
}
