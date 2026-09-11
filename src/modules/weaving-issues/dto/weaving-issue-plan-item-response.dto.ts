import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { WeavingAllocationItemResponseDto } from './weaving-allocation-item-response.dto';
import { WeavingPieceMaterialLineResponseDto } from './weaving-piece-material-line-response.dto';

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
  /** Định mức Dây (WIRE) /1 mảnh - đúng nhóm vật tư dùng làm điều kiện "mảnh có đan"
   *  (xem SkusService.isPieceWoven). Hiển thị tham khảo cho người xuất đan biết mang kèm
   *  loại/lượng dây nào - KHÔNG nhân theo số lượng đang xuất, không trừ kho (WeavingIssue
   *  không ghi StockLedger, xem comment đầu WeavingIssuesService). */
  @Expose()
  @ApiProperty({ type: [WeavingPieceMaterialLineResponseDto] })
  wire!: WeavingPieceMaterialLineResponseDto[];
  /** Định mức Đinh (NAIL) /1 mảnh - cùng ghi chú như `wire` ở trên. */
  @Expose()
  @ApiProperty({ type: [WeavingPieceMaterialLineResponseDto] })
  nail!: WeavingPieceMaterialLineResponseDto[];

  constructor(partial: Partial<WeavingIssuePlanItemResponseDto>) {
    Object.assign(this, partial);
  }
}
