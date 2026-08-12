import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class CreateMaterialInspectionRequestDto {
  @ApiProperty({
    description: 'PlanForm.id (Sku.id ở FE) - phải là bản ghi origin=PRODUCTION_CONFIRM',
  })
  @IsString()
  @MinLength(1)
  planFormId!: string;
}
