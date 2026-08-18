import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsOptional, IsString } from 'class-validator';
import { SendToBossDto } from './send-to-boss.dto';

/**
 * Body chung cho 2 route gửi CẢ PHIẾU (send-to-qlsx-batch / send-to-boss-batch).
 *
 * `itemIds` BỎ TRỐNG = gửi mọi SKU đủ điều kiện của phiếu (ca thường, đúng ý "gửi 1 lần nguyên 1
 * PI"). Có giá trị = người dùng bỏ tick vài SKU trên UI (vd SKU chưa khai xong mốc thời hạn) - chỉ
 * THU HẸP tập gửi, KHÔNG nới điều kiện trạng thái (SKU đã gửi rồi vẫn bị bỏ qua dù có trong danh
 * sách). Xem ProductionInvoicesService.sendBatchToQlsx/sendBatchToBoss.
 */
export class SendBatchDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  itemIds?: string[];
}

/** send-to-boss-batch: kèm kho thành phẩm dùng CHUNG cho mọi SKU trong lần gửi này. */
export class SendBatchToBossDto extends SendToBossDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  itemIds?: string[];
}
