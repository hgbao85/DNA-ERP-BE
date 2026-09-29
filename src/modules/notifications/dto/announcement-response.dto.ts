import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { NotificationAudience } from '../../../generated/prisma/client';

/** 1 dòng ở "Thông báo chung đã gửi" (admin) - khác NotificationResponseDto ở chỗ đây là góc nhìn
 *  CỦA NGƯỜI PHÁT (tỉ lệ đã đọc trên MỌI người nhận), không phải trạng thái của 1 người cụ thể. */
@Exclude()
export class AnnouncementResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() title!: string;
  @Expose() @ApiProperty() message!: string;
  @Expose()
  @ApiProperty({ enum: NotificationAudience, nullable: true })
  audience!: NotificationAudience | null;
  @Expose() @ApiProperty({ nullable: true }) createdBy!: string | null;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiProperty() recipientCount!: number;
  @Expose() @ApiProperty() readCount!: number;

  constructor(partial: AnnouncementResponseDto) {
    Object.assign(this, partial);
  }
}
