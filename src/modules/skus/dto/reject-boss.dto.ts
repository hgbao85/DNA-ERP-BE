import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RejectBossDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}
