import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsPositive, IsString } from 'class-validator';
import { MfgStage } from '../../../generated/prisma/client';

export class CreateMaterialIssueDto {
  /** Service validate lại chỉ nhận HAN/SON (assertConsumableStage) - IsEnum(MfgStage) ở đây
   *  chỉ chặn giá trị rác ngoài 4 thành viên enum, không tự thu hẹp được xuống 2 giá trị. */
  @ApiProperty({ enum: MfgStage, enumName: 'MfgStage' })
  @IsEnum(MfgStage)
  stage!: MfgStage;

  @ApiProperty()
  @IsString()
  materialId!: string;

  @ApiProperty()
  @IsNumber()
  @IsPositive()
  issuedQty!: number;
}
