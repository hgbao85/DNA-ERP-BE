import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ListSegmentOveragesQueryDto {
  /** open (mặc định) = chưa đóng; resolved = đã đóng; all = tất cả. */
  @ApiPropertyOptional({ enum: ['open', 'resolved', 'all'] })
  @IsOptional()
  @IsIn(['open', 'resolved', 'all'])
  status?: 'open' | 'resolved' | 'all';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  productionInvoiceId?: string;
}

export class ResolveSegmentOverageDto {
  @ApiProperty({ description: 'Lý do đóng dòng (bắt buộc)' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3, { message: 'Ghi lý do đóng dòng (ít nhất 3 ký tự)' })
  @MaxLength(500)
  reason!: string;
}

/** 1 dòng sổ báo vượt tồn đoạn (13/11/2026). */
@Exclude()
export class SegmentOverageResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() productionInvoiceId!: string;
  /** Số LSX (lệnh chưa có LSX thì mã PI). */
  @Expose() @ApiProperty() lenhCode!: string;
  @Expose() @ApiProperty() productionOrderId!: string;
  @Expose() @ApiProperty() productionBatchId!: string;
  @Expose() @ApiProperty() pieceCode!: string;
  @Expose() @ApiProperty() pieceName!: string;
  @Expose() @ApiProperty() stage!: string;
  @Expose() @ApiProperty() warehouseName!: string;
  /** "SAT-005 @ 460mm · Dập". */
  @Expose() @ApiProperty() segmentLabel!: string;
  @Expose() @ApiProperty() neededQty!: number;
  @Expose() @ApiProperty() takenQty!: number;
  /** Thiếu đoạn - không trừ được (tồn không âm). */
  @Expose() @ApiProperty() shortageQty!: number;
  /** Số mảnh đợt này làm vượt số lượng tổng của lệnh. */
  @Expose() @ApiProperty() overPieces!: number;
  /** Số đoạn lấy thêm ứng với overPieces. */
  @Expose() @ApiProperty() extraQty!: number;
  @Expose() @ApiPropertyOptional({ nullable: true, enum: ['OVER_REPORT', 'REWORK'] }) extraKind!:
    string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) reportedByName!: string | null;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiPropertyOptional({ nullable: true }) resolvedAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) resolvedByName!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) resolveReason!: string | null;

  constructor(partial: Partial<SegmentOverageResponseDto>) {
    Object.assign(this, partial);
  }
}
