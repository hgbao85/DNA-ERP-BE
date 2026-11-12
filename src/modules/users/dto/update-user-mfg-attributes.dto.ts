import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsEnum, IsNumberString, IsOptional, IsString } from 'class-validator';
import { MfgRole } from '../../../generated/prisma/client';

export class UpdateUserMfgAttributesDto {
  @ApiPropertyOptional({ enum: MfgRole })
  @IsOptional()
  @IsEnum(MfgRole)
  mfgRole?: MfgRole;

  @ApiPropertyOptional({ description: 'null = tổng kho (sees every warehouse)' })
  @IsOptional()
  @IsString()
  warehouseScope?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Đợt 7: các kho tài khoản được đổi qua lại (gồm cả kho đang làm). [] = chỉ 1 kho warehouseScope',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  warehouseScopes?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPurchaser?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isProductPlanner?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isSale?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMaterialsManager?: boolean;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Xưởng của QLSX (chỉ mfgRole PRODUCTION_MANAGER); null = bỏ gắn xưởng',
  })
  @IsOptional()
  @IsNumberString()
  workshopId?: string | null;
}
