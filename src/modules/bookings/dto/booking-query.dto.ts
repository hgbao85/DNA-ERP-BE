import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { BookingStatus } from '../../../generated/prisma/client';
import { DATE_ONLY_PATTERN } from './create-booking.dto';

/**
 * Phần A – Đợt 10a: GET /bookings. Không phân trang (vài chục booking/tháng) - tối đa 500 dòng, xếp theo ngày lấy cont.
 * `from`/`to` (YYYY-MM-DD, ngày VN, tính cả 2 đầu): lấy booking có ÍT NHẤT 1 trong 4 ngày (cắt SI, lấy cont, CUT OFF, ETD) rơi
 * vào khoảng - dùng cho dạng lịch tháng. Mặc định KHÔNG lấy booking đã huỷ (`includeCancelled=true` để lấy).
 */
export class BookingQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN)
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN)
  to?: string;

  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerId?: string;

  /** Tìm theo số booking, mã PO khách, mã lệnh (LSX/PI), tên tàu, POD. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  includeCancelled?: boolean;
}

/** GET /bookings/candidates?customerId=&bookingId= */
export class BookingCandidatesQueryDto {
  @ApiProperty()
  @IsString()
  customerId!: string;

  /** Đang sửa booking này: số đã xếp của chính nó không tính là "đã xếp booking khác", và dòng đang có trong nó luôn hiện. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bookingId?: string;
}
