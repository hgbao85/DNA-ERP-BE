import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateBookingDto } from './create-booking.dto';

/**
 * Phần A – Đợt 10a: PATCH /bookings/:id. Bỏ field = giữ nguyên; `null` = xoá (field tuỳ chọn).
 * `lines` có mặt = THAY toàn bộ danh sách hàng (dòng không còn trong danh sách bị gỡ). Không có `lines` = giữ hàng cũ.
 * Đổi `customerId` khi booking đang có hàng mà không gửi kèm `lines` mới -> 400.
 * Chỉ sửa được khi booking DRAFT / CONFIRMED.
 */
export class UpdateBookingDto extends PartialType(
  OmitType(CreateBookingDto, ['bookingNo'] as const),
) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Số booking không được để trống' })
  @MaxLength(60)
  bookingNo?: string;
}
