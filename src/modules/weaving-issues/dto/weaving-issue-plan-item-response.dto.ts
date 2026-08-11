import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { WeavingAllocationItemResponseDto } from './weaving-allocation-item-response.dto';

/** "Cần xuất đan bao nhiêu" theo mảnh - mirror SteelIssuePlanItemResponseDto, thay ManhLine. */
@Exclude()
export class WeavingIssuePlanItemResponseDto {
  @Expose() @ApiProperty() pieceId!: string;
  @Expose() @ApiProperty() pieceCode!: string;
  @Expose() @ApiProperty() pieceName!: string;
  /** BomPiece.qtyPerUnit × ProductionOrder.quantity - cùng công thức TransferCheckPieceResponseDto.totalQty. */
  @Expose() @ApiProperty() totalQty!: number;
  /** Σ WeavingIssue.qty mọi điểm đan cho mảnh này. */
  @Expose() @ApiProperty() issuedQty!: number;
  /** totalQty - issuedQty. Cap dùng bởi WeavingIssuesService.create(). */
  @Expose() @ApiProperty() remainingToIssue!: number;
  @Expose()
  @ApiProperty({ type: [WeavingAllocationItemResponseDto] })
  allocations!: WeavingAllocationItemResponseDto[];

  constructor(partial: Partial<WeavingIssuePlanItemResponseDto>) {
    Object.assign(this, partial);
  }
}
