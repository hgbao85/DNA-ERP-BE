import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateWeavingPointDto } from './create-weaving-point.dto';

export class UpdateWeavingPointDto extends PartialType(CreateWeavingPointDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
