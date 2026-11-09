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
  /** Số mảnh đang nằm trên phiếu xuất đan chờ ký (chưa trừ). */
  @Expose() @ApiProperty() onDraftQty!: number;
  /** Trần thật để lập phiếu xuất đan (09/11/2026): min(định mức còn lại, mảnh đã qua KCS công đoạn cuối còn ở kho giữ mảnh) - đã
   *  trừ phần trên phiếu chờ ký. Cùng công thức chặn ở WeavingIssuesService.assertPieceCapInTx(). */
  @Expose() @ApiProperty() canIssueQty!: number;
  /** Kho đang giữ mảnh (nơi xuất đan) - thường kho Sơn. null = xưởng chưa có kho tương ứng. */
  @Expose() @ApiProperty({ nullable: true, type: String }) sourceWarehouseCode!: string | null;
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
  /** Định mức Vật tư thành phẩm (Sắt, nhóm con FINISHED_COMPONENT, vd chân nhôm) /1 mảnh - CHỈ gồm
   *  dòng đã tick `includeInWeaving`, cùng điều kiện/ý nghĩa như `plasticButton` ở trên (vai trò
   *  giống hệt Nút nhựa, khác ở chỗ bản thân vật tư này được sản xuất qua MaterialYieldRecipe thay
   *  vì mua thẳng - 2026-10-01). */
  @Expose()
  @ApiProperty({ type: [WeavingPieceMaterialLineResponseDto] })
  finishedComponent!: WeavingPieceMaterialLineResponseDto[];

  constructor(partial: Partial<WeavingIssuePlanItemResponseDto>) {
    Object.assign(this, partial);
  }
}
