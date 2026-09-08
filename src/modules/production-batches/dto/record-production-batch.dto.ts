import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';

/** Body của POST /production-orders/:id/production-batches/record - "Lưu đợt" ChotPanel (VTTP,
 *  CHỈ mảnh không khai processSteps) - luôn stage PHOI nên không cần khai `stage` như
 *  CreateProductionBatchDto (dùng chung Hàn/Sơn). */
export class RecordProductionBatchDto {
  @ApiProperty()
  @IsString()
  pieceId!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  qty!: number;
}
