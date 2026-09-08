import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString } from 'class-validator';
import { ProcessStep } from '../../../generated/prisma/client';

/** Body của POST /production-invoices/:id/step-bundles (2026-09-07, đổi scope lần 2) - Phôi gom
 *  mọi StepBatch CHƯA gửi của (productionInvoiceId, materialId, step) thành 1 đợt gửi KCS. Không
 *  cần segments - service tự gom từ StepBatch đã báo trước đó qua recordStepBatch(). */
export class SubmitStepBundleDto {
  @ApiProperty()
  @IsString()
  materialId!: string;

  @ApiProperty({ enum: ProcessStep })
  @IsEnum(ProcessStep)
  step!: ProcessStep;
}
