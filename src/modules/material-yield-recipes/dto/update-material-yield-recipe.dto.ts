import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateMaterialYieldRecipeDto } from './create-material-yield-recipe.dto';

export class UpdateMaterialYieldRecipeDto extends PartialType(CreateMaterialYieldRecipeDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
