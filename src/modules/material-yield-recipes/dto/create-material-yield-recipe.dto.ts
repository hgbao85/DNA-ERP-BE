import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ProcessStep } from '../../../generated/prisma/client';
import { PROCESS_STEPS } from '../../../common/constants/process-steps.constant';

/** Body của POST /material-yield-recipes - Admin khai "1 outputMaterial được gia công từ N đơn vị
 *  inputMaterial" (vd chân nhôm <- thanh nhôm) - KHÔNG gắn piece/SKU nào, xem doc comment model
 *  MaterialYieldRecipe (schema.prisma). outputMaterial PHẢI thuộc nhóm Sắt + nhóm con
 *  FINISHED_COMPONENT (validate ở MaterialYieldRecipesService.create()). */
export class CreateMaterialYieldRecipeDto {
  @ApiProperty({ description: 'Material.id của vật tư RA (vd chân nhôm)' })
  @IsString()
  outputMaterialId!: string;

  @ApiProperty({ description: 'Material.id của vật tư VÀO (vd thanh nhôm)' })
  @IsString()
  inputMaterialId!: string;

  @ApiProperty({
    description: 'Số vật tư ra cắt được từ 1 đơn vị vật tư vào (vd 1 thanh = 12 chân)',
  })
  @IsInt()
  @Min(1)
  piecesPerBar!: number;

  @ApiPropertyOptional({ enum: PROCESS_STEPS, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(ProcessStep, { each: true })
  processSteps?: ProcessStep[];
}
