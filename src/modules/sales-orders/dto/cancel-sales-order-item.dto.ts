import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Huỷ lệnh câu 2 (anh Nhân 24/11/2026): Sales huỷ 1 dòng đơn khi khách huỷ hẳn - bắt buộc ghi lý do. */
export class CancelSalesOrderItemDto {
  @ApiProperty({ example: 'Khách huỷ đơn' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
