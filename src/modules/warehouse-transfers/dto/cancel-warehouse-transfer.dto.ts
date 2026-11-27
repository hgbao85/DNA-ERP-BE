import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** Kho gửi huỷ phiếu chuyển hàng của lệnh chưa nhận (nghiệp vụ 16/11 câu 1a). */
export class CancelWarehouseTransferDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
