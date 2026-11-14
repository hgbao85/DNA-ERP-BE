import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDivisibleBy,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { SolverMachine } from '../../../generated/prisma/client';
import {
  STEEL_SPEC_KEY_REGEX,
  normalizeSpecKey,
} from '../../cutting-proposals/steel-spec-key.util';

/**
 * `solverMaxSizesPerBarByWorkshop`: object thường, khoá = chuỗi không rỗng (mã xưởng), giá trị số
 * nguyên 1-10; {} hợp lệ.
 */
@ValidatorConstraint({ name: 'sizesPerBarByWorkshop', async: false })
export class SizesPerBarByWorkshopConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.entries(value).every(
      ([code, n]) =>
        code.trim() !== '' && typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 10,
    );
  }

  defaultMessage(): string {
    return 'solverMaxSizesPerBarByWorkshop phải là object { "<mã xưởng>": số nguyên 1-10 }, khoá không được rỗng';
  }
}

/**
 * `solverMachineByWorkshop`: object thường, khoá = chuỗi không rỗng (mã xưởng), giá trị 'laser' |
 * 'tu_dong'; {} hợp lệ.
 */
@ValidatorConstraint({ name: 'machineByWorkshop', async: false })
export class MachineByWorkshopConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.entries(value).every(
      ([code, m]) => code.trim() !== '' && (m === 'laser' || m === 'tu_dong'),
    );
  }

  defaultMessage(): string {
    return 'solverMachineByWorkshop phải là object { "<mã xưởng>": "laser" | "tu_dong" }, khoá không được rỗng';
  }
}

/**
 * `solverBundleFactorsBySpec`: object thường; khoá (sau khi viết hoa/bỏ khoảng trắng) là V<cạnh> |
 * H<a>-<b> | FI<đường kính>;
 * giá trị là mảng 1..12 số nguyên trong [2, 500], không trùng; {} hợp lệ.
 */
@ValidatorConstraint({ name: 'bundleFactorsBySpec', async: false })
export class BundleFactorsBySpecConstraint implements ValidatorConstraintInterface {
  private problem(value: unknown): string | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return 'solverBundleFactorsBySpec phải là object { "<mã quy cách>": [số cây/bó...] }';
    }
    const seen = new Set<string>();
    for (const [rawKey, arr] of Object.entries(value)) {
      const key = normalizeSpecKey(rawKey);
      if (!STEEL_SPEC_KEY_REGEX.test(key)) {
        return `Mã quy cách "${rawKey}" không hợp lệ (dạng V20, H13-26, FI19)`;
      }
      if (seen.has(key)) return `Mã quy cách "${key}" bị khai trùng`;
      seen.add(key);
      if (!Array.isArray(arr) || arr.length < 1 || arr.length > 12) {
        return `Quy cách ${key}: số cây/bó phải là mảng 1-12 số nguyên`;
      }
      if (!arr.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 2 && n <= 500)) {
        return `Quy cách ${key}: số cây/bó phải là số nguyên từ 2 đến 500`;
      }
      if (new Set(arr).size !== arr.length)
        return `Quy cách ${key}: số cây/bó không được trùng nhau`;
    }
    return null;
  }

  validate(value: unknown): boolean {
    return this.problem(value) === null;
  }

  defaultMessage(args?: { value?: unknown }): string {
    return this.problem(args?.value) ?? 'solverBundleFactorsBySpec không hợp lệ';
  }
}

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

  // Phần A – Đợt 2: tiền tố số LSX (vd MY, GP); rỗng = nhận mọi tiền tố.
  @ApiPropertyOptional({
    type: [String],
    example: ['MY', 'GP'],
    description: 'Tiền tố số LSX (1–6 chữ cái, vd MY, GP); rỗng = nhận mọi tiền tố.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^[A-Za-z]{1,6}$/, {
    each: true,
    message: 'Tiền tố số LSX chỉ gồm 1–6 chữ cái (vd MY, GP)',
  })
  lsxPrefixes?: string[];

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

  @ApiPropertyOptional({
    example: 4000,
    description:
      'Chiều dài cây NHỎ NHẤT bộ giải được dò (mm), mặc định 4000; phải ≤ solverMaxLengthMm. Dò từ cây chuẩn ra 2 phía, lấy chiều dài gần cây chuẩn nhất đạt ngưỡng.',
  })
  @IsOptional()
  @IsInt()
  @Min(100)
  solverMinLengthMm?: number;

  @ApiPropertyOptional({
    example: 6500,
    description:
      'Chiều dài cây LỚN NHẤT bộ giải được dò (mm), mặc định 6500; phải ≥ solverMinLengthMm.',
  })
  @IsOptional()
  @IsInt()
  @Min(100)
  solverMaxLengthMm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(50, { message: 'Bước dò chiều dài phải từ 50 mm trở lên và là bội 50 (cây tròn 5 cm)' })
  @IsDivisibleBy(50, { message: 'Bước dò chiều dài phải là bội 50 mm (cây tròn 5 cm)' })
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
    example: 10,
    description:
      'Tề đầu (mm) của MC Tự động - cặp riêng, tách khỏi solverTrimStartMm (MC Laser). 0-100, mặc định 10. ' +
      'Từ 13/11/2026 tề đầu KHÔNG tính vào hao hụt (chỉ cùi - khúc thừa cuối cây - mới tính).',
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
    example: 100,
    description:
      'Luật máy laze (13/11/2026): nhát cắt cuối phải ra 1 đoạn DÀI HƠN số mm này (tính cả phần cùi hao hụt); chỉ áp cho kiểu cắt từng cây. 0 = tắt. 0-1000.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  solverLaserMinTailMm?: number;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { PHUOC_AN: 2 },
    description:
      'Luật xưởng "tối đa N cỡ đoạn trên 1 cây": khoá = mã xưởng (Workshop.code), giá trị số nguyên 1-10. Bộ giải thử N cỡ trước, không đạt ' +
      'ngưỡng hao hụt mới nới N+1, N+2... tới giới hạn của máy. {} = bỏ hết luật; xưởng không có khoá = không có luật riêng. Không gửi field = giữ nguyên.',
  })
  @IsOptional()
  @Validate(SizesPerBarByWorkshopConstraint)
  solverMaxSizesPerBarByWorkshop?: Record<string, number>;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string', enum: ['laser', 'tu_dong'] },
    example: { PHUOC_AN: 'tu_dong' },
    description:
      'Máy cắt BẮT BUỘC theo xưởng: khoá = mã xưởng (Workshop.code), giá trị laser | tu_dong. Xưởng có khoá thì mọi lượt tính của xưởng đó ' +
      'dùng máy này, đè lựa chọn của KHSX. {} = không khoá xưởng nào. Không gửi field = giữ nguyên.',
  })
  @IsOptional()
  @Validate(MachineByWorkshopConstraint)
  solverMachineByWorkshop?: Record<string, 'laser' | 'tu_dong'>;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'number' } },
    example: { V10: [60, 64, 68], 'H10-20': [20, 24] },
    description:
      'Số cây/bó cho phép của MC Tự động THEO QUY CÁCH: khoá = V<cạnh> | H<a>-<b> (a ≤ b) | FI<đường kính> (viết hoa), giá trị = mảng 1-12 ' +
      'số nguyên 2-500. Quy cách không có trong bảng thì không cắt MC Tự động (tính từng cây theo thông số MC Laser). {} = dùng hệ số bó chung ' +
      'cho mọi quy cách. Không gửi field = giữ nguyên.',
  })
  @IsOptional()
  @Validate(BundleFactorsBySpecConstraint)
  solverBundleFactorsBySpec?: Record<string, number[]>;

  @ApiPropertyOptional({
    example: 5,
    description:
      'Luật gộp: mốc cần sắt (hạn Mua VT khung & đan, không có thì hạn khung) của các SKU trong 1 đợt tính / 1 lệnh gộp nằm trong khung ' +
      'chừng này ngày TÍNH CẢ NGÀY ĐẦU (mặc định 5 = ngày 10 gộp được ngày 14, không gộp với ngày 15) - chặn khi tính phương án, gộp lệnh ' +
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

  @ApiPropertyOptional({
    example: 68,
    description:
      'Phần A – Đợt 1 (YC9): thể tích 1 cont (m³) dùng tính load cont của SKU. 1-200, tối đa 2 số lẻ. ' +
      'Đổi giá trị thì load cont lưu sẵn trên mọi SKU có thùng/load cont nhập tay được tính lại.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(200)
  containerVolumeM3?: number;

  // ─── Phần A – Đợt 3 (YC10): năng lực sản xuất ───────────────────────────────────

  @ApiPropertyOptional({
    example: 1.3,
    description:
      'Phần A – Đợt 3 (YC10): năng lực cont/ngày của xưởng Phú An và của mỗi kho đóng gói (mặc định 1,3). ' +
      '0,1-20, tối đa 2 số lẻ.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.1)
  @Max(20)
  capacityContPerDay?: number;

  @ApiPropertyOptional({
    example: 4,
    description:
      'Phần A – Đợt 3 (YC10): số ngày làm 1 cont ở Phôi và Hàn của xưởng Phước An (mặc định 4). Số nguyên 1-60.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  daysPerContPhuocAn?: number;

  // ─── Phần A – Đợt 4 (YC6): màn Vật tư cần về ────────────────────────────────────

  @ApiPropertyOptional({
    example: 4,
    description:
      'Phần A – Đợt 4 (YC6): số ngày vật tư được về sớm nhất trước hạn chót (mặc định 4; 0 = chỉ ngày hạn chót). Số nguyên 0-30.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  materialEarliestArrivalDays?: number;
}
