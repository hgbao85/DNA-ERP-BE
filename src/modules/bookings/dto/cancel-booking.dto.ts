import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** Phần A – Đợt 10a: POST /bookings/:id/cancel - huỷ booking DRAFT/CONFIRMED, trả lại số đã xếp. */
export class CancelBookingDto {
  @ApiProperty()
  @IsString()
  @MinLength(1, { message: 'Nhập lý do huỷ booking' })
  @MaxLength(500)
  reason!: string;
}
