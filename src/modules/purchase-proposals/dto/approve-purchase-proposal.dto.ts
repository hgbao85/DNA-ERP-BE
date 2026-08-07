import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class ApprovePurchaseProposalDto {
  @ApiProperty({
    description: 'Map itemId -> quoteId đã chọn - bắt buộc đủ mọi item của đề xuất',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsObject()
  chosenQuoteIdByItemId!: Record<string, string>;
}
