import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, ArrayUnique, IsArray, IsString } from 'class-validator';
import { SolverOverrideDto } from './solver-override.dto';

/**
 * KHSX gộp nhiều SKU (đang chờ duyệt, có thể thuộc nhiều đơn hàng khác nhau) thành 1 lệnh sản
 * xuất để CẮT CHUNG một đợt - xem màn "Tối ưu cắt sắt".
 *
 * Tối thiểu 2 SKU: gộp 1 SKU không có nghĩa (nó vốn đã nằm trong PI riêng của nó và đi luồng
 * duyệt bình thường), và cũng không tiết kiệm được cây sắt nào vì lợi ích chỉ đến khi đoạn của
 * nhiều SKU nằm chung một cây.
 */
export class MergeProductionInvoiceDto extends SolverOverrideDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayUnique()
  @IsString({ each: true })
  productionInvoiceItemIds!: string[];
}
