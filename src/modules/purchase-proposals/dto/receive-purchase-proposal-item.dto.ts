import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class ReceivePurchaseProposalItemDto {
  @ApiProperty({
    description:
      'Ô1 "Số lượng/1 đơn vị tính" - vật tư không chênh lệch đơn vị: chính là số lượng nhận thực tế (theo material.unit). Vật tư có chênh lệch (vd bì zip): tỷ lệ quy đổi riêng của LÔ này (vd 130 = 130 cái/kg), đọc trên phiếu nhập kho giấy - nhập tay mỗi lần, không có hệ số cố định nào tra sẵn.',
  })
  @IsNumber()
  @Min(0.0001)
  unitRateQty!: number;

  @ApiPropertyOptional({
    description:
      'Ô2 "Số lượng đơn vị tính bên bán" (vd 50kg) - mặc định 1 khi vật tư không chênh lệch đơn vị. receivedQty cộng vào tồn kho = unitRateQty * supplierUnitQty, backend tự tính.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  supplierUnitQty?: number;

  @ApiPropertyOptional({
    description:
      'Ảnh/scan phiếu nhập kho giấy của đúng lần nhận này (Cloudinary secure_url, POST /uploads/image).',
  })
  @IsOptional()
  @IsString()
  receiptFileUrl?: string;
}
