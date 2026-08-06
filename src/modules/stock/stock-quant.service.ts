import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { ListStockQuantQueryDto } from './dto/list-stock-quant-query.dto';
import { StockQuantResponseDto } from './dto/stock-quant-response.dto';

type StockQuantWithRefs = Prisma.StockQuantGetPayload<{
  include: {
    warehouse: true;
    material: true;
    segmentSpec: { include: { material: true } };
    piece: true;
    productVariant: true;
  };
}>;

/**
 * Cache số dư tồn kho, materialize từ StockLedger bằng trigger DB (fn_sync_stock_quant, xem
 * prisma/migrations/20260805120000_add_stock_ledger_core/migration.sql) - chỉ đọc, app không
 * bao giờ ghi bảng này trực tiếp. Dùng bởi bước "KHSX kiểm tra vật tư" (đọc nhanh, không phải
 * SUM() toàn bộ lịch sử stock_ledger mỗi lần hỏi).
 */
@Injectable()
export class StockQuantService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async findAll(query: ListStockQuantQueryDto): Promise<StockQuantResponseDto[]> {
    const where: Prisma.StockQuantWhereInput = {
      warehouseId: query.warehouseId ? parseBigIntId(query.warehouseId) : undefined,
      materialId: query.materialId ? parseBigIntId(query.materialId) : undefined,
      segmentSpecId: query.segmentSpecId ? parseBigIntId(query.segmentSpecId) : undefined,
      pieceId: query.pieceId ? parseBigIntId(query.pieceId) : undefined,
      productVariantId: query.productVariantId ? parseBigIntId(query.productVariantId) : undefined,
    };

    const rows = await this.prisma.stockQuant.findMany({
      where,
      include: {
        warehouse: true,
        material: true,
        segmentSpec: { include: { material: true } },
        piece: true,
        productVariant: true,
      },
      orderBy: { id: 'asc' },
    });

    return rows.map((r) => this.toResponseDto(r));
  }

  private toResponseDto(row: StockQuantWithRefs): StockQuantResponseDto {
    return new StockQuantResponseDto({
      id: row.id.toString(),
      warehouseId: row.warehouseId.toString(),
      warehouseCode: row.warehouse.code,
      materialId: row.materialId?.toString() ?? null,
      materialCode: row.material?.code ?? null,
      segmentSpecId: row.segmentSpecId?.toString() ?? null,
      segmentSpecLabel: row.segmentSpec
        ? `${row.segmentSpec.material.code} @ ${row.segmentSpec.cutLengthMm}mm`
        : null,
      pieceId: row.pieceId?.toString() ?? null,
      pieceCode: row.piece?.code ?? null,
      productVariantId: row.productVariantId?.toString() ?? null,
      productVariantLabel: row.productVariant?.description ?? row.productVariant?.colorCode ?? null,
      qty: row.qty.toNumber(),
      updatedAt: row.updatedAt,
    });
  }
}
