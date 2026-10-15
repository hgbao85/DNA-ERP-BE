import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { ProcessStep } from '../../../generated/prisma/client';
import { FLOOR_WORKER_STAGES, FloorWorkerStage } from './floor-worker.dto';

export class FloorReviewQueryDto {
  @ApiProperty({ enum: FLOOR_WORKER_STAGES })
  @IsIn(FLOOR_WORKER_STAGES)
  stage!: FloorWorkerStage;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  productionInvoiceId?: string;
}

export class FloorQueueQueryDto {
  @ApiPropertyOptional({ enum: FLOOR_WORKER_STAGES })
  @IsOptional()
  @IsIn(FLOOR_WORKER_STAGES)
  stage?: FloorWorkerStage;
}

/** Gửi KCS 1 nhóm công đoạn phụ - đúng phạm vi submitStepBundle() (PI + loại sắt + công đoạn + SKU). */
export class SendStepGroupDto {
  @ApiProperty()
  @IsString()
  productionInvoiceId!: string;

  @ApiProperty()
  @IsString()
  materialId!: string;

  @ApiProperty({ enum: ProcessStep, enumName: 'ProcessStep' })
  @IsEnum(ProcessStep)
  step!: ProcessStep;

  @ApiProperty()
  @IsString()
  productionOrderId!: string;

  /**
   * Công nhân của nhóm - mỗi công nhân 1 đợt riêng (mục 20.5/26): chỉ gom lần báo của người này. `null` = đợt cũ chưa biết
   * người. Bỏ trống = gom hết (như màn Phôi cũ).
   */
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  workerId?: string | null;
}

export class ScanContextQueryDto {
  @ApiPropertyOptional({ description: 'PI cũ của tổ để bù lỗi - mặc định PI đang chạy' })
  @IsOptional()
  @IsString()
  productionInvoiceId?: string;
}
