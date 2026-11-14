import {
  BomRevisionStatus,
  CuttingProposalStatus,
  MfgStage,
  ProductionOrderFloorStage,
  SolverMachine,
  WarehouseKind,
  WorkstationKind,
  WorkshopCapacityMode,
} from '../../src/generated/prisma/client';
import { PrismaServiceType } from '../../src/prisma/prisma.service';

export interface PatternSpec {
  barCount: number;
  segments: Array<{ cutLengthMm: number; countPerBar: number }>;
}

/**
 * Dữ liệu tự tạo cho test chia máy cắt trên Postgres test: mọi bản ghi có hậu tố riêng,
 * `cleanup()` xoá đúng những gì đã tạo (không đụng dòng nào khác).
 */
export class CutAllocationFixture {
  private seq = 0;
  private groupCreated = false;
  private groupId!: bigint;
  private mfgProductId!: bigint;
  private bomRevisionId!: bigint;
  userId!: string;

  private readonly ids = {
    workshops: [] as bigint[],
    warehouses: [] as bigint[],
    machines: [] as bigint[],
    materials: [] as bigint[],
    invoices: [] as bigint[],
    items: [] as bigint[],
    orders: [] as bigint[],
    proposals: [] as bigint[],
    specs: [] as bigint[],
  };

  constructor(
    private readonly prisma: PrismaServiceType,
    private readonly sfx: string | number,
  ) {}

  private code(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.sfx}-${this.seq}`;
  }

  async init(): Promise<void> {
    this.userId = (
      await this.prisma.user.create({
        data: {
          username: this.code('cutalloc'),
          password: 'x',
          firstName: 'Cut',
          lastName: 'Alloc',
        },
      })
    ).id;
    const group = await this.prisma.materialGroup.findUnique({ where: { systemKey: 'STEEL_BAR' } });
    if (group) {
      this.groupId = group.id;
    } else {
      this.groupCreated = true;
      this.groupId = (
        await this.prisma.materialGroup.create({
          data: { name: this.code('Sắt cây'), systemKey: 'STEEL_BAR', codePrefix: 'SAT' },
        })
      ).id;
    }
    this.mfgProductId = (
      await this.prisma.mfgProduct.create({
        data: { factoryCode: this.code('CUTALLOC'), name: 'SP chia máy' },
      })
    ).id;
    this.bomRevisionId = (
      await this.prisma.bomRevision.create({
        data: { mfgProductId: this.mfgProductId, revNo: 1, status: BomRevisionStatus.DRAFT },
      })
    ).id;
  }

  /** Xưởng + kho Phôi của xưởng (warehouse kind PHOI gắn workshopId). */
  async makeWorkshop(tag: string) {
    const ws = await this.prisma.workshop.create({
      data: {
        code: this.code(`WS${tag}`),
        name: `Xưởng test ${tag}`,
        capacityMode: WorkshopCapacityMode.CONT_PER_DAY,
      },
    });
    this.ids.workshops.push(ws.id);
    const wh = await this.prisma.warehouse.create({
      data: {
        code: this.code(`PHOI${tag}`),
        name: `Kho Phôi ${tag}`,
        kind: WarehouseKind.PHOI,
        workshopId: ws.id,
      },
    });
    this.ids.warehouses.push(wh.id);
    return { workshopId: ws.id, warehouseId: wh.id, warehouseCode: wh.code };
  }

  async makeMachine(workshopId: bigint, type: SolverMachine, tag: string) {
    const m = await this.prisma.workstation.create({
      data: {
        code: this.code(`MC${tag}`),
        name: `Máy ${tag}`,
        stage: MfgStage.PHOI,
        kind: WorkstationKind.CUT,
        qrToken: this.code(`qr${tag}`),
        workshopId,
        cutMachineType: type,
      },
    });
    this.ids.machines.push(m.id);
    return m.id;
  }

  async makeMaterial(tag: string): Promise<bigint> {
    const m = await this.prisma.material.create({
      data: {
        code: this.code(`SAT${tag}`),
        name: `Sắt test ${tag}`,
        spec: 'Phi 10',
        unit: 'cây',
        materialGroupId: this.groupId,
      },
    });
    this.ids.materials.push(m.id);
    return m.id;
  }

  /** PI + dòng gắn xưởng + lệnh SX floorStage ACTIVE. */
  async makeOrder(workshopId: bigint, tag: string) {
    const pi = await this.prisma.productionInvoice.create({
      data: { code: this.code(`PI${tag}`) },
    });
    this.ids.invoices.push(pi.id);
    const item = await this.prisma.productionInvoiceItem.create({
      data: {
        productionInvoiceId: pi.id,
        mfgProductId: this.mfgProductId,
        quantity: 1,
        workshopId,
      },
    });
    this.ids.items.push(item.id);
    const order = await this.prisma.productionOrder.create({
      data: {
        poNumber: this.code(`PO${tag}`),
        productionInvoiceItemId: item.id,
        mfgProductId: this.mfgProductId,
        bomRevisionId: this.bomRevisionId,
        quantity: 1,
        floorStage: ProductionOrderFloorStage.ACTIVE,
      },
    });
    this.ids.orders.push(order.id);
    return pi.id;
  }

  async segmentSpecId(materialId: bigint, cutLengthMm: number): Promise<bigint> {
    const existing = await this.prisma.segmentSpec.findFirst({
      where: { materialId, cutLengthMm },
    });
    if (existing) return existing.id;
    const spec = await this.prisma.segmentSpec.create({ data: { materialId, cutLengthMm } });
    this.ids.specs.push(spec.id);
    return spec.id;
  }

  /** Phương án cắt APPROVED neo PI: 1 line + các pattern / segment. Trả id phương án và pattern. */
  async makeProposal(
    piId: bigint,
    materialId: bigint,
    patterns: PatternSpec[],
    machine: SolverMachine,
    status: CuttingProposalStatus = CuttingProposalStatus.APPROVED,
  ) {
    const proposal = await this.prisma.cuttingProposal.create({
      data: { productionInvoiceId: piId, status },
    });
    this.ids.proposals.push(proposal.id);
    const line = await this.prisma.cuttingProposalLine.create({
      data: {
        cuttingProposalId: proposal.id,
        materialId,
        bestStockLengthMm: 6000,
        totalBars: patterns.reduce((s, p) => s + p.barCount, 0),
        machine,
      },
    });
    const patternIds: bigint[] = [];
    for (const [i, p] of patterns.entries()) {
      const segments = [];
      for (const s of p.segments) {
        segments.push({
          segmentSpecId: await this.segmentSpecId(materialId, s.cutLengthMm),
          countPerBar: s.countPerBar,
        });
      }
      const pat = await this.prisma.cuttingProposalPattern.create({
        data: {
          lineId: line.id,
          patternIndex: i + 1,
          barCount: p.barCount,
          segments: { create: segments },
        },
      });
      patternIds.push(pat.id);
    }
    return { proposalId: proposal.id, patternIds };
  }

  /** Giữ chỗ sắt cho PI ở 1 kho. */
  async reserve(piId: bigint, materialId: bigint, warehouseId: bigint, qty: number) {
    await this.prisma.stockReservation.create({
      data: {
        warehouseId,
        materialId,
        quantity: qty,
        refType: 'CUTTING_PROPOSAL',
        refId: `cutalloc-${this.sfx}`,
        productionInvoiceId: piId,
      },
    });
  }

  async issueSteel(piId: bigint, materialId: bigint, barCount: number) {
    await this.prisma.steelIssue.create({
      data: {
        productionInvoiceId: piId,
        materialId,
        barLengthMm: 6000,
        barCount,
        issuedById: this.userId,
      },
    });
  }

  async cleanup(): Promise<void> {
    const p = this.prisma;
    const { invoices, orders, proposals, machines, materials, warehouses, workshops } = this.ids;
    await p.floorReportLine.deleteMany({
      where: { floorReport: { workstationId: { in: machines } } },
    });
    await p.floorReport.deleteMany({ where: { workstationId: { in: machines } } });
    await p.cutAllocationLog.deleteMany({ where: { workshopId: { in: workshops } } });
    await p.cutAllocation.deleteMany({ where: { workshopId: { in: workshops } } });
    await p.steelIssue.deleteMany({ where: { productionInvoiceId: { in: invoices } } });
    await p.stockReservation.deleteMany({ where: { productionInvoiceId: { in: invoices } } });
    await p.cuttingProposalPatternSegment.deleteMany({
      where: { pattern: { line: { cuttingProposalId: { in: proposals } } } },
    });
    await p.cuttingProposalPattern.deleteMany({
      where: { line: { cuttingProposalId: { in: proposals } } },
    });
    await p.cuttingProposalLine.deleteMany({ where: { cuttingProposalId: { in: proposals } } });
    await p.cuttingProposal.deleteMany({ where: { id: { in: proposals } } });
    await p.segmentSpec.deleteMany({ where: { id: { in: this.ids.specs } } });
    await p.productionOrder.deleteMany({ where: { id: { in: orders } } });
    await p.productionInvoiceItem.deleteMany({ where: { id: { in: this.ids.items } } });
    await p.productionInvoice.deleteMany({ where: { id: { in: invoices } } });
    await p.workstation.deleteMany({ where: { id: { in: machines } } });
    await p.material.deleteMany({ where: { id: { in: materials } } });
    await p.warehouse.deleteMany({ where: { id: { in: warehouses } } });
    await p.workshop.deleteMany({ where: { id: { in: workshops } } });
    if (this.bomRevisionId) await p.bomRevision.deleteMany({ where: { id: this.bomRevisionId } });
    if (this.mfgProductId) await p.mfgProduct.deleteMany({ where: { id: this.mfgProductId } });
    if (this.groupCreated) await p.materialGroup.deleteMany({ where: { id: this.groupId } });
    if (this.userId) await p.user.deleteMany({ where: { id: this.userId } });
  }
}
