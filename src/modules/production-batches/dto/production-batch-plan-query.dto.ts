import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { MfgStage } from '../../../generated/prisma/client';

/** Service validate lại chỉ nhận HAN/SON (assertConsumableStage, dùng chung với create()) -
 *  IsEnum(MfgStage) ở đây chỉ chặn giá trị rác ngoài 4 thành viên enum. */
export class ProductionBatchPlanQueryDto {
  @ApiProperty({ enum: MfgStage, enumName: 'MfgStage' })
  @IsEnum(MfgStage)
  stage!: MfgStage;
}
