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
  /** min(remainingToIssue, số mảnh THỰC TẾ đã nhận về kho vật tư-TP qua Phân phối nội bộ - đúng
   *  SKU/PO/PI này - trừ đã xuất) - 2026-09-12. Cap THẬT dùng để chặn ở create() (khác
   *  remainingToIssue chỉ là kế hoạch định mức, không phản ánh kho đã có hàng thật hay chưa). Xem
   *  WeavingIssuesService.sumReceivedForPiece. */
  @Expose() @ApiProperty() canIssueQty!: number;
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
  /** Định mức Nút nhựa (PLASTIC_BUTTON) /1 mảnh - CHỈ gồm dòng đã tick `includeInWeaving` ở
   *  SpecSteelPage.tsx ("đi kèm mảnh khi xuất đan"), khác Dây/Đinh ở trên (luôn tự động đi kèm,
   *  không có điều kiện). Xem PieceMaterialItem.includeInWeaving. */
  @Expose()
  @ApiProperty({ type: [WeavingPieceMaterialLineResponseDto] })
  plasticButton!: WeavingPieceMaterialLineResponseDto[];

  constructor(partial: Partial<WeavingIssuePlanItemResponseDto>) {
    Object.assign(this, partial);
  }
}
