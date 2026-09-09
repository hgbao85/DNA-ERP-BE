import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsString, Min } from 'class-validator';
import { MfgStage } from '../../../generated/prisma/client';

/** Body của POST /production-orders/:id/production-batches/record - "Lưu đợt" (Phôi/Hàn/Sơn,
 *  2026-09-09 mở rộng nhận cả 3 stage - trước đó CHỈ VTTP ChotPanel dùng PHOI). Mirror shape
 *  CreateProductionBatchDto. */
export class RecordProductionBatchDto {
  @ApiProperty({ enum: MfgStage, enumName: 'MfgStage' })
  @IsEnum(MfgStage)
  stage!: MfgStage;

  @ApiProperty()
  @IsString()
  pieceId!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  qty!: number;
}
