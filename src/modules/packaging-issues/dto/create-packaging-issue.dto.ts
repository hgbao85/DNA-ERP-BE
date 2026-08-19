import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreatePackagingIssueDto {
  @ApiProperty()
  @IsString()
  materialId!: string;

  @ApiProperty()
  @IsNumber()
  @IsPositive()
  issuedQty!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
