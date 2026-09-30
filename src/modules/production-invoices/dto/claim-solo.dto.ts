import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * "Tiến hành cắt riêng" (màn "Tối ưu cắt sắt", ProductionInvoicesService.claimSolo()) - tạo lệnh
 * sản xuất cho đúng 1 SKU từ phương án cắt đã tính cho SKU đó (luồng "Solve trước → tạo PI",
 * 2026-09-30). Thông số cắt lấy từ chính lượt tính, không nhận lại ở đây - xem
 * MergeProductionInvoiceDto.
 */
export class ClaimSoloDto {
  @ApiProperty({ description: 'CuttingProposal.id của lượt tính đã chạy cho đúng SKU này' })
  @IsString()
  @IsNotEmpty()
  cuttingProposalId!: string;
}
