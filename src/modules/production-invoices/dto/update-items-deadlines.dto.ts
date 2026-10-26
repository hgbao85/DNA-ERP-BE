import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsOptional, IsString, ValidateNested } from 'class-validator';
import { UpdateProductionInvoiceItemDto } from './update-production-invoice-item.dto';

/** Mốc kế hoạch của 1 SKU trong lần lưu "Sửa thời hạn" cả PI - cùng trường với PATCH :id/items/:itemId. */
export class ItemDeadlinesInputDto extends UpdateProductionInvoiceItemDto {
  @ApiProperty()
  @IsString()
  itemId!: string;
}

/**
 * "Sửa thời hạn" cả PI trong MỘT giao dịch (2026-10-24). Trước đây FE gửi 1 PATCH cho PI + 1 PATCH cho TỪNG SKU chạy song song: với
 * luật gộp (mốc cần sắt các SKU của lệnh gộp cách nhau ≤ N ngày, merge-rules.util) mà kiểm từng lần thì dời CẢ NHÓM cùng lúc bị chặn
 * oan ở SKU đầu tiên và có thể lưu dở dang. Lưu hết rồi mới kiểm, vi phạm thì không lưu gì.
 */
export class UpdateItemsDeadlinesDto {
  @ApiPropertyOptional({
    description: 'Hạn của cả PI (ISO) - FE gửi hạn giao sớm nhất của các SKU.',
  })
  @IsOptional()
  @IsDateString()
  deadline?: string;

  @ApiProperty({ type: [ItemDeadlinesInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemDeadlinesInputDto)
  items!: ItemDeadlinesInputDto[];
}
