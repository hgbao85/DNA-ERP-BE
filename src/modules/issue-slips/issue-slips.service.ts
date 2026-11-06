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
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { isFamilyScope } from '../../common/utils/warehouse-family.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import {
  MaterialIssueRow,
  MaterialIssuesService,
  PreparedMaterialIssue,
} from '../material-issues/material-issues.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
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
  lines: {
    orderBy: { id: 'asc' },
    include: { material: { select: { code: true, name: true, unit: true } } },
  },
} satisfies Prisma.IssueSlipInclude;

type SlipRow = Prisma.IssueSlipGetPayload<{ include: typeof SLIP_INCLUDE }>;

/** 1 dòng đã kiểm xong trước transaction - đủ để ghi trong transaction xác nhận. */
type PreparedLine =
  | { lineId: bigint; kind: 'STEEL'; prepared: PreparedSteelIssue }
  | { lineId: bigint; kind: 'CONSUMABLE'; prepared: PreparedMaterialIssue }
  | { lineId: bigint; kind: 'SHARED'; materialId: bigint; warehouseId: bigint; qty: number };

/** Dòng phiếu sau khi kiểm (lúc tạo phiếu) - kèm kho thật của dòng để bắt "mỗi phiếu chỉ 1 kho". */
interface CheckedLine {
  dto: IssueSlipLineDto;
  materialId: bigint;
  warehouseId: bigint;
  productionInvoiceId: bigint | null;
  productionOrderId: bigint | null;
}

const fullName = (u: { firstName: string; lastName: string } | null) =>
  u ? `${u.lastName} ${u.firstName}`.trim() : null;

/**
 * Phiếu xuất kho XK-yymmdd-NNN (Đợt 6, bản v8 YC4 4.1-4.4, 4.8, 4.9). Đợt 1 gồm xuất sắt cho Phôi và xuất vật tư tiêu hao
 * Hàn/Sơn, thêm dòng "Dùng chung" (không theo lệnh, chỉ lấy từ tồn chưa giữ).
 *
 * 2 bước: tạo phiếu (kiểm từng dòng, cấp số, CHƯA trừ tồn) -> in -> người nhận ký -> thủ kho tải ảnh phiếu đã ký và "Xác nhận
 * xuất" - lúc đó mới trừ tồn MỌI dòng trong 1 transaction (dùng lõi createInTx của SteelIssuesService/MaterialIssuesService, giữ
 * nguyên mọi chốt cũ: giữ chỗ, tồn khả dụng, định mức, ưu tiên SKU sớm YC11). Một dòng hỏng thì cả phiếu không xuất. Khoá cứng:
 * route xuất từng dòng cũ đã gỡ, không còn đường xuất nào thiếu ảnh (V4-1).
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
  ) {}

  async create(dto: CreateIssueSlipDto, userId: string, scope: string | null) {
    const checked: CheckedLine[] = [];
    for (const line of dto.lines) checked.push(await this.checkLine(line, scope));
    const warehouseIds = new Set(checked.map((c) => c.warehouseId.toString()));
    if (warehouseIds.size > 1) {
      throw new BadRequestException(
        'Mỗi phiếu xuất chỉ cho một kho - các vật tư đã chọn nằm ở nhiều kho khác nhau, tách thành nhiều phiếu',
      );
    }

    const slipId = await this.prisma.$transaction(async (tx) => {
      const code = await allocateSlipCode(tx, 'XK');
      const slip = await tx.issueSlip.create({
        data: {
          code,
          warehouseId: checked[0].warehouseId,
          recipientName: dto.recipientName?.trim() || null,
          note: dto.note?.trim() || null,
          createdById: userId,
          lines: {
            create: checked.map((c) => ({
              kind: c.dto.kind,
              materialId: c.materialId,
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
    });
    this.publish(slipId, 'CREATED', userId);
    return this.findOne(slipId.toString());
  }

  /** Bước 2: ảnh phiếu đã ký -> trừ tồn mọi dòng trong 1 transaction. Gửi lại cùng Idempotency-Key trả kết quả cũ. */
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

    // Kiểm lại từng dòng (trạng thái lệnh/định mức có thể đã đổi từ lúc in phiếu) - đọc ngoài transaction như luồng cũ.
    const prepared: PreparedLine[] = [];
    for (const line of slip.lines) prepared.push(await this.prepareLine(line, scope));
    // Thứ tự ghi cố định theo vật tư rồi dòng - 2 phiếu chạm cùng vật tư khoá cùng thứ tự, không khoá chéo.
    const order = [...prepared].sort((a, b) => {
      const ma = this.materialOf(a);
      const mb = this.materialOf(b);
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
        for (const p of order) {
          const key = `issue-slip:${slip.id}:line:${p.lineId}`;
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
        return { steel, consumables };
      },
      { timeout: 60_000 },
    );

    for (const issue of done.steel) await this.steelIssues.afterCreate(issue, userId);
    for (const issue of done.consumables) await this.materialIssues.afterCreate(issue, userId);
    this.publish(slip.id, 'UPDATED', userId);
    return this.findOne(id);
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
    // Thủ kho chỉ thấy phiếu kho mình (họ kho phoi-son-han thấy cả kho phụ cùng họ); tổng kho (null) thấy hết.
    const visible = scope ? rows.filter((r) => this.inScope(r.warehouse.code, scope)) : rows;
    const codes = await this.lenhCodesOf(...visible);
    return visible.map((r) => this.toDto(r, codes));
  }

  async findOne(id: string) {
    const slip = await this.findRowOrThrow(id);
    return this.toDto(slip, await this.lenhCodesOf(slip));
  }

  // ─── kiểm dòng ──────────────────────────────────────────────────────────────────────────────

  private async checkLine(line: IssueSlipLineDto, scope: string | null): Promise<CheckedLine> {
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
      return {
        dto: line,
        materialId,
        warehouseId: await this.materialWarehouseId(materialId),
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
        warehouseId: prepared.warehouse.id,
        productionInvoiceId: null,
        productionOrderId: prepared.order.id,
      };
    }
    const material = await this.loadSharedMaterial(materialId, scope);
    return {
      dto: line,
      materialId,
      warehouseId: material.warehouseId,
      productionInvoiceId: null,
      productionOrderId: null,
    };
  }

  private async prepareLine(
    line: SlipRow['lines'][number],
    scope: string | null,
  ): Promise<PreparedLine> {
    const qty = line.qty.toNumber();
    if (line.kind === IssueSlipLineKind.STEEL) {
      this.assertSteelScope(scope);
      const prepared = await this.steelIssues.prepareIssue(line.productionInvoiceId!.toString(), {
        materialId: line.materialId.toString(),
        barLengthMm: line.barLengthMm!,
        barCount: qty,
      });
      return { lineId: line.id, kind: 'STEEL', prepared };
    }
    if (line.kind === IssueSlipLineKind.CONSUMABLE) {
      const prepared = await this.materialIssues.prepareIssue(
        line.productionOrderId!.toString(),
        { stage: line.stage!, materialId: line.materialId.toString(), issuedQty: qty },
        scope,
      );
      return { lineId: line.id, kind: 'CONSUMABLE', prepared };
    }
    const material = await this.loadSharedMaterial(line.materialId, scope);
    return {
      lineId: line.id,
      kind: 'SHARED',
      materialId: line.materialId,
      warehouseId: material.warehouseId,
      qty,
    };
  }

  /**
   * Dòng "Dùng chung" (4.9): không trừ định mức lệnh nào, chỉ lấy từ tồn CHƯA giữ cho lệnh nào - tồn khả dụng trừ MỌI giữ chỗ
   * (không loại trừ PI nào, khác luồng xuất theo lệnh).
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

  private async loadSharedMaterial(materialId: bigint, scope: string | null) {
    const m = await this.prisma.material.findUnique({
      where: { id: materialId },
      select: {
        code: true,
        warehouseId: true,
        warehouse: { select: { code: true } },
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
    if (scope && m.warehouse.code !== scope) {
      throw new ForbiddenException(
        `Bạn không phụ trách kho ${m.warehouse.code} của vật tư ${m.code}`,
      );
    }
    return { warehouseId: m.warehouseId };
  }

  private async materialWarehouseId(materialId: bigint): Promise<bigint> {
    const m = await this.prisma.material.findUnique({
      where: { id: materialId },
      select: { code: true, warehouseId: true },
    });
    if (!m?.warehouseId) {
      throw new BadRequestException(`Vật tư ${m?.code ?? materialId} chưa được gán kho`);
    }
    return m.warehouseId;
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

  /** Kho của phiếu thuộc phạm vi thủ kho: đúng kho, hoặc cùng họ phoi-son-han (sắt xuất từ kho chung của họ). */
  private inScope(warehouseCode: string, scope: string): boolean {
    if (warehouseCode === scope) return true;
    return isFamilyScope(scope, STEEL_FAMILY) && isFamilyScope(warehouseCode, STEEL_FAMILY);
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

  private materialOf(p: PreparedLine): bigint {
    if (p.kind === 'STEEL') return p.prepared.materialId;
    if (p.kind === 'CONSUMABLE') return p.prepared.materialBigId;
    return p.materialId;
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
      lines: slip.lines.map((l) => {
        const order = l.productionOrderId
          ? codes.byOrder.get(l.productionOrderId.toString())
          : null;
        return {
          id: l.id.toString(),
          kind: l.kind,
          materialId: l.materialId.toString(),
          materialCode: l.material.code,
          materialName: l.material.name,
          unit: l.kind === IssueSlipLineKind.STEEL ? 'cây' : l.material.unit,
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

  private publish(id: bigint, action: 'CREATED' | 'UPDATED', actorId: string): void {
    try {
      this.realtime.publishEntityChanged({ entity: 'ISSUE_SLIP', entityId: id, action, actorId });
    } catch (error) {
      this.logger.error(`Không phát realtime phiếu xuất ${id}: ${(error as Error).message}`);
    }
  }
}
