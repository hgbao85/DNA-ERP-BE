import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RejectPurchaseProposalDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  rejectionReason!: string;
}
