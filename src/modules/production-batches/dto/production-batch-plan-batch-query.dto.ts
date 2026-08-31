import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { MfgStage } from '../../../generated/prisma/client';

/**
 * Riêng DTO này thay vì tái dùng ProductionBatchPlanQueryDto + @Query('ids') rời - global
 * ValidationPipe có forbidNonWhitelisted:true (main.ts), 2 decorator @Query() cùng đọc chung
 * req.query nên field `ids` "lạ" (không khai trong DTO gốc, chỉ có `stage`) bị chặn 400 ngay cả
 * khi có @Query('ids') riêng đọc đúng giá trị - đã gặp thật qua browser 2026-08-31. Khai `ids`
 * NGAY TRONG DTO để ValidationPipe coi là field hợp lệ.
 */
export class ProductionBatchPlanBatchQueryDto {
  @ApiProperty({ description: 'ProductionOrder id, phân tách bởi dấu phẩy' })
  @IsString()
  @IsNotEmpty()
  ids!: string;

  @ApiProperty({ enum: MfgStage, enumName: 'MfgStage' })
  @IsEnum(MfgStage)
  stage!: MfgStage;
}
