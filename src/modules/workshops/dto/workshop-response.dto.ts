import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { WorkshopCapacityMode } from '../../../generated/prisma/client';

/** Phần A – Đợt 2: xưởng cơ khí (Phôi + Hàn + Sơn) để chọn khi nhập lệnh sản xuất. */
@Exclude()
export class WorkshopResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() code!: string;
  @Expose() @ApiProperty() name!: string;
  @Expose() @ApiProperty({ enum: WorkshopCapacityMode }) capacityMode!: WorkshopCapacityMode;
  /** Xưởng làm công đoạn Sơn cho xưởng này (null = tự sơn). */
  @Expose() @ApiProperty({ nullable: true, type: String }) paintWorkshopId!: string | null;
  @Expose() @ApiProperty() sortOrder!: number;

  constructor(partial: Partial<WorkshopResponseDto>) {
    Object.assign(this, partial);
  }
}
