import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Min } from 'class-validator';

export class ReceiveMaterialIssueDto {
  /** Thiếu field này = nhận đủ như xuất (xem MaterialIssuesService.receive()). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  receivedQty?: number;
}
