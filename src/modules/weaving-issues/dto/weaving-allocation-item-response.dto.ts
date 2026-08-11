import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

/** 1 dòng/điểm đan trong WeavingIssuePlanItemResponseDto.allocations - mirror ManhAllocation. */
@Exclude()
export class WeavingAllocationItemResponseDto {
  @Expose() @ApiProperty() weavingPointId!: string;
  @Expose() @ApiProperty() weavingPointCode!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) weavingPointName!: string | null;
  @Expose() @ApiProperty() issuedQty!: number;
  @Expose() @ApiProperty() receivedQty!: number;
  /** issuedQty - receivedQty, cap dùng bởi WeavingIssuesService.receive(). */
  @Expose() @ApiProperty() remainingToReceive!: number;

  constructor(partial: Partial<WeavingAllocationItemResponseDto>) {
    Object.assign(this, partial);
  }
}
