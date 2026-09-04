import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Min } from 'class-validator';

export class ReceiveMaterialYieldIssueDto {
  /** Thiếu field này = nhận đủ như xuất (xem MaterialYieldIssuesService.receive()). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  receivedQty?: number;
}
