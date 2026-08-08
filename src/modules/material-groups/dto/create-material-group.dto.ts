import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MinLength } from 'class-validator';

export class CreateMaterialGroupDto {
  @ApiProperty({ description: 'vd Sắt ống, Dây đan, Phụ kiện, Sơn, Bao bì' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({
    description:
      'Tiền tố mã vật tư tự sinh cho nhóm này (vd "SAT" -> "SAT-001", "SAT-002"...), 2-8 ký tự IN HOA A-Z/0-9, phải duy nhất. FE gợi ý sẵn từ tên nhóm, admin sửa được trước khi lưu.',
  })
  @IsString()
  @Matches(/^[A-Z0-9]{2,8}$/, {
    message: 'Tiền tố mã phải 2-8 ký tự, chỉ chữ IN HOA A-Z và số',
  })
  codePrefix!: string;
}
