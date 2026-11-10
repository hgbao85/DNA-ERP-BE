import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

/** Phần A: 1 lệnh đang bật cờ "cần kiểm lại phương án cắt" (GET production-invoices/cutting-recheck/pending). */
@Exclude()
export class CuttingRecheckPendingResponseDto {
  @Expose() @ApiProperty() productionInvoiceId!: string;
  @Expose() @ApiProperty() piCode!: string;
  /** Mã lệnh hiển thị (số LSX nối " + ", chưa có thì mã PI). */
  @Expose() @ApiProperty() displayCode!: string;
  /** Xưởng hiện tại của lệnh (null = chưa có xưởng). */
  @Expose() @ApiProperty({ nullable: true }) workshopName!: string | null;
  /** ISO - lúc bật cờ (lần đổi xưởng gần nhất). */
  @Expose() @ApiProperty() requiredAt!: string;

  constructor(partial: Partial<CuttingRecheckPendingResponseDto>) {
    Object.assign(this, partial);
  }
}
