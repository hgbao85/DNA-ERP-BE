import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { MfgRole, PhoiOperation } from '../../../generated/prisma/client';

export class UpdateUserMfgAttributesDto {
  @ApiPropertyOptional({ enum: MfgRole })
  @IsOptional()
  @IsEnum(MfgRole)
  mfgRole?: MfgRole;

  @ApiPropertyOptional({ enum: PhoiOperation, description: 'Only meaningful when mfgRole=PHOI' })
  @IsOptional()
  @IsEnum(PhoiOperation)
  phoiOperation?: PhoiOperation;

  @ApiPropertyOptional({ description: 'null = tổng kho (sees every warehouse)' })
  @IsOptional()
  @IsString()
  warehouseScope?: string;

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
}
