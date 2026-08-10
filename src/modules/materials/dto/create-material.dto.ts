import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { MaterialDetailKind } from '../../../generated/prisma/client';

/**
 * Không validate gì thật ở đây (theo yêu cầu) - `@IsOptional()` KHÔNG kiểm tra kiểu/độ dài/
 * bắt buộc, chỉ đăng ký field với class-validator để ValidationPipe toàn cục (main.ts,
 * whitelist: true + forbidNonWhitelisted: true - áp dụng chung cho MỌI DTO trong app, không
 * được sửa riêng ở đây) không strip/reject field "lạ". Thiếu decorator hoàn toàn sẽ làm
 * ValidationPipe báo "property X should not exist" cho chính field đó dù request có gửi.
 *
 * Cột code/name/unit vẫn NOT NULL ở DB nên thiếu hẳn field (không phải chuỗi rỗng) vẫn sẽ
 * lỗi ở tầng Prisma/DB - không có cách nào né được nếu không đổi schema.
 */
export class CreateMaterialDto {
  @ApiPropertyOptional({
    description:
      "vd 'SAT-25' - để trống sẽ tự sinh dạng PREFIX-NNN theo nhóm vật tư (materialGroupId), xem MaterialsService.generateMaterialCode",
  })
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ description: 'vd "Sắt Hộp 6 zem" - spec ghép giữ nguyên dạng text' })
  @IsOptional()
  name!: string;

  @ApiPropertyOptional({ description: 'cm, cây, kg, cuộn, bar, l, bottle...' })
  @IsOptional()
  unit!: string;

  @ApiPropertyOptional({
    description: 'vd "10x29x0.8" - quy cách vật tư, hiện ở cột "Quy cách" của định mức mảnh',
  })
  @IsOptional()
  spec?: string;

  @ApiPropertyOptional({
    description:
      'Cách phân loại vật tư duy nhất - group.systemKey (6 nhóm hệ thống, xem material-group-system-keys.constant.ts) quyết định vật tư có hiện trong picker của 4 trang Spec hay không',
  })
  @IsOptional()
  materialGroupId?: string;

  @ApiPropertyOptional({
    enum: MaterialDetailKind,
    description:
      'Bắt buộc khi materialGroupId thuộc nhóm systemKey OTHER ("Vật tư khác") - phân biệt Sơn/Phụ kiện/Bao bì cho picker của trang Định mức chi tiết (SpecDetailQuotaPage), vì cả 3 tab đó giờ dùng chung 1 nhóm vật tư. Bị bỏ qua (ghi null) với mọi nhóm khác - xem MaterialsService.resolveDetailKind.',
  })
  @IsOptional()
  detailKind?: MaterialDetailKind;

  @ApiPropertyOptional({
    description:
      'Đơn vị mua hàng từ NCC khi khác với unit (đơn vị tồn kho/sản xuất), vd "kg" khi unit = "cái". Để trống nếu vật tư chỉ có 1 đơn vị.',
  })
  @IsOptional()
  purchaseUnit?: string;

  @ApiPropertyOptional({
    description:
      'Hệ số quy đổi: số lượng unit tương ứng với 1 purchaseUnit, vd 250 = 250 cái/kg. Chỉ có ý nghĩa khi purchaseUnit khác trống.',
  })
  @IsOptional()
  khoUnitFactor?: number;

  @ApiPropertyOptional({ description: 'Kho vật tư này sẽ nằm khi được tạo' })
  @IsOptional()
  warehouseId?: string;

  @ApiPropertyOptional({
    description:
      'Tồn kho ban đầu (số lượng theo unit) - chỉ áp dụng lúc TẠO MỚI và khi đã chọn warehouseId, ghi 1 bút toán OPENING_BALANCE vào StockLedger. Bị bỏ qua khi sửa vật tư (UpdateMaterialDto.update() không đọc field này).',
  })
  @IsOptional()
  openingQty?: number;

  @ApiPropertyOptional({
    description: 'User.id (uuid) của nhân viên mua hàng phụ trách vật tư này',
  })
  @IsOptional()
  buyerId?: string;

  @ApiPropertyOptional({
    description: 'URL ảnh vật tư (Cloudinary secure_url) - xem POST /uploads/image',
  })
  @IsOptional()
  imageUrl?: string;
}
