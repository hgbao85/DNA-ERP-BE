import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, ArrayUnique, IsArray, IsNotEmpty, IsString } from 'class-validator';

/**
 * KHSX gộp nhiều SKU (chưa gom, có thể thuộc nhiều đơn hàng khác nhau) thành 1 lệnh sản xuất để
 * CẮT CHUNG một đợt - xem màn "Tối ưu cắt sắt".
 *
 * Luồng "Solve trước → tạo PI" (2026-09-30): lệnh sản xuất chỉ được tạo từ 1 phương án cắt đã tính
 * xong (POST /cutting-batch-solve) cho ĐÚNG tập SKU này - `cuttingProposalId`. Thông số cắt (đặc cách
 * %, cây riêng, thời gian) KHÔNG còn nhận ở đây nữa: chúng đã được dùng lúc tính và lấy từ chính
 * lượt tính đó, gửi lại khác đi là gửi số không khớp với kết quả sắp duyệt.
 *
 * Tối thiểu 2 SKU: gộp 1 SKU không có nghĩa (dùng claim-solo), và không tiết kiệm được cây sắt nào
 * vì lợi ích chỉ đến khi đoạn của nhiều SKU nằm chung một cây.
 */
export class MergeProductionInvoiceDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayUnique()
  @IsString({ each: true })
  productionInvoiceItemIds!: string[];

  @ApiProperty({ description: 'CuttingProposal.id của lượt tính đã chạy cho đúng các SKU trên' })
  @IsString()
  @IsNotEmpty()
  cuttingProposalId!: string;
}
