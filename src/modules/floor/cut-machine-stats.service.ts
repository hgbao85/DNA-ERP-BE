import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  CuttingProposalStatus,
  FloorReportKind,
  WorkstationKind,
} from '../../generated/prisma/client';
import { spanDays, vnDayKey, vnDayStart } from '../../common/utils/floor-stats.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import {
  WorkshopScope,
  WorkshopScopeService,
} from '../../common/workshop-scope/workshop-scope.service';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import {
  barLengthKey,
  computeCutMachineStats,
  DEFAULT_BAR_LENGTH_MM,
  LUNCH_FROM,
  LUNCH_TO,
  MAX_GAP_MINUTES,
  MAX_SPAN_DAYS,
  MIN_RATE_MINUTES,
  type StatsMachine,
  type StatsReport,
} from './cut-machine-stats.util';
import { CutMachineStatsQueryDto } from './dto/cut-machine-stats.dto';

const DAY_MS = 24 * 3600 * 1000;
const DEFAULT_RANGE_DAYS = 14;

/** Tên xưởng đã có chữ "Xưởng" thì không thêm lần nữa. */
function workshopLabel(name: string): string {
  const n = name.trim();
  return /^xưởng\s/i.test(n) ? n : `Xưởng ${n}`;
}

function materialLabel(m: { name: string; spec: string | null }): string {
  const spec = m.spec?.trim();
  return spec ? `${m.name} · ${spec}` : m.name;
}

type MachineRow = {
  id: bigint;
  code: string;
  name: string;
  cutMachineType: string | null;
  isActive: boolean;
};

type ReportRow = {
  workstationId: bigint | null;
  createdAt: Date;
  productionInvoiceId: bigint | null;
  lines: Array<{
    qty: number;
    segmentSpec: {
      materialId: bigint;
      cutLengthMm: unknown;
      material: { name: string; spec: string | null };
    } | null;
  }>;
};

function toStatsMachines(rows: MachineRow[]): StatsMachine[] {
  return rows.map((m) => ({
    id: m.id.toString(),
    code: m.code,
    name: m.name,
    machineType: m.cutMachineType === 'tu_dong' ? 'tu_dong' : 'laser',
    isActive: m.isActive,
  }));
}

function toStatsReports(rows: ReportRow[]): StatsReport[] {
  const reports: StatsReport[] = [];
  for (const r of rows) {
    if (r.workstationId == null) continue;
    const lines = r.lines.flatMap((l) =>
      l.segmentSpec
        ? [
            {
              materialId: l.segmentSpec.materialId.toString(),
              label: materialLabel(l.segmentSpec.material),
              cutLengthMm: Number(l.segmentSpec.cutLengthMm),
              qty: l.qty,
            },
          ]
        : [],
    );
    reports.push({
      machineId: r.workstationId.toString(),
      createdAt: r.createdAt,
      productionInvoiceId: r.productionInvoiceId?.toString() ?? null,
      lines,
    });
  }
  return reports;
}

/**
 * Đo năng suất máy cắt từ giờ công nhân báo qua mã QR (floor_reports kind CUT). CHỈ ĐỌC.
 * Cách tính: cut-machine-stats.util. Tối đa 4 truy vấn dữ liệu (system_config, máy,
 * lần báo kèm dòng, phương án) + phạm vi xưởng (user, xưởng).
 */
@Injectable()
export class CutMachineStatsService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly workshopScope: WorkshopScopeService,
  ) {}

  private scopeError(scope: WorkshopScope): ForbiddenException {
    return new ForbiddenException(
      scope.workshopName
        ? `Bạn chỉ xem năng suất máy cắt của ${workshopLabel(scope.workshopName)}`
        : 'Bạn chỉ xem năng suất máy cắt của xưởng mình phụ trách',
    );
  }

  private async loadWorkshop(id: bigint) {
    const ws = await this.prisma.workshop.findUnique({
      where: { id },
      select: { id: true, code: true, name: true, isActive: true },
    });
    if (!ws || !ws.isActive) {
      throw new BadRequestException('Xưởng không tồn tại hoặc đã ngừng hoạt động');
    }
    return { id: ws.id, code: ws.code, name: ws.name };
  }

  /** Như bảng chia máy: người có xưởng chỉ xem xưởng mình; người không gắn xưởng phải chọn. */
  private async resolveWorkshop(userId: string, requested?: string) {
    const scope = await this.workshopScope.getScope(userId);
    const asked = requested ? parseBigIntId(requested) : null;
    if (scope.workshopId != null) {
      if (asked != null && asked !== scope.workshopId) throw this.scopeError(scope);
      return this.loadWorkshop(scope.workshopId);
    }
    if (asked == null) throw new BadRequestException('Chọn xưởng để xem năng suất máy cắt');
    return this.loadWorkshop(asked);
  }

  private resolveRange(q: CutMachineStatsQueryDto) {
    const to = q.to ?? vnDayKey(new Date());
    const endDay = vnDayStart(to);
    if (!endDay) throw new BadRequestException('Ngày không hợp lệ - dùng dạng YYYY-MM-DD');
    const from = q.from ?? vnDayKey(new Date(endDay.getTime() - (DEFAULT_RANGE_DAYS - 1) * DAY_MS));
    const start = vnDayStart(from);
    if (!start) throw new BadRequestException('Ngày không hợp lệ - dùng dạng YYYY-MM-DD');
    if (start.getTime() > endDay.getTime()) {
      throw new BadRequestException('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc');
    }
    if (spanDays(from, to) > MAX_SPAN_DAYS) {
      throw new BadRequestException(`Xem tối đa ${MAX_SPAN_DAYS} ngày - chọn khoảng ngắn hơn`);
    }
    return { from, to, gte: start, lt: new Date(endDay.getTime() + DAY_MS) };
  }

  private async loadParams() {
    const config = await this.prisma.systemConfig.findUnique({
      where: { id: 1 },
      select: {
        solverStockLengths: true,
        solverBladeWidthMm: true,
        solverTrimStartMm: true,
        solverMctdBladeWidthMm: true,
        solverMctdTrimStartMm: true,
      },
    });
    const firstLen = Array.isArray(config?.solverStockLengths)
      ? Number(config.solverStockLengths[0])
      : NaN;
    return {
      defaultBarLengthMm: firstLen > 0 ? firstLen : DEFAULT_BAR_LENGTH_MM,
      blade: {
        laser: Number(config?.solverBladeWidthMm ?? 1),
        tu_dong: Number(config?.solverMctdBladeWidthMm ?? 2.5),
      },
      trim: {
        laser: Number(config?.solverTrimStartMm ?? 10),
        tu_dong: Number(config?.solverMctdTrimStartMm ?? 10),
      },
    };
  }

  /** Cả máy đã ngừng (có thể còn số cũ); máy chưa gắn xưởng không tính. */
  private loadMachineRows(workshopId: bigint) {
    return this.prisma.workstation.findMany({
      where: { workshopId, kind: WorkstationKind.CUT },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, cutMachineType: true, isActive: true },
    });
  }

  private loadReportRows(machineIds: bigint[], range: { gte: Date; lt: Date }) {
    return this.prisma.floorReport.findMany({
      where: {
        kind: FloorReportKind.CUT,
        workstationId: { in: machineIds },
        createdAt: { gte: range.gte, lt: range.lt },
        // Bỏ dòng Hoàn tác và cả lần báo đã bị Hoàn tác.
        reversalOfId: null,
        reversedBy: null,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        workstationId: true,
        createdAt: true,
        productionInvoiceId: true,
        lines: {
          select: {
            qty: true,
            segmentSpec: {
              select: {
                materialId: true,
                cutLengthMm: true,
                material: { select: { name: true, spec: true } },
              },
            },
          },
        },
      },
    });
  }

  async getStats(userId: string, q: CutMachineStatsQueryDto) {
    const workshop = await this.resolveWorkshop(userId, q.workshopId);
    const range = this.resolveRange(q);
    const [params, machineRows] = await Promise.all([
      this.loadParams(),
      this.loadMachineRows(workshop.id),
    ]);
    const machines = toStatsMachines(machineRows);
    const reportRows =
      machineRows.length === 0
        ? []
        : await this.loadReportRows(
            machineRows.map((m) => m.id),
            range,
          );
    const barLengths = await this.loadBarLengths(reportRows.map((r) => r.productionInvoiceId));
    const result = computeCutMachineStats({
      machines,
      reports: toStatsReports(reportRows),
      blade: params.blade,
      trim: params.trim,
      defaultBarLengthMm: params.defaultBarLengthMm,
      barLengths,
    });
    return {
      workshop: { id: workshop.id.toString(), code: workshop.code, name: workshop.name },
      range: { from: range.from, to: range.to, timezone: 'Asia/Ho_Chi_Minh' as const },
      method: {
        lunchBreak: { from: LUNCH_FROM, to: LUNCH_TO },
        maxGapMinutes: MAX_GAP_MINUTES,
        minRateMinutes: MIN_RATE_MINUTES,
        defaultBarLengthMm: params.defaultBarLengthMm,
        blade: params.blade,
        trim: params.trim,
      },
      machines: machines.map((m) => ({ ...m })),
      ...result,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Chiều dài cây theo phương án APPROVED đầu tiên của (PI, loại sắt); neo PI hoặc PO. */
  private async loadBarLengths(piIds: Array<bigint | null>): Promise<Map<string, number>> {
    const ids = [...new Set(piIds.filter((x): x is bigint => x != null))];
    const out = new Map<string, number>();
    if (ids.length === 0) return out;
    const proposals = await this.prisma.cuttingProposal.findMany({
      where: {
        status: CuttingProposalStatus.APPROVED,
        OR: [
          { productionInvoiceId: { in: ids } },
          { productionOrder: { productionInvoiceItem: { productionInvoiceId: { in: ids } } } },
        ],
      },
      orderBy: { id: 'asc' },
      select: {
        productionInvoiceId: true,
        productionOrder: {
          select: { productionInvoiceItem: { select: { productionInvoiceId: true } } },
        },
        lines: {
          where: { bestStockLengthMm: { not: null } },
          orderBy: { id: 'asc' },
          select: { materialId: true, bestStockLengthMm: true },
        },
      },
    });
    for (const p of proposals) {
      const piId =
        p.productionInvoiceId ?? p.productionOrder?.productionInvoiceItem.productionInvoiceId;
      if (piId == null) continue;
      for (const l of p.lines) {
        if (l.bestStockLengthMm == null || !(l.bestStockLengthMm > 0)) continue;
        const key = barLengthKey(piId.toString(), l.materialId.toString());
        if (!out.has(key)) out.set(key, l.bestStockLengthMm);
      }
    }
    return out;
  }
}
