import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import type { ContainerLoadSource } from '../utils/container-load.util';

/**
 * Phần A – Đợt 1 (YC9): khối "thùng & load cont" của 1 SKU (MfgProduct), dùng chung cho response SKU, dòng đơn hàng
 * (SalesOrderItem) và dòng lệnh SX (ProductionInvoiceItem). Các số loadContFormula / loadCont / boxVolumeM3 được LƯU SẴN trên
 * MfgProduct lúc ghi kích thước (và tính lại khi Admin đổi thể tích cont) - mapper chỉ đọc cột, không đọc SystemConfig.
 * HỢP ĐỒNG với FE `src/types/containerLoad.ts` - đổi 2 bên cùng lúc.
 */
@Exclude()
export class ContainerLoadDto {
  @Expose() @ApiPropertyOptional({ nullable: true }) boxLengthCm!: number | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) boxWidthCm!: number | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) boxHeightCm!: number | null;
  /** Số thùng của 1 bộ, mặc định 1. */
  @Expose() @ApiProperty() boxesPerSet!: number;
  /** Load cont nhập tay - có thì thắng công thức. */
  @Expose() @ApiPropertyOptional({ nullable: true }) loadContManual!: number | null;
  /** Thể tích 1 thùng (m³, 4 số lẻ). null khi thiếu kích thước. */
  @Expose() @ApiPropertyOptional({ nullable: true }) boxVolumeM3!: number | null;
  /** ⌊thể tích cont ÷ (thể tích thùng × số thùng/bộ)⌋. null khi thiếu kích thước. */
  @Expose() @ApiPropertyOptional({ nullable: true }) loadContFormula!: number | null;
  /** Load cont hiệu lực = nhập tay ?? công thức. null = SKU chưa có load cont. */
  @Expose() @ApiPropertyOptional({ nullable: true }) loadCont!: number | null;
  @Expose()
  @ApiPropertyOptional({ nullable: true, enum: ['MANUAL', 'FORMULA'] })
  source!: ContainerLoadSource | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) updatedAt!: Date | null;
}

/** Các cột MfgProduct mà mapper cần (thêm vào mọi `select` của mfgProduct khi muốn trả containerLoad). */
export const CONTAINER_LOAD_SELECT = {
  boxLengthCm: true,
  boxWidthCm: true,
  boxHeightCm: true,
  boxesPerSet: true,
  loadContManual: true,
  boxVolumeM3: true,
  loadContFormula: true,
  loadCont: true,
  containerLoadUpdatedAt: true,
} as const;

type DecimalLike = { toNumber(): number } | number | null;
const num = (v: DecimalLike | undefined): number | null =>
  v === null || v === undefined ? null : typeof v === 'number' ? v : v.toNumber();

export interface ContainerLoadColumns {
  boxLengthCm: DecimalLike;
  boxWidthCm: DecimalLike;
  boxHeightCm: DecimalLike;
  boxesPerSet: number;
  loadContManual: number | null;
  boxVolumeM3: DecimalLike;
  loadContFormula: number | null;
  loadCont: number | null;
  containerLoadUpdatedAt: Date | null;
}

export function toContainerLoadDto(p: ContainerLoadColumns): ContainerLoadDto {
  const dto = new ContainerLoadDto();
  dto.boxLengthCm = num(p.boxLengthCm);
  dto.boxWidthCm = num(p.boxWidthCm);
  dto.boxHeightCm = num(p.boxHeightCm);
  dto.boxesPerSet = p.boxesPerSet;
  dto.loadContManual = p.loadContManual;
  dto.boxVolumeM3 = num(p.boxVolumeM3);
  dto.loadContFormula = p.loadContFormula;
  dto.loadCont = p.loadCont;
  dto.source = p.loadContManual !== null ? 'MANUAL' : p.loadContFormula !== null ? 'FORMULA' : null;
  dto.updatedAt = p.containerLoadUpdatedAt;
  return dto;
}
