import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { NotificationAudience } from '../../../generated/prisma/client';
import { NotificationLink } from '../notification-types';

/** 1 dòng "thông báo của tôi" - Notification + trạng thái NotificationRecipient của ĐÚNG người
 *  gọi (isRead/isResolved/isArchived đều theo user hiện tại, không phải trạng thái chung). */
@Exclude()
export class NotificationResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty({ nullable: true }) type!: string | null;
  @Expose() @ApiProperty() category!: string;
  @Expose() @ApiProperty() severity!: string;
  @Expose() @ApiProperty() title!: string;
  @Expose() @ApiProperty() message!: string;
  @Expose() @ApiProperty({ nullable: true }) entityType!: string | null;
  @Expose() @ApiProperty({ nullable: true }) entityId!: string | null;
  @Expose() @ApiProperty({ nullable: true, type: Object }) link!: NotificationLink | null;
  @Expose() @ApiProperty({ nullable: true, type: Object }) data!: unknown;
  @Expose() @ApiProperty({ nullable: true }) actorId!: string | null;
  @Expose()
  @ApiProperty({ nullable: true, enum: NotificationAudience })
  audience!: NotificationAudience | null;
  @Expose() @ApiProperty({ nullable: true }) createdBy!: string | null;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiProperty() isRead!: boolean;
  @Expose() @ApiProperty() isResolved!: boolean;

  constructor(partial: Partial<NotificationResponseDto>) {
    Object.assign(this, partial);
  }
}
