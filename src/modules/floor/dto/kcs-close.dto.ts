import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { ProcessStep } from '../../../generated/prisma/client';

/** Công đoạn phụ của nhóm công đoạn (mọi bước trừ CAT - đợt Cắt chốt theo từng đợt cắt, không theo nhóm). */
const STEP_GROUP_STEPS = Object.values(ProcessStep).filter((s) => s !== ProcessStep.CAT);

/**
 * KCS chốt để chấm (P1, 18/11/2026): body của 3 route close theo NHÓM. Hai route còn lại (đợt cắt, lô mảnh) chốt theo id
 * trên URL nên không có body. Hợp đồng v2 mục 3.
 */

/** POST /floor/kcs/step-groups/close - đúng phạm vi submitStepBundle() (PI + loại sắt + công đoạn + SKU + người). */
export class KcsCloseStepGroupDto {
  @ApiProperty()
  @IsString()
  productionInvoiceId!: string;

  @ApiProperty()
  @IsString()
  materialId!: string;

  @ApiProperty({ enum: STEP_GROUP_STEPS })
  @IsIn(STEP_GROUP_STEPS)
  step!: ProcessStep;

  /** null = dòng cũ chưa gắn SKU (PI 1 SKU gộp vào SKU duy nhất; PI nhiều SKU thì 409 "báo IT"). */
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  productionOrderId!: string | null;

  /** Công nhân của nhóm - mỗi công nhân 1 đợt riêng. null = dòng cũ chưa biết người. */
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  workerId!: string | null;
}

/** POST /floor/kcs/piece-step-groups/close - pat: gom theo (lệnh, mảnh, công đoạn). */
export class KcsClosePieceStepGroupDto {
  @ApiProperty()
  @IsString()
  productionOrderId!: string;

  @ApiProperty()
  @IsString()
  pieceId!: string;

  @ApiProperty({ enum: ProcessStep, enumName: 'ProcessStep' })
  @IsEnum(ProcessStep)
  step!: ProcessStep;
}

/** POST /floor/kcs/material-yield-groups/close - chân nhôm: gom theo (PI, công thức, công đoạn). */
export class KcsCloseMaterialYieldGroupDto {
  @ApiProperty()
  @IsString()
  productionInvoiceId!: string;

  @ApiProperty()
  @IsString()
  recipeId!: string;

  @ApiProperty({ enum: ProcessStep, enumName: 'ProcessStep' })
  @IsEnum(ProcessStep)
  step!: ProcessStep;
}
