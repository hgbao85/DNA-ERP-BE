import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { FLOOR_WORKER_STAGES, FloorWorkerStage } from './floor-worker.dto';

/** Id dạng chuỗi số (BigInt) - DTO chỉ kiểm dạng, service kiểm tồn tại. */
const ID_PATTERN = /^\d+$/;
const ID_MESSAGE = 'Mã (id) không hợp lệ';

/**
 * GET /floor/queue?stage=&workshopId= - xưởng: QLSX gắn xưởng luôn là xưởng mình; người khác không
 * truyền = mọi xưởng.
 */
export class QueueListQueryDto {
  @ApiPropertyOptional({ enum: FLOOR_WORKER_STAGES })
  @IsOptional()
  @IsIn(FLOOR_WORKER_STAGES)
  stage?: FloorWorkerStage;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(ID_PATTERN, { message: ID_MESSAGE })
  workshopId?: string;
}

/** GET /floor/queue/candidates?stage=&workshopId= */
export class QueueCandidatesQueryDto {
  @ApiProperty({ enum: FLOOR_WORKER_STAGES })
  @IsIn(FLOOR_WORKER_STAGES)
  stage!: FloorWorkerStage;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(ID_PATTERN, { message: ID_MESSAGE })
  workshopId?: string;
}

/**
 * Body của advance / reopen: người không gắn xưởng BẮT BUỘC chọn xưởng (service báo 400 "Chọn
 * xưởng").
 */
export class QueueWorkshopDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(ID_PATTERN, { message: ID_MESSAGE })
  workshopId?: string;
}

export class EnqueuePiDto {
  @ApiProperty({ enum: FLOOR_WORKER_STAGES })
  @IsIn(FLOOR_WORKER_STAGES)
  stage!: FloorWorkerStage;

  @ApiProperty()
  @IsString()
  productionInvoiceId!: string;
}

/** Thứ tự MỚI của toàn bộ PI đang chờ (QUEUED) của 1 (tổ, xưởng) - đủ và đúng tập id hiện có. */
export class ReorderQueueDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  entryIds!: string[];

  /** Không bắt buộc: xưởng lấy từ các dòng; truyền thì phải khớp. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(ID_PATTERN, { message: ID_MESSAGE })
  workshopId?: string;
}
