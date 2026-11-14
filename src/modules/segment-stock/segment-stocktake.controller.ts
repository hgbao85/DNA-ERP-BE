import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumber, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { SegmentStocktakeResult, SegmentStocktakeService } from './segment-stocktake.service';

export class SegmentStocktakeDto {
  @ApiProperty() @IsString() @Matches(/^\d+$/) warehouseId!: string;
  @ApiProperty() @IsString() @Matches(/^\d+$/) segmentSpecId!: string;
  /** Bộ công đoạn ('' = trơn). */
  @ApiProperty() @IsString() @MaxLength(100) segmentSteps!: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) countedQty!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 4 }) expectedCurrentQty!: number;
  @ApiProperty({ description: 'Ghi chú kiểm kê (bắt buộc)' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3, { message: 'Ghi chú kiểm kê (ít nhất 3 ký tự)' })
  @MaxLength(500)
  note!: string;
}

/** Kiểm kê đoạn kho Phôi theo mã đoạn (13/11/2026). */
@ApiTags('Segment Stock')
@ApiBearerAuth()
@Controller({ path: 'segment-stock', version: '1' })
export class SegmentStocktakeController {
  constructor(private readonly service: SegmentStocktakeService) {}

  @Post('stocktake')
  @HttpCode(200)
  @RequirePermissions({ module: PERMISSION_MODULES.STOCK, action: PermissionAction.UPDATE })
  @ApiOperation({ summary: 'Kiểm kê 1 mã đoạn: nhập số đếm, ghi phần chênh (ADJUST)' })
  stocktake(
    @Body() dto: SegmentStocktakeDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('warehouseScope') warehouseScope: string | null,
  ): Promise<SegmentStocktakeResult> {
    return this.service.stocktake({
      warehouseId: parseBigIntId(dto.warehouseId),
      segmentSpecId: parseBigIntId(dto.segmentSpecId),
      segmentSteps: dto.segmentSteps,
      countedQty: dto.countedQty,
      expectedCurrentQty: dto.expectedCurrentQty,
      note: dto.note,
      actorId: userId,
      warehouseScope,
    });
  }
}
