import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive, IsString } from 'class-validator';

/** Không có field `stage` (khác CreateMaterialIssueDto) - luôn PHÔI. */
export class CreateMaterialYieldIssueDto {
  @ApiProperty()
  @IsString()
  materialId!: string;

  @ApiProperty()
  @IsNumber()
  @IsPositive()
  issuedQty!: number;
}
