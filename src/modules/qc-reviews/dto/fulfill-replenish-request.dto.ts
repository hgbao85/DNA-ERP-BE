import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class FulfillReplenishRequestDto {
  /** Id đợt SteelIssue kho vừa tạo (qua POST /production-orders/:id/steel-issues) để cấp bù. */
  @ApiProperty()
  @IsString()
  steelIssueId!: string;
}
