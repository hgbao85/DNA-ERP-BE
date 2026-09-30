import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, ArrayUnique, IsArray, IsString } from 'class-validator';
import { SolverOverrideDto } from '../../production-invoices/dto/solver-override.dto';

/**
 * KHSX bấm "Tính phương án cắt" ở màn "Tối ưu cắt sắt" (luồng "Solve trước → tạo PI", 2026-09-30):
 * chạy solver cho đúng tổ hợp SKU đang tick TRƯỚC khi có lệnh sản xuất nào. 1 SKU = cắt riêng, từ
 * 2 SKU = gộp đợt cắt chung. Thông số cắt (đặc cách %, cây riêng...) dùng CHUNG SolverOverrideDto
 * với 2 nút tạo lệnh sản xuất để luật kiểm không lệch nhau.
 */
export class RequestCuttingBatchDto extends SolverOverrideDto {
  @ApiProperty({ type: [String], description: 'ProductionInvoiceItem.id của các SKU chưa gom' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  productionInvoiceItemIds!: string[];
}
