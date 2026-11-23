import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { FLOOR_WORKER_STAGES, FloorWorkerStage } from './floor-worker.dto';

/**
 * GET /floor/stage-progress?stage=&workshopId= - xưởng: QLSX gắn xưởng luôn là xưởng mình (truyền xưởng khác -> 403); người
 * khác không truyền = mọi xưởng.
 */
export class StageProgressQueryDto {
  @ApiProperty({ enum: FLOOR_WORKER_STAGES })
  @IsIn(FLOOR_WORKER_STAGES)
  stage!: FloorWorkerStage;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'Mã (id) không hợp lệ' })
  workshopId?: string;

  /** Id lệnh ngăn dấu phẩy (tối đa 200). Có thì chỉ trả đúng các lệnh đó (vẫn qua quyền + lọc xưởng), không áp cửa sổ 7 ngày. */
  @ApiPropertyOptional({ description: 'Danh sách id lệnh, ngăn dấu phẩy, tối đa 200' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+(,\d+){0,199}$/, {
    message: 'productionInvoiceIds phải là các id số ngăn dấu phẩy, tối đa 200 lệnh',
  })
  productionInvoiceIds?: string;
}
