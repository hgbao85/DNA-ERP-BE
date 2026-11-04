import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** Phần A – Đợt 2: QLSX đổi xưởng cơ khí của cả lệnh - bắt buộc nêu lý do (đưa vào thông báo + audit). */
export class ChangeWorkshopDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  workshopId!: string;

  @ApiProperty({ maxLength: 500 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
