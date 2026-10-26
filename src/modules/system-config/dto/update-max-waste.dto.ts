import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { SolverMachine } from '../../../generated/prisma/client';

/**
 * KHSX tự đổi NGƯỠNG HAO HỤT MẶC ĐỊNH cho cắt sắt (`SystemConfig.solverMaxWastePercentage`) ngay ở
 * màn "Tối ưu cắt sắt" (2026-09-30) - không cần Admin. Chỉ áp cho loại sắt CHƯA có ngưỡng riêng
 * (`Material.maxCuttingWastePercentage`), và cho mọi lượt tính từ giờ (lượt đã tính giữ nguyên).
 *
 * Cận dưới 0,01: 0 gần như luôn vô nghiệm (bắt lấp đầy cây tới từng mm, xem
 * de_xuat_logic.py::generate_patterns). Cận trên 100 là giới hạn toán học của một tỷ lệ %.
 */
export class UpdateMaxWasteDto {
  @ApiProperty({ example: 1.5, description: 'Ngưỡng hao hụt mặc định mới (%), 0,01-100' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.01)
  @Max(100)
  solverMaxWastePercentage!: number;

  @ApiPropertyOptional({
    example: 'Đơn Goplus gấp, chấp nhận hao hơn để kịp giao',
    description: 'Lý do (tuỳ chọn) - đi kèm thông báo cho Sếp/QLSX.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(300)
  reason?: string;
}

/** Trả về sau khi đổi (và khi đọc): số hiện tại + số trước đó để FE hiện "1% → 1,5%". */
export class CuttingDefaultsResponseDto {
  @ApiProperty() solverMaxWastePercentage!: number;
  /// Máy cắt MẶC ĐỊNH của công ty (2026-10-23) - KHSX không có quyền đọc GET /system-config nên lấy ở đây
  /// để hiện "Theo mặc định (MC …)" ở lựa chọn máy cắt của đợt.
  @ApiProperty({ enum: SolverMachine }) solverMachine!: SolverMachine;
  /// Thông số máy cắt hiện tại - KHSX CHỈ XEM ở "Tối ưu cắt sắt" (2026-10-24, người dùng: "để KHSX xem thông số hiện tại…
  /// cần config lại thì liên hệ admin"). Cùng tên cột SystemConfig; chỉ Admin sửa qua PUT /system-config.
  @ApiProperty({ type: [Number] }) solverStockLengths!: number[];
  @ApiProperty() solverMaxSurplus!: number;
  @ApiProperty() solverTrimStartMm!: number;
  @ApiProperty() solverBladeWidthMm!: number;
  @ApiProperty() solverMctdTrimStartMm!: number;
  @ApiProperty() solverMctdBladeWidthMm!: number;
  @ApiProperty({ type: [Number] }) solverBundleFactors!: number[];
  @ApiProperty() solverMaxManualCuts!: number;
  @ApiProperty() solverMaxSizesPerPattern!: number;
  @ApiProperty() solverMergeWindowDays!: number;
  @ApiProperty() solverMergeMaxSkus!: number;
  @ApiPropertyOptional({ nullable: true }) previous!: number | null;
  @ApiProperty() updatedAt!: Date;

  constructor(partial: Partial<CuttingDefaultsResponseDto>) {
    Object.assign(this, partial);
  }
}
