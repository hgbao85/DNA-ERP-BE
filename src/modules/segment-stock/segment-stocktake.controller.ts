import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNumber, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { PermissionAction, WarehouseKind } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import {
  SegmentStocktakeResult,
  SegmentStocktakeService,
  segmentStocktakeKinds,
} from './segment-stocktake.service';
import { RequireAssignedWarehouse } from '../../common/decorators/require-assigned-warehouse.decorator';

export class SegmentStocktakeDto {
  @ApiProperty() @IsString() @Matches(/^\d+$/) warehouseId!: string;
  @ApiProperty() @IsString() @Matches(/^\d+$/) segmentSpecId!: string;
  /** Bộ công đoạn ('' = trơn). */
  @ApiProperty() @IsString() @MaxLength(100) segmentSteps!: string;
  // TĐ10 (rà soát 14/11): đoạn đếm theo cái - số lẻ (2,5) làm ô tồn ra lẻ, phía trừ báo thiếu 0,5.
  @ApiProperty() @IsInt() @Min(0) countedQty!: number;
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

  /** Loại kho được kiểm kê đoạn lúc này - FE hiện tab "Tồn đoạn" cho thủ kho Hàn khi có HAN (bật giao nhận giữa tổ). */
  @Get('stocktake-config')
  @RequirePermissions({ module: PERMISSION_MODULES.STOCK, action: PermissionAction.VIEW })
  @ApiOperation({
    summary: 'Loại kho được kiểm kê đoạn (PHOI; thêm HAN khi bật giao nhận giữa tổ)',
  })
  stocktakeConfig(): { kinds: WarehouseKind[] } {
    return { kinds: segmentStocktakeKinds() };
  }

  @Post('stocktake')
  @RequireAssignedWarehouse()
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
