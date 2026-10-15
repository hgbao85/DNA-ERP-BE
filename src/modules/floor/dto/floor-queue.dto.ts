import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsIn, IsString } from 'class-validator';
import { FLOOR_WORKER_STAGES, FloorWorkerStage } from './floor-worker.dto';

export class EnqueuePiDto {
  @ApiProperty({ enum: FLOOR_WORKER_STAGES })
  @IsIn(FLOOR_WORKER_STAGES)
  stage!: FloorWorkerStage;

  @ApiProperty()
  @IsString()
  productionInvoiceId!: string;
}

/** Thứ tự MỚI của toàn bộ PI đang chờ (QUEUED) của 1 tổ - đủ và đúng tập id hiện có. */
export class ReorderQueueDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  entryIds!: string[];
}
