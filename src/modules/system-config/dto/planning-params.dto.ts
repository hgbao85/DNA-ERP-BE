import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

/** Tham số lập kế hoạch MỌI người đăng nhập được đọc (không cần quyền SYSTEM_CONFIG vốn chỉ Admin có). */
@Exclude()
export class PlanningParamsDto {
  /** Thể tích 1 cont (m³) - FE dùng xem trước load cont khi nhập kích thước thùng. */
  @Expose() @ApiProperty() containerVolumeM3!: number;
  /** Phần A – Đợt 2: tiền tố số LSX Admin khai (vd ["MY","GP"]); rỗng = mọi tiền tố đúng dạng. FE dùng cho ô chọn tiền tố. */
  @Expose() @ApiProperty({ type: [String] }) lsxPrefixes!: string[];

  constructor(partial: Partial<PlanningParamsDto>) {
    Object.assign(this, partial);
  }
}
