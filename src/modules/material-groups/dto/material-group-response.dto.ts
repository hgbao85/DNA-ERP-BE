import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class MaterialGroupResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() name!: string;
  @Expose()
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Khoá kỹ thuật cố định cho 6 nhóm hệ thống (seed sẵn) - null nếu là nhóm admin tự tạo. Xem material-group-system-keys.constant.ts',
  })
  systemKey!: string | null;
  @Expose()
  @ApiProperty({ description: 'Tiền tố mã vật tư tự sinh cho nhóm này, vd "SAT"' })
  codePrefix!: string;

  constructor(partial: Partial<MaterialGroupResponseDto>) {
    Object.assign(this, partial);
  }
}
