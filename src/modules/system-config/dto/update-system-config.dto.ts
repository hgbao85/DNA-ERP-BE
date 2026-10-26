import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SolverMachine } from '../../../generated/prisma/client';

export class UpdateSystemConfigDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  companyName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  companyAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  companyPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  companyEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taxCode?: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: 'https://erpdna.vercel.app',
    description:
      'Địa chỉ ERP in lên tem QR của máy xưởng (chuẩn hoá về scheme://host[:port]; rỗng/null = dùng địa chỉ trình duyệt đang mở). ' +
      'Theo từng môi trường - xem doc comment SystemConfig.floorPublicUrl.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  floorPublicUrl?: string | null;

  @ApiPropertyOptional({
    type: [String],
    example: ['203.0.113.5', '198.51.100.0/24'],
    description:
      'Mạng công ty được phép đăng nhập: IP công cộng (IPv4/IPv6 cụ thể hoặc IPv4 CIDR /8-/32). RỖNG = không giới hạn. Áp cho tài khoản công nhân ' +
      '(role FLOOR_WORKER) và tài khoản tổ Phôi/Hàn/Sơn; Sếp/QLSX/KCS/Admin không bị giới hạn. Không gửi field = giữ nguyên.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  floorAllowedIps?: string[];

  @ApiPropertyOptional({ minLength: 3, maxLength: 3, example: 'VND' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  defaultCurrency?: string;

  @ApiPropertyOptional({
    type: [Number],
    example: [6000],
    description:
      'Các chiều dài thanh sắt nguyên chuẩn (mm) dùng cho Đề xuất cắt sắt. CHỈ điền chiều ' +
      'dài NCC thực sự có sẵn hàng - xem doc comment SystemConfig.solverStockLengths.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(100, { each: true })
  @Type(() => Number)
  solverStockLengths?: number[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  solverTrimStartMm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  solverBladeWidthMm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  solverMaxWastePercentage?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  solverMaxSurplus?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(100)
  solverMinLengthMm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(100)
  solverMaxLengthMm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  solverLengthStepMm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  solverTimeLimitSeconds?: number;

  @ApiPropertyOptional({
    description:
      'Mặc định toàn hệ thống: có cho solver đặt cây sắt NGOÀI các chiều dài chuẩn hay không ' +
      '(auto_scan). Từng đợt cắt đè lại được - KHSX đề nghị ở màn "Tối ưu cắt sắt", Sếp duyệt ' +
      'cùng lệnh sản xuất.',
  })
  @IsOptional()
  @IsBoolean()
  solverAllowCustomLength?: boolean;

  @ApiPropertyOptional({
    enum: SolverMachine,
    example: SolverMachine.laser,
    description:
      'Máy cắt MẶC ĐỊNH toàn hệ thống: laser = MC Laser (cắt từng cây), tu_dong = MC Tự động (cắt theo bó). ' +
      'Từng đợt đè lại được - KHSX chọn ở "Tối ưu cắt sắt", Sếp duyệt cùng lệnh sản xuất.',
  })
  @IsOptional()
  @IsEnum(SolverMachine)
  solverMachine?: SolverMachine;

  @ApiPropertyOptional({
    example: 2.5,
    description:
      'Lưỡi cắt (mm) của MC Tự động - cặp riêng, tách khỏi solverBladeWidthMm (MC Laser). 0-10, tối đa 1 chữ số thập phân (cột DB Decimal(6,1)).',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(10)
  solverMctdBladeWidthMm?: number;

  @ApiPropertyOptional({
    example: 0,
    description:
      'Tề đầu (mm) của MC Tự động - cặp riêng, tách khỏi solverTrimStartMm (MC Laser). 0-100.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  solverMctdTrimStartMm?: number;

  @ApiPropertyOptional({
    type: [Number],
    example: [14, 16, 18, 20],
    description:
      'Các hệ số bó (số cây/bó) của MC Tự động: 1-8 số nguyên khác nhau, mỗi số 2-100. Chỉ dùng khi máy = tu_dong.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(2, { each: true })
  @Max(100, { each: true })
  @Type(() => Number)
  solverBundleFactors?: number[];

  @ApiPropertyOptional({
    example: 5,
    description:
      'Tổng số cây cắt tay (hệ số 1) tối đa trong 1 loại sắt khi dùng MC Tự động. 0-100.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  solverMaxManualCuts?: number;

  @ApiPropertyOptional({
    example: 5,
    description:
      'Số cỡ đoạn tối đa trên 1 kiểu cắt khi dùng MC Tự động (máy MCTĐ nhập được 5). 1-10.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  solverMaxSizesPerPattern?: number;

  @ApiPropertyOptional({
    example: 3,
    description:
      'Luật gộp: mốc cần sắt (hạn mua hàng, không có thì hạn khung) của các SKU trong 1 đợt tính / 1 lệnh gộp nằm trong khung ' +
      'chừng này ngày TÍNH CẢ NGÀY ĐẦU (3 = ngày 1 gộp được ngày 3, không gộp với ngày 4) - chặn khi tính phương án, gộp lệnh ' +
      'và lưu hạn lệnh gộp. 1 = chỉ gộp SKU cùng ngày. 1-365.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  solverMergeWindowDays?: number;

  @ApiPropertyOptional({
    example: 2,
    description:
      'Luật gộp: số SKU tối đa trong 1 đợt tính / 1 lệnh gộp (mặc định 2 - Sếp Nhân). 1-50.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  solverMergeMaxSkus?: number;

  @ApiPropertyOptional({
    example: 0,
    description:
      'Dung sai giao THỪA khi Thủ kho nhận hàng mua về, tính theo % của số lượng đặt mua ' +
      '(buyQty). Trong dung sai thì ghi nhận đúng số thực nhận kể cả khi vượt buyQty; vượt ' +
      'dung sai thì chặn và báo lỗi. 0 = không cho nhận thừa dòng nào.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  purchaseOverReceiptTolerancePercent?: number;
}
