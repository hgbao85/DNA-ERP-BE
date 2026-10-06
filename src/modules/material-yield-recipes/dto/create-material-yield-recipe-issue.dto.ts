import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive, IsString } from 'class-validator';

/** Body của POST /production-invoices/:id/material-yield-recipe-issues - thủ kho xuất inputMaterial
 *  (vd thanh nhôm) cho Phôi theo đúng recipe. Không có field `materialId` riêng (khác
 *  CreateMaterialYieldIssueDto) - recipeId đã xác định đúng 1 inputMaterial cố định. */
export class CreateMaterialYieldRecipeIssueDto {
  @ApiProperty()
  @IsString()
  recipeId!: string;

  @ApiProperty()
  @IsNumber()
  @IsPositive()
  issuedQty!: number;
}
