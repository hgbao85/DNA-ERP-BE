import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { MaterialDetailKind, SteelSubGroup } from '../../../generated/prisma/client';

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
    enum: SteelSubGroup,
    description:
      'Nhóm con của Sắt (SOFTWARE/SELF_CALC/FINISHED_COMPONENT) - bắt buộc khi materialGroupId thuộc nhóm systemKey STEEL_BAR, bị bỏ qua (ghi null) với mọi nhóm khác. Xem MaterialsService.resolveSteelSubGroup.',
  })
  @IsOptional()
  steelSubGroup?: SteelSubGroup;

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

  // 2 field dưới đây CỐ Ý phá lệ "không validate" của file này (xem docstring class) - chúng
  // nuôi thẳng xuống solver cắt sắt ngoài (CuttingProposalsService.runSolverAndSave), giá trị
  // rác (vd chuỗi "2,5") lọt xuống Prisma Decimal sẽ vỡ thành 500 khó hiểu thay vì 400 rõ ràng.
  // Chỉ 1 trong 2 field có tác dụng thật tuỳ nhóm vật tư - xem MaterialsService.resolveWasteFields.
  @ApiPropertyOptional({
    description:
      'ĐÃ BỎ (2026-09-30): Sắt không còn ngưỡng hao hụt riêng theo vật tư - KHSX quyết ngưỡng chung ở "Tối ưu cắt sắt". Giá trị gửi lên bị bỏ qua, giữ field chỉ để không vỡ client cũ.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  maxCuttingWastePercentage?: number;

  @ApiPropertyOptional({
    description:
      '% dự trù cộng thêm vào số lượng đề xuất mua. Đã nối vào cả 3 luồng tự sinh đề xuất mua cho vật tư KHÔNG phải Sắt phần mềm. Bị bỏ qua (ghi null) với vật tư Sắt nhóm con SOFTWARE (Phần mềm) - vẫn áp dụng bình thường cho Tự tính/VTTP và mọi nhóm khác, xem MaterialsService.resolveWasteFields.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  purchaseWastePercentage?: number;

  @ApiPropertyOptional({
    description:
      'Tri-state - ép CÁCH làm tròn buyQty khi tính đề xuất mua. null/để trống = mỗi luồng tự theo mặc định gốc (vật tư tiêu hao giữ thập phân, Sắt tự tính luôn ceil nguyên cây/tấm). true = ép ceil lên nguyên (vd Đinh/Vis/Nút - không mua được số lẻ). false = ép GIỮ thập phân (vd Tấm sắt la - mua theo tấm lẻ).',
  })
  @IsOptional()
  @IsBoolean()
  purchaseRoundUp?: boolean | null;
}
