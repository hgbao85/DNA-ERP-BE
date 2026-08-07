import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min } from 'class-validator';

export class ReceivePurchaseProposalItemDto {
  @ApiProperty()
  @IsNumber()
  @Min(1)
  receivedQty!: number;
}
