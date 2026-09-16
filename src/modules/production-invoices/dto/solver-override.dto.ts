import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  IsStockLengthsByMaterial,
  type StockLengthsByMaterial,
} from '../../../common/validators/stock-lengths-by-material.validator';

/**
 * Thông số cắt KHSX ĐỀ NGHỊ cho riêng một đợt, dùng chung cho cả 2 đường tạo lệnh sản xuất ở màn
 * "Tối ưu cắt sắt" (gộp nhiều SKU / cắt riêng 1 SKU) - xem MergeProductionInvoiceDto, ClaimSoloDto.
 * Sếp chấp thuận bằng chính nút Duyệt lệnh sản xuất, không có cổng duyệt riêng.
 *
 * Để chung một lớp vì luật kiểm PHẢI giống hệt nhau ở cả 2 đường: lệch nhau thì cùng một đề nghị
 * lọt qua đường này mà bị chặn ở đường kia, tuỳ KHSX bấm nút nào.
 */
export class SolverOverrideDto {
  @ApiPropertyOptional({
    example: 5,
    description:
      'Ngưỡng hao hụt ĐẶC CÁCH (%) xin riêng cho đợt này - dùng khi cây chuẩn không đạt ngưỡng ' +
      'thường mà đơn lại gấp (cây đặt riêng phải chờ NCC cán). Chỉ NÂNG, không hạ ngưỡng của loại ' +
      'sắt nào. Bỏ trống = chạy ngưỡng thường.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(100)
  solverMaxWastePctOverride?: number;

  @ApiPropertyOptional({
    description:
      'Cho solver đặt cây sắt NGOÀI các chiều dài chuẩn hay không. Bỏ trống = theo mặc định công ' +
      'ty (SystemConfig.solverAllowCustomLength). Đơn gấp thường để false: cây riêng chờ NCC cán ' +
      'lâu hơn mua cây chuẩn có sẵn.',
  })
  @IsOptional()
  @IsBoolean()
  solverAllowCustomLength?: boolean;

  @ApiPropertyOptional({
    example: 'PO-4 giao gấp, không kịp chờ NCC cán cây riêng',
    description:
      'Lý do xin đặc cách, Sếp đọc lúc duyệt. BẮT BUỘC khi có solverMaxWastePctOverride - duyệt ' +
      'một con số mà không biết vì sao là duyệt khống.',
  })
  @ValidateIf((o: SolverOverrideDto) => o.solverMaxWastePctOverride != null)
  // Cắt khoảng trắng TRƯỚC khi kiểm: không có dòng này thì lý do "   " dài 3 ký tự nên lọt
  // @MinLength(1), và Sếp nhận được một đề nghị nới ngưỡng có ô lý do rỗng trơn. FE đã tự trim
  // nhưng luật phải nằm ở BE - đường API gọi thẳng không đi qua FE.
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  solverOverrideReason?: string;

  @ApiPropertyOptional({
    example: { '5': 5850 },
    description:
      'Chiều dài cây sắt (mm) chọn cho RIÊNG đợt này, theo TỪNG QUY CÁCH: khoá là Material.id, ' +
      'giá trị là chiều dài cây. Bỏ trống (hoặc thiếu khoá) = loại sắt đó dùng chiều dài chuẩn ' +
      'của công ty (SystemConfig.solverStockLengths, hiện 6000mm). Theo QUY CÁCH trong đợt, ' +
      'không theo SKU - nên 2 SKU gộp chung 1 loại sắt không thể chọn lệch nhau.',
  })
  @IsOptional()
  @IsStockLengthsByMaterial()
  solverStockLengthsByMaterial?: StockLengthsByMaterial;
}
