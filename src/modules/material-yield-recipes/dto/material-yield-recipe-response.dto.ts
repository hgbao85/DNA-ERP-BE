import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { ProcessStep } from '../../../generated/prisma/client';
import { PROCESS_STEPS } from '../../../common/constants/process-steps.constant';

@Exclude()
export class MaterialYieldRecipeResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() outputMaterialId!: string;
  @Expose() @ApiProperty() outputMaterialCode!: string;
  @Expose() @ApiProperty() outputMaterialName!: string;
  @Expose() @ApiProperty() inputMaterialId!: string;
  @Expose() @ApiProperty() inputMaterialCode!: string;
  @Expose() @ApiProperty() inputMaterialName!: string;
  @Expose() @ApiProperty() piecesPerBar!: number;
  @Expose() @ApiProperty({ enum: PROCESS_STEPS, isArray: true }) processSteps!: ProcessStep[];
  @Expose() @ApiProperty() isActive!: boolean;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiProperty() updatedAt!: Date;

  constructor(partial: Partial<MaterialYieldRecipeResponseDto>) {
    Object.assign(this, partial);
  }
}
