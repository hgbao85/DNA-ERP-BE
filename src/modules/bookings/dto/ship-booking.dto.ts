import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class ShipBookingLineDto {
  @ApiProperty()
  @IsString()
  lineId!: string;

  /** Số bộ thực xuất của dòng này lần này (0 = không xuất dòng này). */
  @ApiProperty()
  @IsInt()
  @Min(0)
  qty!: number;
}

/** Đợt 10b (5.5-5.7): thủ kho thành phẩm xác nhận đã xuất 1 booking (đóng cont xong). */
export class ShipBookingDto {
  /** Số phiếu XK đã in (giữ qua POST /booking-shipments/slip-code). */
  @ApiProperty()
  @IsString()
  slipCode!: string;

  /** Ảnh phiếu xuất đã ký - bắt buộc (khoá cứng chứng từ 4.1). */
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  signedSlipUrls!: string[];

  @ApiProperty({ type: [ShipBookingLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShipBookingLineDto)
  lines!: ShipBookingLineDto[];
}

export class ReserveShipSlipCodeDto {
  /** Số đã giữ trước đó của chính người này (in lại) - còn chưa dùng thì trả lại đúng số đó. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reuse?: string;
}
