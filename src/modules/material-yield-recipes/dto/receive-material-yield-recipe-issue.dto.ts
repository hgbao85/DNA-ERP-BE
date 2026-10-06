import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Min } from 'class-validator';

export class ReceiveMaterialYieldRecipeIssueDto {
  /** Thiếu field này = nhận đủ như xuất (xem MaterialYieldRecipeIssuesService.receive()). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  receivedQty?: number;
}
